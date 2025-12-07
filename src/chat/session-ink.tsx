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
import { InputHistory } from './utils/InputHistory.js';
import { InkWriter, InkWriterCallbacks } from './utils/InkWriter.js';
import chalk from 'chalk';
import { verboseLogger } from '../utils/logger.js';
import { Notification, SpecialMessageType } from './utils/DisplayManager.js';

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
  const [initialPromptProcessed, setInitialPromptProcessed] = useState(false);
  const [bufferUpdateTrigger, setBufferUpdateTrigger] = useState(0);
  const [initialMessageCount, setInitialMessageCount] = useState(0);

  // Input history management - load from session data on app start
  const inputHistory = useMemo(() => {
    const history = new InputHistory();
    // Load user messages from the current session
    const userMessages = messages.filter(msg => msg.role === 'user');
    history.loadFromSession(userMessages);
    return history;
  }, []);

  // Memoize switch mode to prevent unnecessary re-renders
  const switchMode = useMemo(() => context.getSwitchMode(), [context]);

  // Generate startup message - simple version shown on app start
  const startupMessage: Message = useMemo(() => ({
    role: 'assistant' as const,
    content: SpecialMessageType.STARTUP,
    timestamp: Date.now(),
  }), []);

  // Generate full help message - shown when /help is used
  const generateHelpMessage = useMemo(() => {
    return SpecialMessageType.HELP;
  }, []);

  // Set initial message count based on restored messages
  useEffect(() => {
    setInitialMessageCount(messages.length);
  }, []);

  // All completed messages to display (startup message + context messages)
  const completedMessages = useMemo(() => {
    if (process.env.GALDR_VERBOSE === '1') {
      verboseLogger.log(`[completedMessages] messages.length=${messages.length}, initialMessageCount=${initialMessageCount}`);
    }

    // Always prepend the startup message to the display
    return [startupMessage, ...messages];
  }, [messages, initialMessageCount, startupMessage]);







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

        // Preserve the pending message content by converting it to a completed message
        if (pendingMessage) {
          const cancelledMessage: Message = {
            ...pendingMessage,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, cancelledMessage]);
          setPendingMessage(null);
        }

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

    const statusLines: string[] = [];
    const providers: Provider[] = ['claude', 'gemini', 'copilot', 'deepseek', 'cursor'];

    for (const provider of providers) {
      const available = availability.get(provider) || false;
      let status: string;

      if (provider === 'deepseek') {
        status = available ? chalk.green('✓ Built-in (API key set)') : chalk.yellow('⚠ Built-in (API key not set)');
      } else {
        status = available ? chalk.green('✓ Available') : chalk.red('✗ Not found');
      }

      const model = context.getProviderModel(provider);
      statusLines.push(`${provider}: ${status} (model: ${model})`);
    }

    setNotifications([{ type: 'info', message: `Provider Status:\n${statusLines.join('\n')}` }]);
  };

  const handleVerboseCommand = () => {
    const currentVerbose = process.env.GALDR_VERBOSE === '1';
    const newVerbose = !currentVerbose;

    if (newVerbose) {
      process.env.GALDR_VERBOSE = '1';
      verboseLogger.enable();
      setNotifications([{ type: 'success', message: `Verbose mode enabled. Logs will be written to: ${verboseLogger.getLogFilePath()}` }]);
    } else {
      delete process.env.GALDR_VERBOSE;
      verboseLogger.disable();
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
    let messageTimestampCounter = Date.now(); // Ensure unique timestamps for split messages
    let lastSavedContent = ''; // Track last saved content to avoid redundant saves
    let flushedContent = ''; // Track content that's been moved to static area
    let flushedStreamItems: StreamItem[] = []; // Track stream items that have been flushed

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

    // Helper to flush completed content to static area (red box)
    // If forceFlushAll is true, flush everything including incomplete lines
    const flushCompletedContent = (forceFlushAll: boolean = false) => {
      const currentContent = getFullTextContent();

      if (forceFlushAll) {
        // Flush all remaining content, even incomplete lines
        const newContent = currentContent.substring(flushedContent.length);

        if (newContent.trim().length === 0) {
          // No meaningful new content to flush
          if (process.env.GALDR_VERBOSE === '1') {
            verboseLogger.log(`[FLUSH] Force flush requested but no new content`);
          }
          return;
        }

        // Add the flushed content as a completed message in the static area
        messageTimestampCounter++;
        const flushedMessage: Message = {
          role: 'assistant',
          content: newContent,
          timestamp: messageTimestampCounter,
          provider,
          streamItems: [{ type: 'text', text: newContent }],
          isContinuation: flushedContent.length === 0 ? false : true, // Mark as continuation to suppress header/separator
        };

        // Update flushed content tracker FIRST to prevent race conditions
        flushedContent = currentContent;

        if (process.env.GALDR_VERBOSE === '1') {
          verboseLogger.log(`[FLUSH] *** FORCE FLUSHING ALL CONTENT TO STATIC AREA ***`);
          verboseLogger.log(`[FLUSH] Flushing ${newContent.length} chars (including incomplete lines)`);
          verboseLogger.log(`[FLUSH] Content preview: ${newContent.substring(0, 200)}...`);
        }

        setMessages((prev) => [...prev, flushedMessage]);
        return;
      }

      // Normal flush: only flush complete lines (ending with newline)
      const lastNewlineIndex = currentContent.lastIndexOf('\n');

      // Check if there are new complete lines after what we've already flushed
      if (lastNewlineIndex === -1 || lastNewlineIndex < flushedContent.length) {
        // No new complete lines to flush
        if (process.env.GALDR_VERBOSE === '1') {
          verboseLogger.log(`[FLUSH] No new lines to flush. lastNewlineIndex=${lastNewlineIndex}, flushedContent.length=${flushedContent.length}`);
        }
        return;
      }

      // Extract only the NEW content that needs to be flushed
      const newContent = currentContent.substring(flushedContent.length, lastNewlineIndex + 1);

      if (newContent.trim().length === 0) {
        // No meaningful new content to flush
        if (process.env.GALDR_VERBOSE === '1') {
          verboseLogger.log(`[FLUSH] New content is empty/whitespace only`);
        }
        return;
      }

      // Remove trailing newline from flushed content to avoid extra spacing
      const contentToDisplay = newContent.endsWith('\n') ? newContent.slice(0, -1) : newContent;

      // Add the flushed content as a completed message in the static area
      messageTimestampCounter++;
      const flushedMessage: Message = {
        role: 'assistant',
        content: contentToDisplay,
        timestamp: messageTimestampCounter,
        provider,
        streamItems: [{ type: 'text', text: contentToDisplay }],
        isContinuation: flushedContent.length === 0 ? false : true, // Mark as continuation to suppress header/separator
      };

      // Update flushed content tracker FIRST to prevent race conditions
      // (before calling setMessages, so if updatePendingMessage is called again
      // before React re-renders, we won't flush the same content twice)
      flushedContent = currentContent.substring(0, lastNewlineIndex + 1);

      if (process.env.GALDR_VERBOSE === '1') {
        verboseLogger.log(`[FLUSH] *** FLUSHING CONTENT TO STATIC AREA ***`);
        verboseLogger.log(`[FLUSH] Moving ${newContent.split('\n').length - 1} lines to static area`);
        verboseLogger.log(`[FLUSH] New content length: ${newContent.length} chars`);
        verboseLogger.log(`[FLUSH] Total flushed content now: ${flushedContent.length} chars`);
        verboseLogger.log(`[FLUSH] Content preview: ${newContent.substring(0, 200)}...`);
        verboseLogger.log(`[FLUSH] Message timestamp: ${flushedMessage.timestamp}`);
        verboseLogger.log(`[FLUSH] Message content: "${contentToDisplay}"`);
      }

      setMessages((prev) => {
        if (process.env.GALDR_VERBOSE === '1') {
          verboseLogger.log(`[FLUSH] Adding flushed message to static area. prev.length=${prev.length}`);
        }
        return [...prev, flushedMessage];
      });
    };

    // Helper to update pending message
    const updatePendingMessage = async () => {
      const currentContent = getFullTextContent();

      // Save completed content to context
      if (currentContent && currentContent !== lastSavedContent) {
        await saveCompletedContent(currentContent);
      }

      // Flush completed lines to static area
      flushCompletedContent();

      // Only show unflushed content in pending message
      const unflushedContent = currentContent.substring(flushedContent.length);

      if (process.env.GALDR_VERBOSE === '1') {
        verboseLogger.log(`[updatePendingMessage] Total content: ${currentContent.length} chars, flushed: ${flushedContent.length} chars, unflushed: ${unflushedContent.length} chars`);
      }

      // Build unflushed stream items - only include unflushed text
      // Tools are added directly to static area, not shown in pending
      const unflushedStreamItems: StreamItem[] = [];

      // Add unflushed text content if any
      if (unflushedContent.length > 0) {
        unflushedStreamItems.push({ type: 'text', text: unflushedContent });
      }

      // Add only info items (not tools - they go to static area)
      for (const item of accumulatedStreamItems) {
        if (item.type === 'info') {
          unflushedStreamItems.push(item);
        }
      }

      setPendingMessage({
        role: 'assistant',
        content: unflushedContent,
        timestamp: messageTimestampCounter,
        provider,
        streamItems: unflushedStreamItems,
      });
    };



    // Create InkWriter callbacks
    let currentToolId = 0;
    const writerCallbacks: InkWriterCallbacks = {
      onTextChunk: async (chunk: string) => {
        // Update or create text item in stream
        const lastItem = accumulatedStreamItems[accumulatedStreamItems.length - 1];
        if (lastItem && lastItem.type === 'text') {
          // Append to existing text item
          lastItem.text = (lastItem.text || '') + chunk;
        } else {
          // Create new text item
          accumulatedStreamItems.push({ type: 'text' as const, text: chunk });
        }

        // Update the pending message immediately
        await updatePendingMessage();
      },
      onToolUse: async (name: string, parameters?: any) => {
        // When a tool starts, flush all text content (even incomplete lines) to preserve order
        flushCompletedContent(true);

        const toolId = `tool-${currentToolId++}`;
        const toolInfo: ToolInfo = { id: toolId, name, parameters, status: 'running' };
        const newItem = { type: 'tool' as const, tool: toolInfo };
        accumulatedStreamItems.push(newItem);

        // Add the tool as a new message in static area
        messageTimestampCounter++;
        const toolMessage: Message = {
          role: 'assistant',
          content: '',
          timestamp: messageTimestampCounter,
          provider,
          streamItems: [newItem],
          isContinuation: true,
        };

        if (process.env.GALDR_VERBOSE === '1') {
          verboseLogger.log(`[TOOL] Adding tool to static area: ${name}`);
        }

        setMessages((prev) => [...prev, toolMessage]);

        // Update pending to clear out the blue box
        setPendingMessage({
          role: 'assistant',
          content: '',
          timestamp: messageTimestampCounter,
          provider,
          streamItems: [],
        });
      },
      onToolComplete: async (success: boolean) => {
        // Find the last tool item and update its status
        for (let i = accumulatedStreamItems.length - 1; i >= 0; i--) {
          if (accumulatedStreamItems[i].type === 'tool' && accumulatedStreamItems[i].tool) {
            accumulatedStreamItems[i] = {
              ...accumulatedStreamItems[i],
              tool: { ...accumulatedStreamItems[i].tool!, status: success ? 'success' : 'failed' }
            };

            // Update the tool message in static area
            setMessages((prev) => {
              const updated = [...prev];
              // Find the most recent message with this tool
              for (let j = updated.length - 1; j >= 0; j--) {
                if (updated[j].streamItems?.some(item => item.type === 'tool' && item.tool?.id === accumulatedStreamItems[i].tool?.id)) {
                  updated[j] = {
                    ...updated[j],
                    streamItems: [accumulatedStreamItems[i]],
                  };
                  break;
                }
              }
              return updated;
            });

            break;
          }
        }
      },
      onInfo: async (message: string) => {
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

    // Get any remaining unflushed content
    const remainingContent = finalTextContent.substring(flushedContent.length);

    // Build stream items for only the remaining unflushed content
    const remainingStreamItems: StreamItem[] = [];
    if (remainingContent.length > 0) {
      remainingStreamItems.push({ type: 'text', text: remainingContent });
    }

    // Add any info items that haven't been flushed
    for (const item of accumulatedStreamItems) {
      if (item.type === 'info') {
        remainingStreamItems.push(item);
      }
    }

    // Extract tools from stream items (already in static area, just for the tools field)
    const tools = accumulatedStreamItems
      .filter(item => item.type === 'tool')
      .map(item => item.tool!)
      .filter(tool => tool !== undefined);

    // Final update with remaining unflushed content
    messageTimestampCounter++;
    const finalPendingMessage: Message = {
      role: 'assistant',
      content: remainingContent,
      timestamp: messageTimestampCounter,
      provider,
      streamItems: remainingStreamItems,
      tools: tools.length > 0 ? tools : undefined,
    };
    setPendingMessage(finalPendingMessage);

    setIsLoading(false);

    if (result.success) {
      // Only add remaining unflushed content to history (if any)
      if (remainingContent.trim().length > 0) {
        messageTimestampCounter++;
        const completedMessage: Message = {
          role: 'assistant',
          content: remainingContent || result.response || '',
          timestamp: messageTimestampCounter,
          provider,
          streamItems: remainingStreamItems,
          tools: tools.length > 0 ? tools : undefined,
        };

        // Debug logging to track message completion
        if (process.env.GALDR_VERBOSE === '1') {
          verboseLogger.log(`=== MESSAGE COMPLETION DEBUG ===`);
          verboseLogger.log(`Remaining text content length: ${remainingContent.length}`);
          verboseLogger.log(`Flushed content length: ${flushedContent.length}`);
          verboseLogger.log(`Total content length: ${finalTextContent.length}`);
          verboseLogger.log(`STEP 1: About to add final completedMessage to history`);
          verboseLogger.log(`================================`);
        }

        // Add to history
        setMessages((prev) => {
          if (process.env.GALDR_VERBOSE === '1') {
            verboseLogger.log(`STEP 2: setMessages called, adding final completed message`);
            verboseLogger.log(`STEP 2: prev.length=${prev.length}, new length will be ${prev.length + 1}`);
          }
          const newMessages = [...prev, completedMessage];
          if (process.env.GALDR_VERBOSE === '1') {
            verboseLogger.log(`STEP 2: Message added. Total messages now: ${newMessages.length}`);
          }
          return newMessages;
        });
      } else {
        if (process.env.GALDR_VERBOSE === '1') {
          verboseLogger.log(`=== MESSAGE COMPLETION DEBUG ===`);
          verboseLogger.log(`No remaining content to add - all content was flushed during streaming`);
          verboseLogger.log(`Flushed content length: ${flushedContent.length}`);
          verboseLogger.log(`Total content length: ${finalTextContent.length}`);
          verboseLogger.log(`================================`);
        }
      }

      if (process.env.GALDR_VERBOSE === '1') {
        verboseLogger.log(`STEP 3: About to clear pendingMessage`);
      }
      setPendingMessage(null);

      if (process.env.GALDR_VERBOSE === '1') {
        verboseLogger.log(`STEP 4: pendingMessage cleared. Message should now be in history.`);
      }

      // Final save to ensure everything is persisted
      context.save();

      // Handle credit/account limit
      if (result.usageLimitReached) {
        await handleusageLimitReached(provider);
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

      if (result.usageLimitReached) {
        await handleusageLimitReached(provider);
      }
    }

    setAbortController(new AbortController());
  };

  const handleusageLimitReached = async (provider: Provider) => {
    const switchMode = context.getSwitchMode();

    if (switchMode === 'manual') {
      setNotifications([{ type: 'error', message: 'Account credit limit reached. Use /switch <provider> to change providers.' }]);
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
        setNotifications([{ type: 'provider-switch', message: 'Account credit limit reached', from: oldProvider, to: nextProvider }]);
        return;
      }

      nextProvider = providerManager.getNextProvider(nextProvider, 'round-robin');
      attempts++;
    }

    setNotifications([{ type: 'error', message: 'All providers are unavailable or have reached their limits.' }]);
  };



  return (
    <Box flexDirection="column" height="100%">
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
      <Box flexGrow={1} flexShrink={1} flexDirection="column">
        <ContentArea
          currentProvider={currentProvider}
          switchMode={switchMode}
          initialMessageCount={initialMessageCount}
          messages={completedMessages}
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
          inputHistory={inputHistory}
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
        console.error('No AI providers available. Please configure Claude, Gemini, Copilot, Cursor, or set a DeepSeek API key.');
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
    const providers: Provider[] = ['claude', 'gemini', 'copilot', 'cursor', 'deepseek'];
    for (const provider of providers) {
      const available = await this.providerManager.checkAvailability(provider);
      if (available) {
        return provider;
      }
    }
    return null;
  }
}
