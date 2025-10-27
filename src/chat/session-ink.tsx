import React, { useState, useEffect, useMemo, useRef } from 'react';
import { render, Box, Text, useApp, Static } from 'ink';
import { Provider, SwitchMode, Message, ToolInfo, StreamItem } from '../types/index.js';
import { ContextManager } from '../context/manager.js';
import { ProviderManager } from '../providers/index.js';
import { WelcomeScreen } from './components/WelcomeScreen.js';
import { ProviderBadge } from './components/ProviderBadge.js';
import { ContentArea } from './components/ContentArea.js';
import { OutputItem } from './components/OutputItem.js';
import { KeypressProvider, useKeypress, Key } from './contexts/KeypressContext.js';
import { TextBuffer } from './utils/TextBuffer.js';
import { InputArea } from './components/InputArea.js';
import { InkWriter, InkWriterCallbacks } from './utils/InkWriter.js';
import { findLastSafeSplitPoint, getAccumulatedText } from './utils/messageSplitting.js';

interface Notification {
  type: 'info' | 'error' | 'success' | 'provider-switch';
  message: string;
  from?: Provider;
  to?: Provider;
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
  const [streamingItems, setStreamingItems] = useState<StreamItem[]>([]);

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
        <OutputItem key={msg.timestamp} message={msg} />
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

      case 'model':
        handleModelCommand(args);
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

    if (!['claude', 'gemini', 'copilot', 'cursor'].includes(provider)) {
      setNotifications([{ type: 'error', message: 'Invalid provider. Must be: claude, gemini, copilot, or cursor' }]);
      return;
    }

    context.setProviderModel(provider, model);
    setNotifications([{ type: 'success', message: `Model for ${provider} set to: ${model}` }]);
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
    setStreamingItems([]);

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
    setStreamingItems([]);
    setNotifications([]); // Clear any notifications before streaming starts

    // Get conversation history
    const conversationHistory = context.getMessages().slice(0, -1);

    // Use a local variable to track streaming items to avoid stale closure issues
    let accumulatedStreamItems: StreamItem[] = [];
    let updateTimeoutId: NodeJS.Timeout | null = null;
    let pendingUpdate = false;
    const SPLIT_THRESHOLD = 2000; // Split messages larger than 2000 chars

    // Throttled update function to batch re-renders
    const scheduleUpdate = () => {
      if (pendingUpdate) return;
      pendingUpdate = true;

      if (updateTimeoutId) {
        clearTimeout(updateTimeoutId);
      }

      updateTimeoutId = setTimeout(() => {
        setStreamingItems([...accumulatedStreamItems]);
        pendingUpdate = false;
        updateTimeoutId = null;
      }, 16); // ~60fps
    };

    // Helper to split and move completed portion to messages
    const splitAndMoveToMessages = () => {
      const accumulatedText = getAccumulatedText(accumulatedStreamItems);
      const splitPoint = findLastSafeSplitPoint(accumulatedText);

      // Only split if we found a valid split point (not at the end)
      if (splitPoint >= accumulatedText.length || splitPoint === 0) {
        return; // No valid split point
      }

      // Find which items and where to split
      let charCount = 0;
      let splitItemIndex = -1;
      let splitWithinItemAt = -1;

      for (let i = 0; i < accumulatedStreamItems.length; i++) {
        const item = accumulatedStreamItems[i];
        if (item.type === 'text' && item.text) {
          const itemLength = item.text.length;
          if (charCount + itemLength >= splitPoint) {
            // Split point is within this item
            splitItemIndex = i;
            splitWithinItemAt = splitPoint - charCount;
            break;
          }
          charCount += itemLength;
        }
      }

      if (splitItemIndex === -1) return; // Shouldn't happen, but safety check

      // Create items for completed message
      const completedItems: StreamItem[] = [];
      for (let i = 0; i < splitItemIndex; i++) {
        completedItems.push(accumulatedStreamItems[i]);
      }

      // Split the text item at splitItemIndex
      const splitItem = accumulatedStreamItems[splitItemIndex];
      if (splitItem.type === 'text' && splitItem.text) {
        const beforeText = splitItem.text.substring(0, splitWithinItemAt);
        const afterText = splitItem.text.substring(splitWithinItemAt);

        if (beforeText) {
          completedItems.push({ type: 'text' as const, text: beforeText });
        }

        // Keep remaining items (including afterText and everything after)
        const remainingItems: StreamItem[] = [];
        if (afterText) {
          remainingItems.push({ type: 'text' as const, text: afterText });
        }
        for (let i = splitItemIndex + 1; i < accumulatedStreamItems.length; i++) {
          remainingItems.push(accumulatedStreamItems[i]);
        }

        // Create completed message and add to messages
        if (completedItems.length > 0) {
          const completedText = completedItems
            .filter(item => item.type === 'text')
            .map(item => item.text || '')
            .join('');

          const completedTools = completedItems
            .filter(item => item.type === 'tool')
            .map(item => item.tool!)
            .filter(tool => tool !== undefined);

          const completedMessage: Message = {
            role: 'assistant',
            content: completedText,
            timestamp: Date.now(),
            provider,
            tools: completedTools.length > 0 ? completedTools : undefined,
            streamItems: completedItems,
          };

          // Add to messages (will render in Static component)
          setMessages((prev) => [...prev, completedMessage]);

          // Keep only remaining items for continued streaming
          accumulatedStreamItems = remainingItems;
        }
      }
    };

