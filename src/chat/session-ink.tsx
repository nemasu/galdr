import React, { useState, useEffect, useMemo } from 'react';
import { render, Box, Text, useApp, Static } from 'ink';
import { Provider, SwitchMode, Message } from '../types/index.js';
import { ContextManager } from '../context/manager.js';
import { ProviderManager } from '../providers/index.js';
import { StatusBar } from './components/StatusBar.js';
import { MessageDisplay } from './components/MessageDisplay.js';
import { WelcomeScreen } from './components/WelcomeScreen.js';
import { ProviderBadge } from './components/ProviderBadge.js';
import { ContentArea } from './components/ContentArea.js';
import { KeypressProvider, useKeypress, Key } from './contexts/KeypressContext.js';
import { TextBuffer } from './utils/TextBuffer.js';
import { InputPrompt } from './components/InputPrompt.js';
import { InkWriter, InkWriterCallbacks } from './utils/InkWriter.js';
import { ToolDisplay } from './components/ToolDisplay.js';

interface Notification {
  type: 'info' | 'error' | 'success' | 'provider-switch';
  message: string;
  from?: Provider;
  to?: Provider;
}

interface ToolInfo {
  id: string;
  name: string;
  parameters?: any;
  status: 'running' | 'success' | 'failed';
}

interface ChatAppProps {
  context: ContextManager;
  providerManager: ProviderManager;
  initialPrompt?: string;
}

