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

  getCommand(model?: string): string {
    const baseCommand = 'copilot --allow-all-tools --stream on';
    if (model && model !== 'default') {
      return `${baseCommand} --model ${model}`;
    }
    return baseCommand;
  }

  parseOutput(output: string): ProviderResult {
    return {
      success: true,
      response: output,
    };
  }

  // Override to always display stdout in real-time (not just verbose mode)
  protected handleChildProcess(
    child: any,
    onStream: ((chunk: string) => void) | undefined,
    resolve: (value: ProviderResult) => void,
    signal?: AbortSignal
  ): void {
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`copilot stdout chunk (${chunk.length} bytes):\n${chunk}`);
      }
      if (onStream) {
        onStream(chunk);
      }
      this.handleStreamChunk(chunk);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`copilot stderr chunk (${chunk.length} bytes):\n${chunk}`);
      }
      if (process.env.DEBUG) {
        process.stderr.write(chunk);
      }
    });

    child.on('close', (code: number) => {
      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`========== COPILOT RESPONSE COMPLETE ==========`);
        this.showVerbose(`Process exited with code: ${code}`);
        this.showVerbose(`Full stdout (${stdout.length} bytes):\n${stdout}`);
        this.showVerbose(`Full stderr (${stderr.length} bytes):\n${stderr}`);
        this.showVerbose(`================================================`);
      }
      if (code !== 0) {
        const combinedOutput = stdout + stderr;
        resolve({
          success: false,
          error: stderr || `Command exited with code ${code}`,
          response: combinedOutput,
        });
      } else {
        const parsed = this.parseOutput(stdout);
        resolve(parsed);
      }
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        child.kill();
      });
    }
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

      // Output the text exactly as received
      // Only add newline if this isn't the last line (which means there was a \n after it in the chunk)
      if (this.inkWriter) {
        if (!isLastLine && line) {
          // There was a newline after this line in the chunk, and line has content - preserve it
          this.inkWriter.writeText(line + '\n');
        } else if (line) {
          // Last line with content - output as-is without adding newline
          this.inkWriter.writeText(line);
        }
        // Skip empty lines (both trailing and in the middle of the stream)
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
