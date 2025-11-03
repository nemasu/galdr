import { ProviderResult, Message } from '../types/index.js';
import { BaseProvider } from './base.js';

interface StreamEvent {
  type: string;
  role?: string;
  content?: string;
  delta?: boolean;
  status?: string;
  stats?: any;
  tool_name?: string;
  tool_id?: string;
  parameters?: any;
  output?: string;
}

export class GeminiProvider extends BaseProvider {
  constructor() {
    super('gemini');
  }

  getCommand(model?: string): string {
    const baseCommand = 'gemini --approval-mode yolo --output-format stream-json';
    if (model && model !== 'default') {
      return `${baseCommand} --model ${model}`;
    }
    return baseCommand;
  }

  parseOutput(output: string): ProviderResult {
    // Parse stream-json output line by line
    const lines = output.trim().split('\n');
    let fullResponse = '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event: StreamEvent = JSON.parse(line);

        // Accumulate assistant messages
        if (event.type === 'message' && event.role === 'assistant' && event.content) {
          fullResponse += event.content;
        }
      } catch (e) {
        // If JSON parsing fails, treat as plain text
        fullResponse = output;
        break;
      }
    }

    return {
      success: true,
      response: fullResponse || output,
    };
  }

  // Override to handle streaming display
  protected handleStreamChunk(chunk: string): void {
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event: StreamEvent = JSON.parse(line);

        switch (event.type) {
          case 'init':
            // Session initialization - silent or minimal output
            break;

          case 'message':
            if (event.role === 'assistant' && event.content) {
              // Stop spinner on first actual text content
              if (!this.firstChunkReceived && this.onFirstChunk) {
                this.onFirstChunk();
                this.firstChunkReceived = true;
              }
              // Stream assistant messages in real-time (don't skip first chunk!)
              if (this.inkWriter) {
                this.inkWriter.writeText(event.content);
              }
            }
            break;

          case 'tool_use':
            // Show tool usage in a nice format
            const toolName = event.tool_name || 'unknown';
            if (this.shouldDisplayTool(toolName)) {
              if (this.inkWriter) {
                this.inkWriter.showTool(toolName, event.parameters);
              }
            }
            break;

          case 'tool_result':
            // Show tool completion
            if (this.inkWriter) {
              this.inkWriter.completeTool(event.status === 'success');
            }
            break;

          case 'result':
            // Final result with stats - just add a newline
            if (event.status === 'success' && this.inkWriter) {
              this.inkWriter.writeText('\n');
            }
            break;
        }
      } catch (e) {
        // Not JSON, might be debug output (YOLO mode, credentials, etc.)
        // Skip these lines silently - they're not part of the actual response
      }
    }
  }

  isUsageLimitReached(output: string, httpStatus?: number): boolean {
    // Google Gemini uses HTTP 429 for rate limits and quota limits
    if (httpStatus === 429) {
      return true;
    }
    
    // Also check for Gemini-specific session limit and quota error messages
    const errorPatterns = [
      /Session limit reached/i,
      /quota.*exceeded/i,
      /billing.*limit/i,
    ];

    if (process.env.GALDR_VERBOSE) {
      this.showVerbose(`Gemini isUsageLimitReached checking output length: ${output.length}`);
      const matched = errorPatterns.find((pattern) => pattern.test(output));
      if (matched) {
        this.showVerbose(`Gemini usage limit detected with pattern: ${matched}`);
      } else {
        this.showVerbose(`Gemini no usage limit pattern matched`);
      }
    }

    return errorPatterns.some((pattern) => pattern.test(output));
  }

  public async execute(
    prompt: string, 
    conversationHistory: Message[] = [], 
    onStream?: (chunk: string) => void, 
    onFirstChunk?: () => void, 
    signal?: AbortSignal
  ): Promise<ProviderResult> {
    // Call the base execute method
    const result = await super.execute(prompt, conversationHistory, onStream, onFirstChunk, signal);
    
    // Check for context limits in the error output
    if (!result.success && result.error) {
      const contextLimitReached = this.detectContextLimit(result.error);
      
      if (contextLimitReached) {
        // Update the error to indicate it's a context limit issue
        return {
          ...result,
          error: `Context limit exceeded: ${result.error}`,
        };
      }
    }
    
    return result;
  }
}
