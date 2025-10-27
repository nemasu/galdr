import { ProviderResult } from "../types/index.js";
import { BaseProvider } from "./base.js";
import chalk from "chalk";

interface StreamEvent {
  type: string;
  subtype?: string;
  message?: {
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: any;
      tool_use_id?: string;
      content?: string | Array<{ type: string; text?: string }>;
    }>;
  };
  result?: string;
}

export class ClaudeProvider extends BaseProvider {
  constructor() {
    super("claude");
  }

  getCommand(model?: string): string {
    const baseCommand = "claude --print --permission-mode bypassPermissions --output-format stream-json --verbose";
    if (model && model !== 'default') {
      return `${baseCommand} --model ${model}`;
    }
    return baseCommand;
  }

  parseOutput(output: string): ProviderResult {
    // Parse stream-json output line by line
    const lines = output.trim().split("\n");
    let textContent: string[] = [];
    let finalResult = "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event: StreamEvent = JSON.parse(line);

        // Extract text from assistant messages
        if (event.type === "assistant" && event.message?.content) {
          for (const content of event.message.content) {
            if (content.type === "text" && content.text) {
              textContent.push(content.text);
            }
          }
        }

        // Extract final result (this is usually empty for Claude Code)
        if (event.type === "result" && event.result) {
          finalResult = event.result;
        }
      } catch (e) {
        // If JSON parsing fails, treat as plain text
        finalResult = output;
        break;
      }
    }

    // Prefer accumulated text content, then result, then raw output
    const response = textContent.join("") || finalResult || output;

    return {
      success: true,
      response: response,
    };
  }

  // Override to handle streaming display
  protected handleStreamChunk(chunk: string): void {
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;

      // Skip any line that looks like tool result JSON
      if (line.includes('"type":"user"') || line.includes('"tool_result"')) {
        continue;
      }

      try {
        const event: StreamEvent = JSON.parse(line);

        switch (event.type) {
          case "system":
            // System events - silently handle initialization
            break;

          case "assistant":
            if (event.message?.content) {
              for (const content of event.message.content) {
                if (content.type === "text" && content.text) {
                  // Stop spinner on first actual text content
                  if (!this.firstChunkReceived && this.onFirstChunk) {
                    this.onFirstChunk();
                    this.firstChunkReceived = true;
                  }
                  // Write the text chunk (don't skip it!)
                  if (this.inkWriter) {
                    this.inkWriter.writeText(content.text);
                  }
                } else if (content.type === "tool_use" && content.name) {
                  // Only show the tool indicator if shouldDisplayTool returns true
                  if (this.shouldDisplayTool(content.name) && this.inkWriter) {
                    this.inkWriter.showTool(content.name, content.input);
                  }
                }
              }
            }
            break;

          case "user":
            // Tool results - silently skip
            break;

          case "result":
            // Final result - already captured in parseOutput
            break;
        }
        // Successfully parsed JSON - don't output it raw
      } catch (e) {
        // Not JSON - skip it entirely to avoid garbage output
      }
    }
  }

  detectTokenLimit(output: string): boolean {
    // Check for actual error messages and JSON error flags
    const errorPatterns = [
      // Claude CLI specific session limit message
      /Session limit reached/i,
    ];

    const matched = errorPatterns.some((pattern) => {
      const isMatch = pattern.test(output);
      if (isMatch) {
        console.error(
          chalk.dim(`[DEBUG] Token limit pattern matched: ${pattern}`)
        );
        const match = output.match(pattern);
        if (match) {
          console.error(chalk.dim(`[DEBUG] Matched text: ${match[0]}`));
        }
      }
      return isMatch;
    });

    return matched;
  }
}