const ChatApp: React.FC<ChatAppProps> = ({ context, providerManager, initialPrompt }) => {
  const { exit } = useApp();
  const [currentProvider, setCurrentProvider] = useState<Provider>(context.getCurrentProvider());
  const [messages, setMessages] = useState<Message[]>(context.getMessages());
  const [isLoading, setIsLoading] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showWelcome, setShowWelcome] = useState(true);
  const [abortController, setAbortController] = useState(new AbortController());
  const [ctrlCCount, setCtrlCCount] = useState(0);
  const [streamingContent, setStreamingContent] = useState('');
  const [tools, setTools] = useState<ToolInfo[]>([]);

  const buffer = useMemo(() => new TextBuffer(), []);
  const initialMessageCount = useMemo(() => messages.length, []);
  const [initialPromptProcessed, setInitialPromptProcessed] = useState(false);

  // Memoize switch mode to prevent unnecessary re-renders
  const switchMode = useMemo(() => context.getSwitchMode(), [context]);

  // Separate completed messages from the initial count
  const completedMessages = useMemo(() => messages.slice(initialMessageCount), [messages, initialMessageCount]);

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
        <MessageDisplay key={msg.timestamp} message={msg} />
      )),
    [recentHistory]
  );

  // Process initial prompt if provided (after component is fully initialized)
  useEffect(() => {
    if (initialPrompt && !initialPromptProcessed && !isLoading) {
      setInitialPromptProcessed(true);
      handleSubmit(initialPrompt);
    }
  }, [initialPrompt, initialPromptProcessed, isLoading]);

  // Hide welcome screen once messages start appearing
  useEffect(() => {
    if (messages.length > initialMessageCount) {
      setShowWelcome(false);
    }
  }, [messages, initialMessageCount]);

  // Reset Ctrl+C count after 1 second
  useEffect(() => {
    if (ctrlCCount > 0) {
      const timer = setTimeout(() => setCtrlCCount(0), 1000);
      return () => clearTimeout(timer);
    }
  }, [ctrlCCount]);

  // Exit on double Ctrl+C
  useEffect(() => {
    if (ctrlCCount >= 2) {
      if (isLoading) {
        setNotifications([{ type: 'info', message: 'Cancelling current operation...' }]);
        abortController.abort();
        setIsLoading(false);
        setAbortController(new AbortController());
        setCtrlCCount(0);
      } else {
        setNotifications([{ type: 'info', message: 'Exiting chat. Goodbye!' }]);
        setTimeout(() => exit(), 500);
      }
    }
  }, [ctrlCCount, isLoading, abortController, exit]);

  // Global keypress handler for Ctrl+C and Escape
  const handleGlobalKeypress = (key: Key) => {
    // Handle Ctrl+C
    if (key.ctrl && key.name === 'c') {
      setCtrlCCount((prev) => prev + 1);
      return;
    }

    // Handle Escape
    if (key.name === 'escape') {
      if (isLoading) {
        setNotifications([{ type: 'info', message: 'Cancelling current operation...' }]);
        abortController.abort();
        setIsLoading(false);
        setAbortController(new AbortController());
      }
      return;
    }
  };

  useKeypress(handleGlobalKeypress, { isActive: true });

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
            { type: 'error', message: 'Usage: /switch <provider> (claude, gemini, copilot, or cursor)' },
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
        context.clear();
        setMessages([]);
        setShowWelcome(true);
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
        setShowWelcome(true);
        setNotifications([]);
        break;

      case 'verbose':
        handleVerboseCommand();
        break;

      default:
        setNotifications([
          { type: 'error', message: `Unknown command: /${cmd}. Type /help for available commands.` },
        ]);
    }
  };

  const handleSwitchProvider = async (provider: Provider) => {
    if (!['claude', 'gemini', 'copilot', 'cursor'].includes(provider)) {
      setNotifications([{ type: 'error', message: 'Invalid provider. Must be: claude, gemini, copilot, or cursor' }]);
      return;
    }

    const available = await providerManager.checkAvailability(provider);
    if (!available) {
      setNotifications([
        { type: 'error', message: `Provider ${provider} is not available. Please install the CLI tool.` },
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

  const handleCompactCommand = (args: string[]) => {
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

    const result = context.compact(keepCount);

    if (result.compacted) {
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
    const providers: Provider[] = ['claude', 'gemini', 'copilot', 'cursor'];

    for (const provider of providers) {
      const available = availability.get(provider) || false;
      const status = available ? '✓ Available' : '✗ Not found';
      statusLines.push(`${provider}: ${status} (${usage[provider]} requests)`);
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
    setStreamingContent('');
    setTools([]);

    // Add user message
    const userMessage: Message = {
      role: 'user',
      content: userInput,
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);

    // Save user message to context
    const userResult = context.addMessage('user', userInput);

    if (userResult.autoCompacted) {
      setNotifications([{ type: 'info', message: `Auto-compacted history: ${userResult.removed} messages summarized` }]);
    }

    // Execute with current provider from context (to avoid stale closure)
    const provider = context.getCurrentProvider();
    await executeWithProvider(userInput, provider);
  };

  const executeWithProvider = async (prompt: string, provider: Provider) => {
    setIsLoading(true);
    setStreamingContent('');
    setTools([]);

    // Get conversation history
    const conversationHistory = context.getMessages().slice(0, -1);

    // Create InkWriter callbacks
    let currentToolId = 0;
    const writerCallbacks: InkWriterCallbacks = {
      onTextChunk: (chunk: string) => {
        setStreamingContent((prev) => prev + chunk);
      },
      onToolUse: (name: string, parameters?: any) => {
        const toolId = `tool-${currentToolId++}`;
        setTools((prev) => [...prev, { id: toolId, name, parameters, status: 'running' }]);
      },
      onToolComplete: (success: boolean) => {
        setTools((prev) => {
          const newTools = [...prev];
          const lastTool = newTools[newTools.length - 1];
          if (lastTool) {
            lastTool.status = success ? 'success' : 'failed';
          }
          return newTools;
        });
      },
      onInfo: (message: string) => {
        setNotifications([{ type: 'info', message }]);
      },
    };

    const inkWriter = new InkWriter(writerCallbacks);
    inkWriter.activate();

    const providerInstance = providerManager.getProvider(provider);
    providerInstance.setInkWriter(inkWriter);

    const result = await providerInstance.execute(prompt, conversationHistory, undefined, undefined, abortController.signal);

    inkWriter.deactivate();
    setIsLoading(false);

    if (result.success && result.response) {
      // Add assistant response
      const assistantMessage: Message = {
        role: 'assistant',
        content: streamingContent || result.response,
        timestamp: Date.now(),
        provider,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setStreamingContent('');
      setTools([]);

      // Save assistant response to context
      const assistantResult = context.addMessage('assistant', result.response, provider);
      context.incrementProviderUsage(provider);

      if (assistantResult.autoCompacted) {
        setNotifications([
          { type: 'info', message: `Auto-compacted history: ${assistantResult.removed} messages summarized` },
        ]);
      }

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
            setNotifications([
              { type: 'provider-switch', message: 'Round-robin mode', from: provider, to: nextProvider },
            ]);
          }
        }
      }
    } else {
      setNotifications([{ type: 'error', message: result.error || 'Unknown error occurred' }]);
      setStreamingContent('');
      setTools([]);

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
      {/* Main content area - isolated from StatusBar updates */}
      <ContentArea
        showWelcome={showWelcome}
        currentProvider={currentProvider}
        switchMode={switchMode}
        initialMessageCount={initialMessageCount}
        historyItems={historyItems}
        notifications={notifications}
        streamingContent={streamingContent}
        tools={tools}
      />

      {/* Fixed status bar at bottom */}
      <StatusBar provider={currentProvider} isLoading={isLoading} />

      {/* Input prompt */}
      <InputPrompt buffer={buffer} onSubmit={handleSubmit} isActive={!isLoading} />
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
    const { waitUntilExit } = render(
      <KeypressProvider>
        <ChatApp context={this.context} providerManager={this.providerManager} initialPrompt={initialPrompt} />
      </KeypressProvider>,
      {
        exitOnCtrlC: false, // We handle Ctrl+C manually
      }
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
