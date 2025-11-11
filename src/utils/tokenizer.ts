import { AutoTokenizer, env } from '@huggingface/transformers';
import { join } from 'path';

// Lazy import for verbose logger to handle test environment
let verboseLogger: any;

function getVerboseLogger() {
  if (!verboseLogger) {
    try {
      // Try to import the logger normally
      const loggerModule = require('./logger.js');
      verboseLogger = loggerModule.verboseLogger;
    } catch (error) {
      // Fallback for test environment or when logger is not available
      verboseLogger = {
        log: (message: string) => {
          // In test environment, we don't want verbose logging
          // This is a no-op fallback
        }
      };
    }
  }
  return verboseLogger;
}

/**
 * Tokenizer utility for estimating token counts using actual DeepSeek tokenizer
 */
export class Tokenizer {
  private static instance: Tokenizer;
  private tokenizer: any = null;
  private initialized: boolean = false;

  private constructor() {}

  public static getInstance(): Tokenizer {
    if (!Tokenizer.instance) {
      Tokenizer.instance = new Tokenizer();
    }
    return Tokenizer.instance;
  }

  /**
   * Initialize the tokenizer with DeepSeek V3 tokenizer files
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Disable remote model loading to ensure we only use local files
      env.allowRemoteModels = false;
      
      // Load tokenizer from local directory - use relative path from project root
      const tokenizerDir = join(process.cwd(), 'src/deepseek_v3_tokenizer');
      this.tokenizer = await AutoTokenizer.from_pretrained(tokenizerDir);
      
      this.initialized = true;
    } catch (error) {
      getVerboseLogger().log(`Failed to initialize DeepSeek tokenizer, falling back to character-based estimation: ${error}`);
      this.initialized = true; // Mark as initialized to prevent repeated attempts
    }
  }

  /**
   * Estimate token count for a given text using actual tokenizer
   * @param text The text to tokenize
   * @returns Estimated token count
   */
  public async estimateTokenCount(text: string): Promise<number> {
    await this.initialize();

    if (this.tokenizer) {
      try {
        const encoded = await this.tokenizer(text);
        // The input_ids is a Tensor, we need to get the size from dimensions
        // Tensor dimensions are in encoded.input_ids.dims
        const tokenCount = encoded.input_ids.dims[1] || encoded.input_ids.dims[0];
        return tokenCount;
      } catch (error) {
        getVerboseLogger().log(`Tokenizer failed, falling back to character-based estimation: ${error}`);
        // Fallback to character-based estimation
        return Math.ceil(text.length / 4);
      }
    }

    // Fallback to character-based estimation
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate token count for an array of messages
   * @param messages Array of messages with role and content
   * @returns Total estimated token count
   */
  public async estimateMessagesTokenCount(
    messages: Array<{ role: string; content: string | any; tool_calls?: any[]; tool_call_id?: string }>
  ): Promise<number> {
    await this.initialize();

    let totalTokens = 0;

    for (const message of messages) {
      try {
        // Add tokens for role
        const roleTokens = await this.estimateTokenCount(message.role);
        totalTokens += roleTokens;
        
        // Add tokens for content
        if (typeof message.content === 'string') {
          const contentTokens = await this.estimateTokenCount(message.content);
          totalTokens += contentTokens;
        } else if (Array.isArray(message.content)) {
          // Handle complex content arrays (like tool calls)
          for (const item of message.content) {
            if (typeof item === 'string') {
              const itemTokens = await this.estimateTokenCount(item);
              totalTokens += itemTokens;
            } else if (item && typeof item === 'object') {
              // Handle object content by stringifying
              const itemTokens = await this.estimateTokenCount(JSON.stringify(item));
              totalTokens += itemTokens;
            }
          }
        } else if (message.content && typeof message.content === 'object') {
          // Handle object content by stringifying
          const contentTokens = await this.estimateTokenCount(JSON.stringify(message.content));
          totalTokens += contentTokens;
        }

        // Add tokens for tool calls if present
        if (message.tool_calls && Array.isArray(message.tool_calls)) {
          for (const toolCall of message.tool_calls) {
            const toolCallTokens = await this.estimateTokenCount(JSON.stringify(toolCall));
            totalTokens += toolCallTokens;
          }
        }

        // Add tokens for tool_call_id if present
        if (message.tool_call_id) {
          const toolCallIdTokens = await this.estimateTokenCount(message.tool_call_id);
          totalTokens += toolCallIdTokens;
        }
      } catch (error) {
        getVerboseLogger().log(`Error estimating tokens for message: ${error}`);
        // Continue with other messages even if one fails
      }
    }

    return totalTokens;
  }

  /**
   * Get a quick estimation without async initialization
   * Useful for cases where async initialization is not possible
   * @param text The text to estimate
   * @returns Rough token count estimation
   */
  public quickEstimate(text: string): number {
    // Simple estimation: ~4 characters per token for English text
    // This is a rough approximation but works reasonably well
    return Math.ceil(text.length / 4);
  }

  /**
   * Quick estimation for messages array
   * @param messages Array of messages
   * @returns Rough total token count
   */
  public quickEstimateMessages(
    messages: Array<{ role: string; content: string | any; tool_calls?: any[]; tool_call_id?: string }>
  ): number {
    let totalTokens = 0;

    for (const message of messages) {
      // Add tokens for role
      totalTokens += this.quickEstimate(message.role);
      
      // Add tokens for content
      if (typeof message.content === 'string') {
        totalTokens += this.quickEstimate(message.content);
      } else if (Array.isArray(message.content)) {
        for (const item of message.content) {
          if (typeof item === 'string') {
            totalTokens += this.quickEstimate(item);
          } else if (item && typeof item === 'object') {
            totalTokens += this.quickEstimate(JSON.stringify(item));
          }
        }
      } else if (message.content && typeof message.content === 'object') {
        totalTokens += this.quickEstimate(JSON.stringify(message.content));
      }

      // Add tokens for tool calls if present
      if (message.tool_calls && Array.isArray(message.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          totalTokens += this.quickEstimate(JSON.stringify(toolCall));
        }
      }

      // Add tokens for tool_call_id if present
      if (message.tool_call_id) {
        totalTokens += this.quickEstimate(message.tool_call_id);
      }
    }

    return totalTokens;
  }
}

// Export a singleton instance
export const tokenizer = Tokenizer.getInstance();