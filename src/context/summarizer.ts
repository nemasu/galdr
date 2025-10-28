import { Message, Provider } from '../types/index.js';
import { ProviderManager } from '../providers/index.js';

export class MessageSummarizer {
  private providerManager: ProviderManager;

  constructor() {
    this.providerManager = new ProviderManager();
  }

  /**
   * Get the first available LLM provider in the priority order: claude, gemini, copilot, cursor
   */
  private async getFirstAvailableProvider(): Promise<Provider | null> {
    const priorityOrder: Provider[] = ['claude', 'gemini', 'copilot', 'cursor'];

    for (const provider of priorityOrder) {
      const available = await this.providerManager.checkAvailability(provider);
      if (available) {
        return provider;
      }
    }

    return null;
  }

  /**
   * Summarize a list of messages into a single summary string
   * @throws Error if no LLM provider is available
   */
  public async summarize(messages: Message[]): Promise<string> {
    const provider = await this.getFirstAvailableProvider();

    if (!provider) {
      throw new Error('Unable to summarize: No LLM provider available. Please install one of: claude, gemini, copilot, or cursor CLI tools.');
    }

    try {
      const providerInstance = this.providerManager.getProvider(provider);

      // Construct a prompt to summarize the conversation
      const conversationText = messages
        .map((msg) => `[${msg.role}${msg.provider ? ` - ${msg.provider}` : ''}]: ${msg.content}`)
        .join('\n\n');

      const summarizationPrompt = `Please provide a concise summary of the following conversation history. Focus on the key topics, decisions, and context that would be important to retain for future reference. Keep the summary under 300 words.

Conversation history:
${conversationText}

Summary:`;

      // Execute the provider with no conversation history (this is a standalone request)
      const result = await providerInstance.execute(summarizationPrompt, []);

      if (result.success && result.response) {
        return `[Summarized ${messages.length} messages using ${provider}]\n\n${result.response.trim()}`;
      } else {
        throw new Error(`Failed to generate summary using ${provider}: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to summarize messages: ${error}`);
    }
  }
}
