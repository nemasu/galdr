import { Provider, SwitchMode } from '../types';
import { ContextManager } from '../context/manager';
import { ConfigManager } from '../config/manager';
import { ProviderManager } from '../providers';
import { ChatUI } from './ui';
import chalk from 'chalk';

export class ChatSession {
  private context: ContextManager;
  private config: ConfigManager;
  private providerManager: ProviderManager;
  private ui: ChatUI;
  private currentProvider: Provider;
  private isRunning: boolean = false;

  constructor() {
    this.context = new ContextManager();
    this.config = new ConfigManager();
    this.providerManager = new ProviderManager();
    this.ui = new ChatUI();
    this.currentProvider = this.context.getCurrentProvider();
  }

  private showWelcomeScreen(): void {
    const messageCount = this.context.getMessages().length;
    this.ui.showWelcome(this.currentProvider, this.config.getSwitchMode(), messageCount);
  }

  public async start(initialPrompt?: string): Promise<void> {
    // Check if current provider is available
    const isAvailable = await this.providerManager.checkAvailability(this.currentProvider);
    if (!isAvailable) {
      // Try to find an available provider
      const available = await this.findAvailableProvider();
      if (!available) {
        console.log(
          chalk.red('No AI providers available. Please install Claude, Gemini, or Copilot CLI.')
        );
        return;
      }
      this.currentProvider = available;
      this.context.setCurrentProvider(available);
    }

    this.showWelcomeScreen();

    // If there's an initial prompt, process it
    if (initialPrompt) {
      await this.handleUserInput(initialPrompt);
    }

    // Start interactive loop
    this.isRunning = true;
    this.startInteractiveLoop();
  }

  private async findAvailableProvider(): Promise<Provider | null> {
    const providers: Provider[] = ['claude', 'gemini', 'copilot'];
    for (const provider of providers) {
      const available = await this.providerManager.checkAvailability(provider);
      if (available) {
        return provider;
      }
    }
    return null;
  }

  private startInteractiveLoop(): void {
    const rl = this.ui.createInterface();

    rl.on('line', async (input: string) => {
      const trimmed = input.trim();

      if (!trimmed) {
        rl.prompt();
        return;
      }

      // Handle commands
      if (trimmed.startsWith('/')) {
        await this.handleCommand(trimmed);
        if (this.isRunning) {
          rl.prompt();
        }
        return;
      }

      // Handle regular chat input
      await this.handleUserInput(trimmed);
      rl.prompt();
    });

    rl.on('close', () => {
      this.stop();
    });

    rl.prompt();
  }