    // Create InkWriter callbacks
    let currentToolId = 0;
    const writerCallbacks: InkWriterCallbacks = {
      onTextChunk: (chunk: string) => {
        // Accumulate text into the last item if it's also text
        const lastItem = accumulatedStreamItems[accumulatedStreamItems.length - 1];
        if (lastItem && lastItem.type === 'text') {
          lastItem.text = (lastItem.text || '') + chunk;
        } else {
          accumulatedStreamItems.push({ type: 'text' as const, text: chunk });
        }

        // Check if we should split the message
        const accumulatedText = getAccumulatedText(accumulatedStreamItems);
        if (accumulatedText.length > SPLIT_THRESHOLD) {
          splitAndMoveToMessages();
        }

        scheduleUpdate();
      },
      onToolUse: (name: string, parameters?: any) => {
        const toolId = `tool-${currentToolId++}`;
        const toolInfo: ToolInfo = { id: toolId, name, parameters, status: 'running' };
        const newItem = { type: 'tool' as const, tool: toolInfo };
        accumulatedStreamItems.push(newItem);
        scheduleUpdate();
      },
      onToolComplete: (success: boolean) => {
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
        scheduleUpdate();
      },
      onInfo: (message: string) => {
        const newItem = { type: 'info' as const, info: message };
        accumulatedStreamItems.push(newItem);
        scheduleUpdate();
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

    // Clear any pending timeout and do final update
    if (updateTimeoutId) {
      clearTimeout(updateTimeoutId);
      updateTimeoutId = null;
    }
    setStreamingItems([...accumulatedStreamItems]);

    setIsLoading(false);

    if (result.success && result.response) {
      // Extract text and tools from the accumulated items (not state) to avoid stale closure
      const finalStreamItems = accumulatedStreamItems;
      const textContent = finalStreamItems
        .filter(item => item.type === 'text')
        .map(item => item.text || '')
        .join('');

      const tools = finalStreamItems
        .filter(item => item.type === 'tool')
        .map(item => item.tool!)
        .filter(tool => tool !== undefined);

      // Add assistant response with tools
      const assistantMessage: Message = {
        role: 'assistant',
        content: textContent || result.response,
        timestamp: Date.now(),
        provider,
        tools: tools.length > 0 ? tools : undefined,
        streamItems: finalStreamItems.length > 0 ? finalStreamItems : undefined,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setStreamingItems([]);
      setNotifications([]); // Clear any notifications from streaming

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
            setNotifications((prev) => [
              ...prev,
              { type: 'provider-switch', message: 'Round-robin mode', from: provider, to: nextProvider },
            ]);
          }
        }
      }
    } else {
      setNotifications([{ type: 'error', message: result.error || 'Unknown error occurred' }]);
      setStreamingItems([]);

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
      {/* Main output area - displays all messages, tools, and notifications */}
      <ContentArea
        showWelcome={showWelcome}
        currentProvider={currentProvider}
        switchMode={switchMode}
        initialMessageCount={initialMessageCount}
        historyItems={historyItems}
        notifications={notifications}
        streamingItems={streamingItems}
      />

      {/* Input area - includes provider badge and text input */}
      <InputArea
        buffer={buffer}
        onSubmit={handleSubmit}
        isActive={!isLoading}
        provider={currentProvider}
        isLoading={isLoading}
      />
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
