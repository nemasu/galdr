import React, { useState, useEffect, useMemo, useRef } from 'react';
import { render, Box, Text, useApp, } from 'ink';
import { SessionSelector } from './components/SessionSelector.js';
import { NewSessionDialog } from './components/NewSessionDialog.js';
import { EditDescriptionDialog } from './components/EditDescriptionDialog.js';
import { Provider, SwitchMode, Message, ToolInfo, StreamItem } from '../types/index.js';
import { ContextManager } from '../context/manager.js';
import { ProviderManager } from '../providers/index.js';
import { ContentArea } from './components/ContentArea.js';
import { OutputItem } from './components/OutputItem.js';
import { KeypressProvider, useKeypress, Key } from './contexts/KeypressContext.js';
import { TextBuffer } from './utils/TextBuffer.js';
import { InputArea } from './components/InputArea.js';
import { InkWriter, InkWriterCallbacks } from './utils/InkWriter.js';

interface Notification {
  type: 'info' | 'error' | 'success' | 'provider-switch';
  message: string;
  from?: Provider;
  to?: Provider;
}

interface GaldrAppProps {
  context: ContextManager;
  providerManager: ProviderManager;
  initialPrompt?: string;
}

const GaldrApp: React.FC<GaldrAppProps> = ({ context, providerManager, initialPrompt }) => {
  const { exit } = useApp();
  const [currentProvider, setCurrentProvider] = useState<Provider>(context.getCurrentProvider());
  const [currentSession, setCurrentSession] = useState<string>(context.getCurrentSessionName());
  const [messages, setMessages] = useState<Message[]>(context.getMessages());
  const [isLoading, setIsLoading] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [abortController, setAbortController] = useState(new AbortController());
  const [ctrlCCount, setCtrlCCount] = useState(0);

  // Pending item pattern: single mutable message for streaming
  const [pendingMessage, setPendingMessage] = useState<Message | null>(null);

  const buffer = useMemo(() => new TextBuffer(), []);
  const initialMessageCount = useMemo(() => messages.length, []);
  const [initialPromptProcessed, setInitialPromptProcessed] = useState(false);
  const [bufferUpdateTrigger, setBufferUpdateTrigger] = useState(0);

  // Memoize switch mode to prevent unnecessary re-renders
  const switchMode = useMemo(() => context.getSwitchMode(), [context]);

  // Generate startup message - simple version shown on app start
  const generateStartupMessage = useMemo(() => {
    return '__STARTUP_MESSAGE__';
  }, [currentProvider, switchMode, initialMessageCount]);

  // Generate full help message - shown when /help is used
  const generateHelpMessage = useMemo(() => {
    return '__HELP_MESSAGE__';
  }, []);

  // Add startup message on app start (always, even if context is restored)
  useEffect(() => {
    const startupMessage: Message = {
      role: 'assistant',
      content: generateStartupMessage,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, startupMessage]);
  }, []);

  // Separate completed messages from the initial count
  const completedMessages = useMemo(() => {
    // If messages is empty, return empty array
    if (messages.length === 0) return [];
    return messages.slice(initialMessageCount);
  }, [messages, initialMessageCount]);

  // Keep only recent history to avoid performance issues (last 50 messages)
  const recentHistory = useMemo(() => {
    const maxHistory = 50;
    if (completedMessages.length > maxHistory) {
      return completedMessages.slice(-maxHistory);
    }
    return completedMessages;
  }, [completedMessages]);

  // Memoize the rendered history items to prevent Static from re-rendering
  const historyItems = useMemo(
    () =>
      recentHistory.map((msg) => (
        <OutputItem 
          key={msg.timestamp} 
          message={msg} 
          currentProvider={currentProvider}
          switchMode={switchMode}
          initialMessageCount={initialMessageCount}
        />
      )),
    [recentHistory, currentProvider, switchMode, initialMessageCount]
  );

  // Process initial prompt if provided (after component is fully initialized)
  useEffect(() => {
    if (initialPrompt && !initialPromptProcessed && !isLoading) {
      setInitialPromptProcessed(true);
      handleSubmit(initialPrompt);
    }
  }, [initialPrompt, initialPromptProcessed, isLoading]);

  // Reset Ctrl+C count after 1 second
  useEffect(() => {
    if (ctrlCCount > 0) {
      const timer = setTimeout(() => setCtrlCCount(0), 1000);
      return () => clearTimeout(timer);
    }
  }, [ctrlCCount]);

  // Handle Ctrl+C behavior
  useEffect(() => {
    if (ctrlCCount === 0) return;

    if (ctrlCCount === 1) {
      // Single Ctrl+C: Clear input buffer or show exit prompt
      if (!isLoading) {
        buffer.clear();
        setBufferUpdateTrigger(prev => prev + 1); // Force InputArea re-render
        setNotifications([{ type: 'info', message: 'Input cleared. Press Ctrl+C again to exit' }]);
      } else {
        // During loading, show exit prompt
        setNotifications([{ type: 'info', message: 'Press Ctrl+C again to exit' }]);
      }
    } else if (ctrlCCount >= 2) {
      // Double Ctrl+C: Exit program
      if (isLoading) {
        setNotifications([{ type: 'info', message: 'Cancelling current operation...' }]);
        abortController.abort();
        setIsLoading(false);
        setPendingMessage(null);
        setAbortController(new AbortController());
        setCtrlCCount(0);
      } else {
        setNotifications([{ type: 'info', message: 'Exiting chat. Goodbye!' }]);
        setTimeout(() => exit(), 500);
      }
    }
  }, [ctrlCCount, isLoading, abortController, exit, buffer]);

  const [isActive, setIsActive] = useState(true);
  const [showSessionSelector, setShowSessionSelector] = useState(false);
  const [showNewSessionDialog, setShowNewSessionDialog] = useState(false);
  const [showEditDescriptionDialog, setShowEditDescriptionDialog] = useState(false);
  const [editingSessionName, setEditingSessionName] = useState<string | null>(null);

  // Global keypress handler for Ctrl+C, Escape, and Ctrl+S
  const handleGlobalKeypress = (key: Key) => {
    // Handle Ctrl+C
    if (key.ctrl && key.name === 'c') {
      setCtrlCCount((prev) => prev + 1);
      return;
    }

    // Handle Ctrl+S - Session management
    if (key.ctrl && key.name === 's') {
      if (!isLoading) {
        setIsActive(false); // Deactivate input while in session selection
        setShowSessionSelector(true);
      }
      return;
    }

    // Handle Escape
    if (key.name === 'escape') {
      if (isLoading) {
        setNotifications([{ type: 'info', message: 'Cancelling current operation...' }]);
        abortController.abort();
        setIsLoading(false);
        setPendingMessage(null);
        setAbortController(new AbortController());
      } else if (showSessionSelector) {
        // Exit session selector
        setShowSessionSelector(false);
        setIsActive(true);
      } else if (showNewSessionDialog) {
        // Exit new session dialog
        setShowNewSessionDialog(false);
        setIsActive(true);
      } else if (showEditDescriptionDialog) {
        // Exit edit description dialog
        setShowEditDescriptionDialog(false);
        setEditingSessionName(null);
        setIsActive(true);
      }
      return;
    }
  };

  useKeypress(handleGlobalKeypress, { isActive: true });

  // Session selector handlers
  const handleSessionSelect = (sessionName: string) => {
    if (context.switchSession(sessionName)) {
      setCurrentSession(sessionName);
      setMessages(context.getMessages());
      setNotifications([{ type: 'success', message: `Switched to session: ${sessionName}` }]);
      setShowSessionSelector(false);
      setIsActive(true);
    } else {
      setNotifications([{ type: 'error', message: `Failed to switch to session: ${sessionName}` }]);
    }
  };

  const handleNewSession = () => {
    setShowSessionSelector(false);
    setShowNewSessionDialog(true);
  };

  const handleSessionSelectorClose = () => {
    setShowSessionSelector(false);
    setIsActive(true);
  };

  const handleSessionDelete = (sessionName: string) => {
    if (context.deleteSession(sessionName)) {
      setNotifications([{ type: 'success', message: `Deleted session: ${sessionName}` }]);
      // Refresh the session list by closing and reopening the selector
      setShowSessionSelector(false);
      setTimeout(() => setShowSessionSelector(true), 100);
    } else {
      setNotifications([{ type: 'error', message: `Failed to delete session: ${sessionName}` }]);
    }
  };

  const handleSessionEditDescription = (sessionName: string) => {
    setEditingSessionName(sessionName);
    setShowSessionSelector(false);
    setShowEditDescriptionDialog(true);
  };

  const handleEditDescriptionConfirm = (description: string) => {
    if (editingSessionName && context.updateSessionDescription(editingSessionName, description)) {
      setNotifications([{ type: 'success', message: `Updated description for session: ${editingSessionName}` }]);
    } else {
      setNotifications([{ type: 'error', message: `Failed to update description` }]);
    }
    setShowEditDescriptionDialog(false);
    setEditingSessionName(null);
    // Return to session selector
    setShowSessionSelector(true);
  };

  const handleEditDescriptionCancel = () => {
    setShowEditDescriptionDialog(false);
    setEditingSessionName(null);
    // Return to session selector
    setShowSessionSelector(true);
  };

  const handleNewSessionConfirm = (name: string, description?: string) => {
    if (context.createSession(name, description)) {
      // Switch to the newly created session
      if (context.switchSession(name)) {
        setCurrentSession(name);
        setMessages(context.getMessages());
        setNotifications([{ type: 'success', message: `Created and switched to session: ${name}` }]);
      } else {
        setNotifications([{ type: 'success', message: `Created session: ${name}` }]);
      }
    } else {
      setNotifications([{ type: 'error', message: `Session ${name} already exists` }]);
    }
    setShowNewSessionDialog(false);
    setIsActive(true);
  };

  const handleNewSessionCancel = () => {
    setShowNewSessionDialog(false);
    setIsActive(true);
  };

  const handleCommand = async (command: string) => {
    const parts = command.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    setNotifications([]);

    switch (cmd) {
      case 'exit':
      case 'quit':
        setNotifications([{ type: 'info', message: 'Goodbye!' }]);
        setTimeout(() => exit(), 500);
        break;

      case 'switch':
        if (args.length === 0) {
          setNotifications([
            { type: 'error', message: 'Usage: /switch <provider> (claude, gemini, copilot, deepseek, or cursor)' },
          ]);
          return;
        }
        await handleSwitchProvider(args[0] as Provider);
        break;

      case 'mode':
        if (args.length === 0) {
          setNotifications([{ type: 'error', message: 'Usage: /mode <mode> (manual, rollover, or round-robin)' }]);
          return;
        }
        handleSwitchMode(args[0] as SwitchMode);
        break;

      case 'clear':
        // Clear history
        context.clear();
        setNotifications([{ type: 'success', message: 'Chat history cleared' }]);
        break;

      case 'compact':
        handleCompactCommand(args);
        break;

      case 'history':
        handleHistoryCommand();
        break;

      case 'status':
        await handleStatusCommand();
        break;

      case 'help':
        const helpMessage: Message = {
          role: 'assistant',
          content: generateHelpMessage,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, helpMessage]);
        setNotifications([]);
        break;

      case 'verbose':
        handleVerboseCommand();
        break;

      case 'model':
        handleModelCommand(args);
        break;

      case 'sessions':
        handleSessionsCommand();
        break;

      case 'session-new':
        handleSessionNewCommand(args);
        break;

      case 'session-load':
        handleSessionLoadCommand(args);
        break;

      case 'session-save':
        handleSessionSaveCommand(args);
        break;

      case 'session-delete':
        handleSessionDeleteCommand(args);
        break;

      case 'session-rename':
        handleSessionRenameCommand(args);
        break;

      default:
        setNotifications([
          { type: 'error', message: `Unknown command: /${cmd}. Type /help for available commands.` },
        ]);
    }
  };

  const handleSwitchProvider = async (provider: Provider) => {
    if (!['claude', 'gemini', 'copilot', 'deepseek', 'cursor'].includes(provider)) {
      setNotifications([{ type: 'error', message: 'Invalid provider. Must be: claude, gemini, copilot, deepseek, or cursor' }]);
      return;
    }

    const available = await providerManager.checkAvailability(provider);
    if (!available) {
      const errorMessage = provider === 'deepseek'
        ? `Provider ${provider} is not available. Please set the API key using: galdr config --set-key deepseek <your-api-key>`
        : `Provider ${provider} is not available. Please install the CLI tool.`;
      setNotifications([
        { type: 'error', message: errorMessage },
      ]);
      return;
    }

    const oldProvider = currentProvider;
    setCurrentProvider(provider);
    context.setCurrentProvider(provider);
    setNotifications([{ type: 'provider-switch', message: 'Manual provider switch', from: oldProvider, to: provider }]);
  };

  const handleSwitchMode = (mode: SwitchMode) => {
    if (!['manual', 'rollover', 'round-robin'].includes(mode)) {
      setNotifications([{ type: 'error', message: 'Invalid mode. Must be: manual, rollover, or round-robin' }]);
      return;
    }

    context.setSwitchMode(mode);
    setNotifications([{ type: 'success', message: `Switch mode changed to ${mode}` }]);
  };

  const handleCompactCommand = async (args: string[]) => {
    const keepCount = args.length > 0 ? parseInt(args[0]) : 10;

    if (isNaN(keepCount) || keepCount < 1) {
      setNotifications([{ type: 'error', message: 'Invalid keep count. Must be a positive number.' }]);
      return;
    }

    const messagesBefore = context.getMessages().length;

    if (messagesBefore <= keepCount) {
      setNotifications([{ type: 'info', message: `History has ${messagesBefore} messages. No compaction needed.` }]);
      return;
    }

    setNotifications([{ type: 'info', message: 'Compacting and summarizing messages...' }]);

    const result = await context.compact(keepCount);

    if (result.error) {
      setNotifications([{ type: 'error', message: result.error }]);
    } else if (result.compacted) {
      setMessages(context.getMessages());
      setNotifications([
        { type: 'success', message: `Compacted ${result.removed} messages, kept ${keepCount} recent messages` },
      ]);
    } else {
      setNotifications([{ type: 'info', message: 'No compaction needed.' }]);
    }
  };

  const handleHistoryCommand = () => {
    const stats = context.getHistoryStats();
    const autoCompactEnabled = context.isAutoCompactEnabled();
    const threshold = context.getAutoCompactThreshold();

    const infoMessage = `Messages: ${stats.messageCount}\nCharacters: ${stats.totalChars.toLocaleString()}\nAuto-compact: ${autoCompactEnabled ? 'Enabled' : 'Disabled'} (threshold: ${threshold})`;
    setNotifications([{ type: 'info', message: infoMessage }]);
  };

  const handleStatusCommand = async () => {
    const availability = await providerManager.checkAllAvailability();
    const usage = context.getProviderUsage();

    const statusLines: string[] = [];
    const providers: Provider[] = ['claude', 'gemini', 'copilot', 'deepseek', 'cursor'];

    for (const provider of providers) {
      const available = availability.get(provider) || false;
      let status: string;

      if (provider === 'deepseek') {
        status = available ? '✓ Built-in (API key set)' : '⚠ Built-in (API key not set)';
      } else {
        status = available ? '✓ Available' : '✗ Not found';
      }

      const model = context.getProviderModel(provider);
      statusLines.push(`${provider}: ${status} (${usage[provider]} requests, model: ${model})`);
    }

    setNotifications([{ type: 'info', message: `Provider Status:\n${statusLines.join('\n')}` }]);
  };

  const handleVerboseCommand = () => {
    const currentVerbose = process.env.GALDR_VERBOSE === '1';
    const newVerbose = !currentVerbose;

    if (newVerbose) {
      process.env.GALDR_VERBOSE = '1';
      setNotifications([{ type: 'success', message: 'Verbose mode enabled for this session' }]);
    } else {
      delete process.env.GALDR_VERBOSE;
      setNotifications([{ type: 'success', message: 'Verbose mode disabled' }]);
    }
  };

  const handleModelCommand = (args: string[]) => {
    if (args.length < 2) {
      setNotifications([
        { type: 'error', message: 'Usage: /model <provider> <model>\nExample: /model claude claude-3-5-sonnet-20241022' },
      ]);
      return;
    }

    const provider = args[0] as Provider;
    const model = args[1];

    if (!['claude', 'gemini', 'copilot', 'deepseek', 'cursor'].includes(provider)) {
      setNotifications([{ type: 'error', message: 'Invalid provider. Must be: claude, gemini, copilot, deepseek, or cursor' }]);
      return;
    }

    context.setProviderModel(provider, model);
    setNotifications([{ type: 'success', message: `Model for ${provider} set to: ${model}` }]);
  };

  const handleSessionsCommand = () => {
    const sessions = context.listSessions();
    const currentSessionName = context.getCurrentSessionName();

    if (sessions.length === 0) {
      setNotifications([{ type: 'info', message: 'No sessions found.' }]);
      return;
    }

    const sessionLines = sessions.map((session) => {
      const current = session.name === currentSessionName ? ' (current)' : '';
      const desc = session.description ? ` - ${session.description}` : '';
      const lastAccessed = new Date(session.lastAccessed).toLocaleString();
      return `${session.name}${current}: ${session.messageCount} messages, last accessed: ${lastAccessed}${desc}`;
    });

    setNotifications([{ type: 'info', message: `Sessions:\n${sessionLines.join('\n')}` }]);
  };

  const handleSessionNewCommand = (args: string[]) => {
    if (args.length === 0) {
      setNotifications([{ type: 'error', message: 'Usage: /session-new <name> [description]' }]);
      return;
    }

    const sessionName = args[0];
    const description = args.slice(1).join(' ');

    if (context.createSession(sessionName, description || undefined)) {
      // Switch to the newly created session
      if (context.switchSession(sessionName)) {
        setCurrentSession(sessionName);
        setMessages(context.getMessages());
        setNotifications([{ type: 'success', message: `Created and switched to session: ${sessionName}` }]);
      } else {
        setNotifications([{ type: 'success', message: `Created session: ${sessionName}` }]);
      }
    } else {
      setNotifications([{ type: 'error', message: `Session ${sessionName} already exists` }]);
    }
  };

  const handleSessionLoadCommand = (args: string[]) => {
    if (args.length === 0) {
      setNotifications([{ type: 'error', message: 'Usage: /session-load <name>' }]);
      return;
    }

    const sessionName = args[0];

    if (context.switchSession(sessionName)) {
      setCurrentSession(sessionName);
      setMessages(context.getMessages());
      setNotifications([{ type: 'success', message: `Switched to session: ${sessionName}` }]);
    } else {
      setNotifications([{ type: 'error', message: `Session ${sessionName} not found` }]);
    }
  };

  const handleSessionSaveCommand = (args: string[]) => {
    const description = args.join(' ');
    const sessionName = context.getCurrentSessionName();
    const metadata = context.getSessionMetadata(sessionName);

    if (metadata) {
      context.save();
      setNotifications([{ type: 'success', message: `Saved session: ${sessionName}` }]);
    } else {
      setNotifications([{ type: 'error', message: 'Failed to save session' }]);
    }
  };

  const handleSessionDeleteCommand = (args: string[]) => {
    if (args.length === 0) {
      setNotifications([{ type: 'error', message: 'Usage: /session-delete <name>' }]);
      return;
    }

    const sessionName = args[0];

    if (sessionName === context.getCurrentSessionName()) {
      setNotifications([{ type: 'error', message: 'Cannot delete the current session' }]);
      return;
    }

    if (context.deleteSession(sessionName)) {
      setNotifications([{ type: 'success', message: `Deleted session: ${sessionName}` }]);
    } else {
      setNotifications([{ type: 'error', message: `Session ${sessionName} not found or could not be deleted` }]);
    }
  };

  const handleSessionRenameCommand = (args: string[]) => {
    if (args.length < 2) {
      setNotifications([{ type: 'error', message: 'Usage: /session-rename <old-name> <new-name>' }]);
      return;
    }

    const oldName = args[0];
    const newName = args[1];

    if (context.renameSession(oldName, newName)) {
      if (oldName === context.getCurrentSessionName()) {
        setCurrentSession(newName);
      }
      setNotifications([{ type: 'success', message: `Renamed session from ${oldName} to ${newName}` }]);
    } else {
      setNotifications([{ type: 'error', message: `Failed to rename session (session not found or new name already exists)` }]);
    }
  };

  const handleSubmit = async (input: string) => {
    // Check if it's a command
    if (input.startsWith('/')) {
      await handleCommand(input);
      return;
    }

    // Regular user input
    await handleUserInput(input);
  };

  const handleUserInput = async (userInput: string) => {
    setNotifications([]);

    // Add user message
    const userMessage: Message = {
      role: 'user',
      content: userInput,
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);

    // Save user message to context
    const userResult = await context.addMessage('user', userInput);

    if (userResult.error) {
      setNotifications([{ type: 'error', message: `Auto-compact failed: ${userResult.error}` }]);
    } else if (userResult.autoCompacted) {
      setNotifications([{ type: 'info', message: `Auto-compacted history: ${userResult.removed} messages summarized` }]);
    }

    // Execute with current provider from context (to avoid stale closure)
    const provider = context.getCurrentProvider();
    await executeWithProvider(userInput, provider);
  };

  const executeWithProvider = async (prompt: string, provider: Provider) => {
    setIsLoading(true);
    setPendingMessage(null);
    // Don't clear notifications here - let them persist during streaming

    // Get conversation history
    const conversationHistory = context.getMessages().slice(0, -1);

    // Initialize pending message
    const initialPendingMessage: Message = {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      provider,
      streamItems: [],
    };
    setPendingMessage(initialPendingMessage);

    // Use local variables to track streaming state
    let accumulatedStreamItems: StreamItem[] = [];
    let currentTextBuffer = ''; // Buffer for current text segment
    let lastUpdate = Date.now();
    const THROTTLE_MS = 16; // ~60fps
    let messageTimestampCounter = Date.now(); // Ensure unique timestamps for split messages
    let lastSavedContent = ''; // Track last saved content to avoid redundant saves

    // Helper to get full text content from all text items
    const getFullTextContent = () => {
      return accumulatedStreamItems
        .filter(item => item.type === 'text')
        .map(item => item.text || '')
        .join('');
    };

    // Helper to save completed content to context incrementally
    const saveCompletedContent = async (content: string) => {
      if (content === lastSavedContent) return; // Avoid redundant saves
      
      try {
        // Try to update the last assistant message, or create a new one
        const updated = context.updateLastAssistantMessage(content, provider);
        if (!updated) {
          // No existing assistant message found, create a new one
          await context.addMessage('assistant', content, provider);
        }
        
        lastSavedContent = content;
      } catch (error) {
        console.error('Failed to save incremental content:', error);
      }
    };

    // Helper to update pending message (throttled)
    const updatePendingMessage = async () => {
      const now = Date.now();
      if (now - lastUpdate < THROTTLE_MS) return;
      lastUpdate = now;

      const currentContent = getFullTextContent();
      
      // Save completed content to context
      if (currentContent && currentContent !== lastSavedContent) {
        await saveCompletedContent(currentContent);
      }

      setPendingMessage({
        role: 'assistant',
        content: currentContent,
        timestamp: messageTimestampCounter, // Use consistent timestamp
        provider,
        streamItems: [...accumulatedStreamItems],
      });
    };

    // Create InkWriter callbacks
    let currentToolId = 0;
    const writerCallbacks: InkWriterCallbacks = {
      onTextChunk: async (chunk: string) => {
        currentTextBuffer += chunk;

        // Update or create text item in stream
        const lastItem = accumulatedStreamItems[accumulatedStreamItems.length - 1];
        if (lastItem && lastItem.type === 'text') {
          // Update existing text item
          lastItem.text = currentTextBuffer;
        } else {
          // Create new text item
          accumulatedStreamItems.push({ type: 'text' as const, text: currentTextBuffer });
        }

        await updatePendingMessage();
      },
      onToolUse: async (name: string, parameters?: any) => {
        // Start a new text buffer for text after this tool
        currentTextBuffer = '';

        const toolId = `tool-${currentToolId++}`;
        const toolInfo: ToolInfo = { id: toolId, name, parameters, status: 'running' };
        const newItem = { type: 'tool' as const, tool: toolInfo };
        accumulatedStreamItems.push(newItem);

        await updatePendingMessage();
      },
      onToolComplete: async (success: boolean) => {
        // Find the last tool item and update its status
        for (let i = accumulatedStreamItems.length - 1; i >= 0; i--) {
          if (accumulatedStreamItems[i].type === 'tool' && accumulatedStreamItems[i].tool) {
            accumulatedStreamItems[i] = {
              ...accumulatedStreamItems[i],
              tool: { ...accumulatedStreamItems[i].tool!, status: success ? 'success' : 'failed' }
            };
            break;
          }
        }

        await updatePendingMessage();
      },
      onInfo: async (message: string) => {
        // Start a new text buffer for text after this info
        currentTextBuffer = '';

        const newItem = { type: 'info' as const, info: message };
        accumulatedStreamItems.push(newItem);

        await updatePendingMessage();
      },
    };

    const inkWriter = new InkWriter(writerCallbacks);
    inkWriter.activate();

    const providerInstance = providerManager.getProvider(provider);
    providerInstance.setInkWriter(inkWriter);
    
    // Set the model for this provider
    const model = context.getProviderModel(provider);
    providerInstance.setModel(model);

    const result = await providerInstance.execute(prompt, conversationHistory, undefined, undefined, abortController.signal);

    inkWriter.deactivate();

    // Get final text content from all text items
    const finalTextContent = getFullTextContent();

    // Final update with complete content
    messageTimestampCounter++;
    const finalPendingMessage: Message = {
      role: 'assistant',
      content: finalTextContent,
      timestamp: messageTimestampCounter,
      provider,
      streamItems: [...accumulatedStreamItems],
    };
    setPendingMessage(finalPendingMessage);

    setIsLoading(false);

    if (result.success && result.response) {
      // Extract tools from stream items
      const tools = accumulatedStreamItems
        .filter(item => item.type === 'tool')
        .map(item => item.tool!)
        .filter(tool => tool !== undefined);

      // Move pending message to completed history
      messageTimestampCounter++;
      const completedMessage: Message = {
        role: 'assistant',
        content: finalTextContent || result.response,
        timestamp: messageTimestampCounter,
        provider,
        tools: tools.length > 0 ? tools : undefined,
        streamItems: accumulatedStreamItems.length > 0 ? accumulatedStreamItems : undefined,
      };

      // Add to history and clear pending message
      setMessages((prev) => [...prev, completedMessage]);
      setPendingMessage(null);

      // The assistant response has already been saved incrementally, just update usage
      context.incrementProviderUsage(provider);

      // Final save to ensure everything is persisted
      context.save();

      // Handle token limit
      if (result.tokenLimitReached) {
        await handleTokenLimitReached(provider);
      } else {
        // Check round-robin mode
        const switchMode = context.getSwitchMode();
        if (switchMode === 'round-robin') {
          const nextProvider = await providerManager.getNextAvailableProvider(provider, 'round-robin');

          if (nextProvider && nextProvider !== provider) {
            setCurrentProvider(nextProvider);
            context.setCurrentProvider(nextProvider);
            setNotifications((prev) => [
              ...prev,
              { type: 'provider-switch', message: 'Round-robin mode', from: provider, to: nextProvider },
            ]);
          }
        }
      }
    } else {
      // On error or cancellation, save whatever was completed before the interruption
      const completedContent = getFullTextContent();
      if (completedContent && completedContent !== lastSavedContent) {
        await saveCompletedContent(completedContent);
      }

      // Keep pending message visible with error notification
      setNotifications((prev) => [...prev, { type: 'error', message: result.error || 'Unknown error occurred' }]);

      if (result.tokenLimitReached) {
        await handleTokenLimitReached(provider);
      }
    }

    setAbortController(new AbortController());
  };

  const handleTokenLimitReached = async (provider: Provider) => {
    const switchMode = context.getSwitchMode();

    if (switchMode === 'manual') {
      setNotifications([{ type: 'error', message: 'Token limit reached. Use /switch <provider> to change providers.' }]);
      return;
    }

    // Find next available provider
    let nextProvider = providerManager.getNextProvider(provider, 'round-robin');
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      const available = await providerManager.checkAvailability(nextProvider);
      if (available) {
        const oldProvider = currentProvider;
        setCurrentProvider(nextProvider);
        context.setCurrentProvider(nextProvider);
        setNotifications([{ type: 'provider-switch', message: 'Token limit reached', from: oldProvider, to: nextProvider }]);
        return;
      }

      nextProvider = providerManager.getNextProvider(nextProvider, 'round-robin');
      attempts++;
    }

    setNotifications([{ type: 'error', message: 'All providers are unavailable or have reached their limits.' }]);
  };



  return (
    <Box flexDirection="column">
      {/* Session selector overlay */}
      {showSessionSelector && (
        <SessionSelector
          sessions={context.listSessions()}
          currentSession={currentSession}
          onSelect={handleSessionSelect}
          onNewSession={handleNewSession}
          onClose={handleSessionSelectorClose}
          onDelete={handleSessionDelete}
          onEditDescription={handleSessionEditDescription}
          isActive={showSessionSelector}
        />
      )}
      
      {/* New session dialog */}
      {showNewSessionDialog && (
        <NewSessionDialog
          onConfirm={handleNewSessionConfirm}
          onCancel={handleNewSessionCancel}
          isActive={showNewSessionDialog}
          existingSessions={context.listSessions().map(s => s.name)}
        />
      )}

      {/* Edit description dialog */}
      {showEditDescriptionDialog && editingSessionName && (
        <EditDescriptionDialog
          sessionName={editingSessionName}
          currentDescription={context.getSessionMetadata(editingSessionName)?.description}
          onConfirm={handleEditDescriptionConfirm}
          onCancel={handleEditDescriptionCancel}
          isActive={showEditDescriptionDialog}
        />
      )}

      {/* Main output area - displays all messages, tools, and notifications */}
      <Box flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
        <ContentArea
          currentProvider={currentProvider}
          switchMode={switchMode}
          initialMessageCount={initialMessageCount}
          historyItems={historyItems}
          notifications={notifications}
          pendingMessage={pendingMessage}
          isLoading={isLoading}
        />
      </Box>

      {/* Input area - includes provider badge and text input - pinned to bottom */}
      <Box flexShrink={0} width="100%">
        <InputArea
          key={bufferUpdateTrigger}
          buffer={buffer}
          onSubmit={handleSubmit}
          isActive={isActive && !isLoading}
          provider={currentProvider}
          isLoading={isLoading}
          sessionName={currentSession}
        />
      </Box>
    </Box>
  );
};

