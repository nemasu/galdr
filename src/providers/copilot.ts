import { ProviderResult } from '../types/index.js';
import { BaseProvider } from './base.js';
import chalk from 'chalk';

interface StreamEvent {
  type: string;
  subtype?: string;
  message?: {
    content: Array<{ type: string; text?: string; name?: string; input?: any }>;
  };
  result?: string;
  tool_name?: string;
  tool_id?: string;
  parameters?: any;
  status?: string;
}

export class CopilotProvider extends BaseProvider {
  constructor() {
    super('copilot');
  }

  getCommand(): string {
    // Use -- to terminate option parsing, preventing conversation history from being interpreted as flags
    return 'copilot --allow-all-tools --stream on';
  }

  parseOutput(output: string): ProviderResult {
    return {
      success: true,
      response: output,
    };
  }

  // Override to handle streaming display
  protected handleStreamChunk(chunk: string): void {
    const lines = chunk.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLastLine = i === lines.length - 1;

      // Try to parse as JSON event
      if (line.trim()) {
        try {
          const event: StreamEvent = JSON.parse(line);

          switch (event.type) {
            case 'tool_use':
              // Show tool usage
              const toolName = event.tool_name || 'unknown';
              if (this.shouldDisplayTool(toolName) && this.inkWriter) {
                this.inkWriter.showTool(toolName, event.parameters);
              }
              break;

            case 'tool_result':
              // Show tool completion
              if (this.inkWriter) {
                this.inkWriter.completeTool(event.status === 'success');
              }
              break;

            default:
              // Other JSON events - skip silently
              break;
          }
          continue; // Successfully parsed as JSON, skip text output
        } catch (e) {
          // Not JSON, will output as plain text below
        }
      }

      // Output as plain text (actual content or empty line)
      // Stop spinner on first actual text content
      if (line.trim() && !this.firstChunkReceived && this.onFirstChunk) {
        this.onFirstChunk();
        this.firstChunkReceived = true;
      }

      // Output line with newline, unless it's the last incomplete line
      if (this.inkWriter) {
        if (!isLastLine) {
          this.inkWriter.writeText(line + '\n');
        } else if (line) {
          this.inkWriter.writeText(line);
        }
      }
    }
  }

  detectTokenLimit(output: string): boolean {
    // Only check for actual error messages, not mentions in regular text
    const errorPatterns = [
      /token limit exceeded/i,
      //TODO add these as you find them
    ];

    return errorPatterns.some((pattern) => pattern.test(output));
  }
}