  private async handleCommand(command: string): Promise<void> {
    const parts = command.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'exit':
      case 'quit':
        this.ui.showInfo('Goodbye!');
        this.stop();
        break;

      case 'switch':
        if (args.length === 0) {
          this.ui.showError('Usage: /switch <provider> (claude, gemini, or copilot)');
          return;
        }
        await this.handleSwitchProvider(args[0] as Provider);
        break;

      case 'mode':
        if (args.length === 0) {
          this.ui.showError('Usage: /mode <mode> (manual, rollover, or round-robin)');
          return;
        }
        await this.handleSwitchMode(args[0] as SwitchMode);
        break;

      case 'clear':
        this.context.clear();
        this.ui.clearScreen();
        this.showWelcomeScreen();
        this.ui.showSuccess('Chat history cleared');
        break;

      case 'compact':
        await this.handleCompactCommand(args);
        break;

      case 'history':
        this.handleHistoryCommand();
        break;

      case 'status':
        await this.handleStatusCommand();
        break;

      case 'help':
        this.showWelcomeScreen();
        break;

      default:
        this.ui.showError(`Unknown command: /${cmd}. Type /help for available commands.`);
    }
  }

  private async handleSwitchProvider(provider: Provider): Promise<void> {
    if (!['claude', 'gemini', 'copilot'].includes(provider)) {
      this.ui.showError('Invalid provider. Must be: claude, gemini, or copilot');
      return;
    }

    const available = await this.providerManager.checkAvailability(provider);
    if (!available) {
      this.ui.showError(`Provider ${provider} is not available. Please install the CLI tool.`);
      return;
    }

    const oldProvider = this.currentProvider;
    this.currentProvider = provider;
    this.context.setCurrentProvider(provider);
    this.ui.showProviderSwitch(oldProvider, provider, 'Manual provider switch');
  }

  private async handleSwitchMode(mode: SwitchMode): Promise<void> {
    if (!['manual', 'rollover', 'round-robin'].includes(mode)) {
      this.ui.showError('Invalid mode. Must be: manual, rollover, or round-robin');
      return;
    }

    const oldMode = this.config.getSwitchMode();
    this.config.setSwitchMode(mode);
    this.context.setSwitchMode(mode);

    this.ui.showSuccess(`Switch mode changed from ${oldMode} to ${mode}`);

    // Show explanation of the new mode
    const explanations = {
      manual: 'You will be notified when token limits are reached but must manually switch providers',
      rollover: 'Automatically switches to the next provider when token limit is reached',
      'round-robin': 'Cycles through all providers for each request',
    };

    this.ui.showInfo(explanations[mode]);
  }

  private async handleStatusCommand(): Promise<void> {
    const availability = await this.providerManager.checkAllAvailability();
    const usage = this.context.getProviderUsage();
    this.ui.showProviderStatus(availability, usage);
  }

  private async handleCompactCommand(args: string[]): Promise<void> {
    const keepCount = args.length > 0 ? parseInt(args[0]) : 10;

    if (isNaN(keepCount) || keepCount < 1) {
      this.ui.showError('Invalid keep count. Must be a positive number.');
      return;
    }

    const messagesBefore = this.context.getMessages().length;

    if (messagesBefore <= keepCount) {
      this.ui.showInfo(`History has ${messagesBefore} messages. No compaction needed.`);
      return;
    }

    const result = this.context.compact(keepCount);

    if (result.compacted) {
      this.ui.showSuccess(`Compacted ${result.removed} messages, kept ${keepCount} recent messages`);
    } else {
      this.ui.showInfo('No compaction needed.');
    }
  }

  private handleHistoryCommand(): void {
    const stats = this.context.getHistoryStats();
    const autoCompactEnabled = this.context.isAutoCompactEnabled();
    const threshold = this.context.getAutoCompactThreshold();

    this.ui.showHistoryStats(stats, autoCompactEnabled, threshold);
  }

  private async handleUserInput(input: string): Promise<void> {
    this.ui.showUserMessage(input);

    // Save user message
    const userResult = this.context.addMessage('user', input);

    // Show auto-compact notification if it happened
    if (userResult.autoCompacted) {
      this.ui.showInfo(`Auto-compacted history: ${userResult.removed} messages summarized`);
    }

    // Execute with current provider
    await this.executeWithProvider(input, this.currentProvider);
  }

  private async executeWithProvider(prompt: string, provider: Provider): Promise<void> {
    this.ui.showAssistantMessageStart(provider);

    // Get conversation history (excluding the current user message we just added)
    const messages = this.context.getMessages();
    const conversationHistory = messages.slice(0, -1);

    const providerInstance = this.providerManager.getProvider(provider);
    const result = await providerInstance.execute(prompt, conversationHistory);

    if (result.success && result.response) {
      // Save assistant response
      const assistantResult = this.context.addMessage('assistant', result.response, provider);
      this.context.incrementProviderUsage(provider);

      this.ui.showAssistantMessageEnd();

      // Show auto-compact notification if it happened
      if (assistantResult.autoCompacted) {
        this.ui.showInfo(`Auto-compacted history: ${assistantResult.removed} messages summarized`);
      }

      // Check if we need to switch providers
      if (result.tokenLimitReached) {
        await this.handleTokenLimitReached(provider);
      }
    } else {
      this.ui.showError(result.error || 'Unknown error occurred');

      if (result.tokenLimitReached) {
        await this.handleTokenLimitReached(provider);
      }
    }
  }

  private async handleTokenLimitReached(provider: Provider): Promise<void> {
    const switchMode = this.config.getSwitchMode();

    if (switchMode === 'manual') {
      this.ui.showError('Token limit reached. Use /switch <provider> to change providers.');
      return;
    }

    // Find next available provider
    let nextProvider = this.providerManager.getNextProvider(provider, 'round-robin');
    let attempts = 0;
    const maxAttempts = 2; // Try up to 2 other providers

    while (attempts < maxAttempts) {
      const available = await this.providerManager.checkAvailability(nextProvider);
      if (available) {
        const oldProvider = this.currentProvider;
        this.currentProvider = nextProvider;
        this.context.setCurrentProvider(nextProvider);
        this.ui.showProviderSwitch(oldProvider, nextProvider, 'Token limit reached');
        return;
      }

      nextProvider = this.providerManager.getNextProvider(nextProvider, 'round-robin');
      attempts++;
    }

    this.ui.showError('All providers are unavailable or have reached their limits.');
  }

  public stop(): void {
    this.isRunning = false;
    this.ui.closeInterface();
    process.exit(0);
  }
}
