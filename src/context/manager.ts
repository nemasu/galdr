import fs from 'fs';
import path from 'path';
import { ConversationContext, Message, Provider, SwitchMode } from '../types/index.js';

const CONTEXT_DIR = '.galdr';
const CONTEXT_FILE = 'context.json';
const AUTO_COMPACT_THRESHOLD = 50; // Auto-compact when messages exceed this
const AUTO_COMPACT_KEEP = 20; // Keep this many recent messages

export class ContextManager {
  private contextPath: string;
  private context: ConversationContext;
  private autoCompactEnabled: boolean = true;

  constructor(workingDir: string = process.cwd()) {
    this.contextPath = path.join(workingDir, CONTEXT_DIR);
    this.ensureContextDir();
    this.context = this.loadContext();
  }

  private ensureContextDir(): void {
    if (!fs.existsSync(this.contextPath)) {
      fs.mkdirSync(this.contextPath, { recursive: true });
    }
  }

  private getContextFilePath(): string {
    return path.join(this.contextPath, CONTEXT_FILE);
  }

  private loadContext(): ConversationContext {
    const filePath = this.getContextFilePath();

    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
      } catch (error) {
        console.error('Error loading context, creating new one:', error);
      }
    }

    return this.createDefaultContext();
  }

  private createDefaultContext(): ConversationContext {
    return {
      messages: [],
      currentProvider: 'claude', // Default: try claude first
      switchMode: 'manual', // Default: manual switching
      providerUsage: {
        claude: 0,
        gemini: 0,
        copilot: 0,
        cursor: 0,
      },
    };
  }

  public save(): void {
    const filePath = this.getContextFilePath();
    fs.writeFileSync(filePath, JSON.stringify(this.context, null, 2));
  }

  public addMessage(role: 'user' | 'assistant', content: string, provider?: Provider): { autoCompacted: boolean; removed: number } {
    this.context.messages.push({
      role,
      content,
      timestamp: Date.now(),
      provider,
    });
    this.save();

    // Auto-compact if threshold is exceeded
    if (this.autoCompactEnabled && this.context.messages.length > AUTO_COMPACT_THRESHOLD) {
      const result = this.compact(AUTO_COMPACT_KEEP);
      return { autoCompacted: result.compacted, removed: result.removed };
    }

    return { autoCompacted: false, removed: 0 };
  }

  public getMessages(): Message[] {
    return this.context.messages;
  }

  public getCurrentProvider(): Provider {
    return this.context.currentProvider;
  }

  public setCurrentProvider(provider: Provider): void {
    this.context.currentProvider = provider;
    this.save();
  }

  public getSwitchMode(): SwitchMode {
    return this.context.switchMode;
  }

  public setSwitchMode(mode: SwitchMode): void {
    this.context.switchMode = mode;
    this.save();
  }

  public incrementProviderUsage(provider: Provider): void {
    this.context.providerUsage[provider]++;
    this.save();
  }

  public getProviderUsage(): { claude: number; gemini: number; copilot: number; cursor: number } {
    return this.context.providerUsage;
  }

  public clear(): void {
    this.context.messages = [];
    this.context.providerUsage = {
      claude: 0,
      gemini: 0,
      copilot: 0,
      cursor: 0,
    };
    this.save();
  }

  public getConversationHistory(): string {
    return this.context.messages
      .map((msg) => `[${msg.role}${msg.provider ? ` - ${msg.provider}` : ''}]: ${msg.content}`)
      .join('\n\n');
  }

  // Compact context by summarizing older messages
  public compact(keepLast: number = 10): { compacted: boolean; removed: number } {
    if (this.context.messages.length > keepLast) {
      const recentMessages = this.context.messages.slice(-keepLast);
      const oldMessages = this.context.messages.slice(0, -keepLast);

      // Create a summary of old messages
      const summary: Message = {
        role: 'assistant',
        content: `[Context compacted: ${oldMessages.length} messages summarized]`,
        timestamp: Date.now(),
      };

      this.context.messages = [summary, ...recentMessages];
      this.save();

      return { compacted: true, removed: oldMessages.length };
    }

    return { compacted: false, removed: 0 };
  }

  // Get history statistics
  public getHistoryStats(): {
    messageCount: number;
    totalChars: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
  } {
    const messages = this.context.messages;
    const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);

    return {
      messageCount: messages.length,
      totalChars,
      oldestTimestamp: messages.length > 0 ? messages[0].timestamp : null,
      newestTimestamp: messages.length > 0 ? messages[messages.length - 1].timestamp : null,
    };
  }

  // Toggle auto-compact
  public setAutoCompact(enabled: boolean): void {
    this.autoCompactEnabled = enabled;
  }

  public isAutoCompactEnabled(): boolean {
    return this.autoCompactEnabled;
  }

  public getAutoCompactThreshold(): number {
    return AUTO_COMPACT_THRESHOLD;
  }
}
