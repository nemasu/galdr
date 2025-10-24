import { ProviderResult } from '../types/index.js';
import { BaseProvider } from './base.js';
import chalk from 'chalk';

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

  getCommand(): string {
    // Gemini uses piped input, so no --prompt flag or -- needed
    return 'gemini --approval-mode yolo --output-format stream-json';
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
                // Skip writing this chunk to avoid spinner/output conflict
                break;
              }
              // Stream assistant messages in real-time
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

  detectTokenLimit(output: string): boolean {
    // Check for rate limit errors (429) and resource exhaustion
    const errorPatterns = [
      /Session limit reached/i,
      //TODO figure out the actual messages and add them here
    ];

    if (process.env.GALDR_VERBOSE) {
      console.error(chalk.dim(`[VERBOSE] Gemini detectTokenLimit checking output length: ${output.length}`));
      const matched = errorPatterns.find((pattern) => pattern.test(output));
      if (matched) {
        console.error(chalk.dim(`[VERBOSE] Gemini token limit detected with pattern: ${matched}`));
      } else {
        console.error(chalk.dim(`[VERBOSE] Gemini no token limit pattern matched`));
      }
    }

    return errorPatterns.some((pattern) => pattern.test(output));
  }
}
