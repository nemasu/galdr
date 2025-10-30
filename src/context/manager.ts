import fs from 'fs';
import path from 'path';
import { ConversationContext, Message, Provider, SwitchMode } from '../types/index.js';
import { MessageSummarizer } from './summarizer.js';
import { SessionManager } from './session.js';
import { UserConfigManager } from '../config/userConfig.js';

const CONTEXT_DIR = '.galdr';
const CONTEXT_FILE = 'context.json';
const AUTO_COMPACT_THRESHOLD = 50; // Auto-compact when messages exceed this
const AUTO_COMPACT_KEEP = 20; // Keep this many recent messages
const DEFAULT_SESSION = 'default';

export class ContextManager {
  private contextPath: string;
  private context: ConversationContext;
  private autoCompactEnabled: boolean = true;
  private summarizer: MessageSummarizer;
  private sessionManager: SessionManager;
  private lastSaveTime: number = 0;
  private saveThrottleMs: number = 500; // Throttle saves to at most once every 500ms
  private pendingSave: boolean = false;
  private userConfig: UserConfigManager;

  constructor(workingDir: string = process.cwd()) {
    this.contextPath = path.join(workingDir, CONTEXT_DIR);
    this.ensureContextDir();
    this.userConfig = new UserConfigManager();
    this.sessionManager = new SessionManager(workingDir, this.userConfig);
    this.context = this.loadContext();
    this.summarizer = new MessageSummarizer();
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
    const currentSessionName = this.sessionManager.getCurrentSessionName();

    // Try to load the current session
    let context = this.sessionManager.loadSession(currentSessionName);

    // If session doesn't exist, create it
    if (!context) {
      if (!this.sessionManager.sessionExists(currentSessionName)) {
        this.sessionManager.createSession(currentSessionName);
      }
      context = this.sessionManager.loadSession(currentSessionName);
    }

    // Fallback to default context if all else fails
    return context || this.createDefaultContext();
  }

  private createDefaultContext(): ConversationContext {
    return {
      messages: [],
      currentProvider: this.userConfig.getDefaultProvider() || 'claude', // Default: try claude first
      switchMode: this.userConfig.getDefaultMode() || 'manual', // Default: manual switching
      providerModels: {
        claude: this.userConfig.getDefaultModel('claude') || 'default',
        gemini: this.userConfig.getDefaultModel('gemini') || 'default',
        copilot: this.userConfig.getDefaultModel('copilot') || 'default',
        deepseek: this.userConfig.getDefaultModel('deepseek') || 'default',
        cursor: this.userConfig.getDefaultModel('cursor') || 'default',
      },
    };
  }

  public save(): void {
    const currentSessionName = this.sessionManager.getCurrentSessionName();
    this.sessionManager.saveSession(currentSessionName, this.context);
  }

  // Throttled save to prevent excessive file writes
  private throttledSave(): void {
    const now = Date.now();
    
    // If enough time has passed since last save, save immediately
    if (now - this.lastSaveTime >= this.saveThrottleMs) {
      this.save();
      this.lastSaveTime = now;
      this.pendingSave = false;
      return;
    }
    
    // Otherwise, schedule a save for later if not already pending
    if (!this.pendingSave) {
      this.pendingSave = true;
      const delay = this.saveThrottleMs - (now - this.lastSaveTime);
      setTimeout(() => {
        if (this.pendingSave) {
          this.save();
          this.lastSaveTime = Date.now();
          this.pendingSave = false;
        }
      }, delay);
    }
  }

  public async addMessage(role: 'user' | 'assistant', content: string, provider?: Provider): Promise<{ autoCompacted: boolean; removed: number; error?: string }> {
    this.context.messages.push({
      role,
      content,
      timestamp: Date.now(),
      provider,
    });
    this.save();

    // Auto-compact if threshold is exceeded
    if (this.autoCompactEnabled && this.context.messages.length > AUTO_COMPACT_THRESHOLD) {
      const result = await this.compact(AUTO_COMPACT_KEEP);
      return { autoCompacted: result.compacted, removed: result.removed, error: result.error };
    }

    return { autoCompacted: false, removed: 0 };
  }

  // Update the last assistant message content (for incremental streaming)
  public updateLastAssistantMessage(content: string, provider?: Provider): boolean {
    if (this.context.messages.length === 0) {
      return false;
    }

    const lastMessage = this.context.messages[this.context.messages.length - 1];
    
    // Only update if the last message is from the assistant and matches the provider
    if (lastMessage.role === 'assistant' && (!provider || lastMessage.provider === provider)) {
      lastMessage.content = content;
      this.throttledSave();
      return true;
    }

    return false;
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

  public clear(): void {
    this.context.messages = [];
    this.save();
  }

  public getConversationHistory(): string {
    return this.context.messages
      .map((msg) => `[${msg.role}${msg.provider ? ` - ${msg.provider}` : ''}]: ${msg.content}`)
      .join('\n\n');
  }

  // Compact context by summarizing older messages
  public async compact(keepLast: number = 10): Promise<{ compacted: boolean; removed: number; error?: string }> {
    if (this.context.messages.length > keepLast) {
      const recentMessages = this.context.messages.slice(-keepLast);
      const oldMessages = this.context.messages.slice(0, -keepLast);

      try {
        // Generate summary using LLM
        const summaryContent = await this.summarizer.summarize(oldMessages);

        // Create a summary message
        const summary: Message = {
          role: 'assistant',
          content: summaryContent,
          timestamp: Date.now(),
        };

        this.context.messages = [summary, ...recentMessages];
        this.save();

        return { compacted: true, removed: oldMessages.length };
      } catch (error) {
        // If summarization fails, don't modify history
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return { compacted: false, removed: 0, error: errorMessage };
      }
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

  public setProviderModel(provider: Provider, model: string): void {
    if (!this.context.providerModels) {
      this.context.providerModels = {
        claude: 'default',
        gemini: 'default',
        copilot: 'default',
        deepseek: 'default',
        cursor: 'default',
      };
    }
    this.context.providerModels[provider] = model;
    this.save();
  }

  public getProviderModel(provider: Provider): string {
    if (!this.context.providerModels) {
      this.context.providerModels = {
        claude: 'default',
        gemini: 'default',
        copilot: 'default',
        deepseek: 'default',
        cursor: 'default',
      };
      this.save();
    }
    return this.context.providerModels[provider] || 'default';
  }

  // Session management methods
  public getCurrentSessionName(): string {
    return this.sessionManager.getCurrentSessionName();
  }

  public listSessions() {
    return this.sessionManager.listSessions();
  }

  public createSession(sessionName: string, description?: string): boolean {
    return this.sessionManager.createSession(sessionName, description, this.context.currentProvider);
  }

  public switchSession(sessionName: string): boolean {
    // Save current session before switching
    this.save();

    // Switch to new session
    if (!this.sessionManager.switchSession(sessionName)) {
      return false;
    }

    // Load new session context
    this.context = this.loadContext();
    return true;
  }

  public deleteSession(sessionName: string): boolean {
    return this.sessionManager.deleteSession(sessionName);
  }

  public renameSession(oldName: string, newName: string): boolean {
    return this.sessionManager.renameSession(oldName, newName);
  }

  public getSessionMetadata(sessionName: string) {
    return this.sessionManager.getSessionMetadata(sessionName);
  }

  public updateSessionDescription(sessionName: string, description: string): boolean {
    return this.sessionManager.updateSessionDescription(sessionName, description);
  }
}