export class ChatSessionInk {
  private context: ContextManager;
  private providerManager: ProviderManager;

  constructor() {
    this.context = new ContextManager(process.cwd());
    this.providerManager = new ProviderManager();
  }

  public async start(initialPrompt?: string): Promise<void> {
    // Check if current provider is available
    const currentProvider = this.context.getCurrentProvider();
    const isAvailable = await this.providerManager.checkAvailability(currentProvider);

    if (!isAvailable) {
      // Try to find an available provider
      const available = await this.findAvailableProvider();
      if (!available) {
        console.error('No AI providers available. Please install Claude, Gemini, Copilot, or Cursor CLI.');
        return;
      }
      this.context.setCurrentProvider(available);
    }

    // Render the Ink app with KeypressProvider
    const { unmount, waitUntilExit } = render(
      <KeypressProvider>
        <GaldrApp context={this.context} providerManager={this.providerManager} initialPrompt={initialPrompt} />
      </KeypressProvider>,
      { exitOnCtrlC: false }
    );

    await waitUntilExit();
  }

  private async findAvailableProvider(): Promise<Provider | null> {
    const providers: Provider[] = ['claude', 'gemini', 'copilot', 'cursor'];
    for (const provider of providers) {
      const available = await this.providerManager.checkAvailability(provider);
      if (available) {
        return provider;
      }
    }
    return null;
  }
}
