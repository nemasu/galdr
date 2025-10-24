import chalk from 'chalk';
import { Provider } from '../types';
import readline from 'readline';

export class ChatUI {
  private rl: readline.Interface | null = null;
  private termWidth: number;
  private termHeight: number;

  constructor() {
    this.termWidth = process.stdout.columns || 80;
    this.termHeight = process.stdout.rows || 24;

    // Update dimensions on resize
    process.stdout.on('resize', () => {
      this.termWidth = process.stdout.columns || 80;
      this.termHeight = process.stdout.rows || 24;
    });
  }

  public createInterface(): readline.Interface {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('You> '),
    });
    return this.rl;
  }

  public closeInterface(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  public showWelcome(provider: Provider, switchMode: string, messageCount: number = 0): void {
    console.clear();

    // Top border
    const borderLine = '═'.repeat(this.termWidth);
    console.log(chalk.bold.blue(borderLine));

    // Title
    const title = 'GALDR';
    const titlePadding = Math.floor((this.termWidth - title.length) / 2);
    console.log(chalk.bold.white(' '.repeat(titlePadding) + title));
    console.log(chalk.bold.blue(borderLine));
    console.log();

    // Status section
    const providerBadge = this.getProviderBadge(provider);
    console.log(chalk.gray('  Active Provider: ') + providerBadge + chalk.gray('  │  Switch Mode: ') + chalk.yellow(switchMode));

    if (messageCount > 0) {
      console.log(chalk.gray('  Context: ') + chalk.green(`${messageCount} messages restored`));
    }

    console.log();
    console.log(chalk.bold('  Commands:'));
    console.log(chalk.gray('    /exit, /quit       ') + chalk.white('Exit chat'));
    console.log(chalk.gray('    /switch <provider> ') + chalk.white('Switch provider (claude, gemini, copilot)'));
    console.log(chalk.gray('    /mode <mode>       ') + chalk.white('Set switch mode (manual, rollover, round-robin)'));
    console.log(chalk.gray('    /clear             ') + chalk.white('Clear chat history'));
    console.log(chalk.gray('    /compact [keep]    ') + chalk.white('Compact history, keep N recent messages (default: 10)'));
    console.log(chalk.gray('    /history           ') + chalk.white('Show history statistics'));
    console.log(chalk.gray('    /status            ') + chalk.white('Show provider status'));
    console.log(chalk.gray('    /help              ') + chalk.white('Show this help'));
    console.log();
    console.log(chalk.blue('─'.repeat(this.termWidth)));
    console.log();
  }

  public getProviderBadge(provider: Provider): string {
    switch (provider) {
      case 'claude':
        return chalk.bgMagenta.white.bold(' CLAUDE ');
      case 'gemini':
        return chalk.bgBlue.white.bold(' GEMINI ');
      case 'copilot':
        return chalk.bgGreen.white.bold(' COPILOT ');
    }
  }

  public getProviderColor(provider: Provider): chalk.Chalk {
    switch (provider) {
      case 'claude':
        return chalk.magenta;
      case 'gemini':
        return chalk.blue;
      case 'copilot':
        return chalk.green;
    }
  }

  public showUserMessage(message: string): void {
    console.log();
    console.log(chalk.cyan.bold('You:'));
    console.log(chalk.white(message));
    console.log();
  }

  public showAssistantMessageStart(provider: Provider): void {
    const badge = this.getProviderBadge(provider);
    const color = this.getProviderColor(provider);
    console.log(color.bold(`${badge}:`));
  }

  public showAssistantMessageEnd(): void {
    console.log();
    console.log(chalk.blue('─'.repeat(this.termWidth)));
    console.log();
  }

  public showProviderSwitch(from: Provider, to: Provider, reason: string): void {
    console.log();
    console.log(chalk.yellow('⚠ ' + reason));
    console.log(
      chalk.yellow(`  Switching from ${this.getProviderBadge(from)} to ${this.getProviderBadge(to)}`)
    );
    console.log();
  }

  public showError(message: string): void {
    console.log();
    console.log(chalk.red('✗ Error: ') + chalk.white(message));
    console.log();
  }

  public showInfo(message: string): void {
    console.log();
    console.log(chalk.blue('ℹ ') + chalk.white(message));
    console.log();
  }

  public showSuccess(message: string): void {
    console.log();
    console.log(chalk.green('✓ ') + chalk.white(message));
    console.log();
  }

  public showProviderStatus(
    availability: Map<Provider, boolean>,
    usage: { claude: number; gemini: number; copilot: number }
  ): void {
    console.log();
    console.log(chalk.bold('Provider Status:'));
    console.log();

    const providers: Provider[] = ['claude', 'gemini', 'copilot'];
    for (const provider of providers) {
      const available = availability.get(provider) || false;
      const status = available ? chalk.green('✓ Available') : chalk.red('✗ Not found');
      const usageCount = usage[provider];
      const badge = this.getProviderBadge(provider);

      console.log(`  ${badge} ${status} ${chalk.gray(`(${usageCount} requests)`)}`);
    }
    console.log();
  }

  public clearScreen(): void {
    console.clear();
  }

  public showHistoryStats(stats: {
    messageCount: number;
    totalChars: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
  }, autoCompactEnabled: boolean, threshold: number): void {
    console.log();
    console.log(chalk.bold('History Statistics:'));
    console.log();
    console.log(chalk.gray('  Messages:        ') + chalk.white(stats.messageCount));
    console.log(chalk.gray('  Total characters:') + chalk.white(` ${stats.totalChars.toLocaleString()}`));

    if (stats.oldestTimestamp && stats.newestTimestamp) {
      const duration = stats.newestTimestamp - stats.oldestTimestamp;
      const hours = Math.floor(duration / (1000 * 60 * 60));
      const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
      console.log(chalk.gray('  Conversation age:') + chalk.white(` ${hours}h ${minutes}m`));
    }

    console.log();
    console.log(chalk.gray('  Auto-compact:    ') +
      (autoCompactEnabled ? chalk.green('Enabled') : chalk.red('Disabled')) +
      chalk.gray(` (threshold: ${threshold} messages)`));

    if (stats.messageCount > threshold * 0.8) {
      const remaining = threshold - stats.messageCount;
      console.log();
      console.log(chalk.yellow(`  ⚠ Warning: Approaching auto-compact threshold (${remaining} messages remaining)`));
    }

    console.log();
  }
}
