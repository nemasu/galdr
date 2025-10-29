import { BaseProvider } from './base.js';
import { ProviderResult, Message } from '../types/index.js';
import { UserConfigManager } from '../config/userConfig.js';
import { getToolDefinitions, executeTool, ToolDefinition } from '../tools/index.js';
import chalk from 'chalk';

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{type: string; text?: string; tool_use_id?: string; content?: string}>;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

interface DeepSeekRequest {
  model: string;
  messages: DeepSeekMessage[];
  stream: boolean;
  tools?: ToolDefinition[];
}

interface DeepSeekStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    delta: {
      content?: string;
      role?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    index: number;
    finish_reason: string | null;
  }>;
}

export class DeepSeekProvider extends BaseProvider {
  private apiKey: string | undefined;
  private baseUrl: string = 'https://api.deepseek.com';
  private configManager: UserConfigManager;

  constructor() {
    super('deepseek');
    this.configManager = new UserConfigManager();
    // Try config file first, fallback to environment variable
    this.apiKey = this.configManager.getApiKey('deepseek') || process.env.DEEPSEEK_API_KEY;
  }


  // These methods are required by the abstract class but only used for availability checking
  getCommand(model?: string): string {
    // Return a dummy command - not actually used since we override execute()
    return 'echo';
  }

  parseOutput(output: string): ProviderResult {
    // Not used in our API-based implementation, but required by abstract class
    return {
      success: true,
      response: output,
      tokenLimitReached: false,
    };
  }

  detectTokenLimit(output: string): boolean {
    // Check for DeepSeek-specific token limit errors
    return false; // Temporary because we're working on this file.
    
  }

  private convertMessages(messages: Message[]): DeepSeekMessage[] {
    return messages.map(msg => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content
    }));
  }

  private async streamResponse(
    messages: DeepSeekMessage[],
    model: string,
    onStream?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<ProviderResult> {
    const request: DeepSeekRequest = {
      model,
      messages,
      stream: true,
      tools: getToolDefinitions(),
    };

    if (process.env.GALDR_VERBOSE) {
      this.showVerbose(`========== DEEPSEEK API REQUEST ==========`);
      this.showVerbose(`Model: ${model}`);
      this.showVerbose(`Messages count: ${messages.length}`);
      this.showVerbose(`Request body: ${JSON.stringify(request, null, 2)}`);
      this.showVerbose(`========================================`);
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(request),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (process.env.GALDR_VERBOSE) {
          this.showVerbose(`API error response: ${errorText}`);
        }
        return {
          success: false,
          error: `DeepSeek API error: ${response.status} ${response.statusText}\n${errorText}`,
          tokenLimitReached: this.detectTokenLimit(errorText),
        };
      }

      if (!response.body) {
        return {
          success: false,
          error: 'No response body from DeepSeek API',
          tokenLimitReached: false,
        };
      }

      let fullResponse = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const toolCalls: Array<{id: string; name: string; arguments: string}> = [];
      let currentToolCall: {id?: string; name?: string; arguments: string} | null = null;
      let currentToolIndex = -1;

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;

            if (trimmedLine.startsWith('data: ')) {
              const jsonStr = trimmedLine.slice(6); // Remove 'data: ' prefix
              try {
                const chunk: DeepSeekStreamChunk = JSON.parse(jsonStr);
                const delta = chunk.choices[0]?.delta;
                const content = delta?.content;
                const toolCallDeltas = delta?.tool_calls;
                const finishReason = chunk.choices[0]?.finish_reason;

                if (content) {
                  fullResponse += content;
                  if (onStream) {
                    onStream(content);
                  }
                  this.handleStreamChunk(content);
                }

                // Handle tool calls
                if (toolCallDeltas && toolCallDeltas.length > 0) {
                  for (const toolCallDelta of toolCallDeltas) {
                    const index = toolCallDelta.index;

                    // New tool call
                    if (index !== currentToolIndex) {
                      // Save previous tool call if exists
                      if (currentToolCall && currentToolCall.id && currentToolCall.name) {
                        toolCalls.push({
                          id: currentToolCall.id,
                          name: currentToolCall.name,
                          arguments: currentToolCall.arguments
                        });
                      }

                      // Start new tool call
                      currentToolIndex = index;
                      currentToolCall = {
                        id: toolCallDelta.id,
                        name: toolCallDelta.function?.name,
                        arguments: toolCallDelta.function?.arguments || ''
                      };
                    } else {
                      // Continue existing tool call
                      if (currentToolCall) {
                        if (toolCallDelta.id) currentToolCall.id = toolCallDelta.id;
                        if (toolCallDelta.function?.name) currentToolCall.name = toolCallDelta.function.name;
                        if (toolCallDelta.function?.arguments) {
                          currentToolCall.arguments += toolCallDelta.function.arguments;
                        }
                      }
                    }
                  }
                }

                // If we got finish_reason === 'tool_calls', save the last tool call
                if (finishReason === 'tool_calls' && currentToolCall && currentToolCall.id && currentToolCall.name) {
                  toolCalls.push({
                    id: currentToolCall.id,
                    name: currentToolCall.name,
                    arguments: currentToolCall.arguments
                  });
                }
              } catch (parseError) {
                if (process.env.GALDR_VERBOSE) {
                  this.showVerbose(`Failed to parse SSE chunk: ${jsonStr}`);
                }
              }
            }
          }
        }
      } catch (error: any) {
        // Check if it's an abort error
        if (error.name === 'AbortError') {
          return {
            success: false,
            error: 'Operation cancelled',
            tokenLimitReached: false,
          };
        }

        // Handle stream termination errors
        if (error.message && (
          error.message.includes('terminated') ||
          error.message.includes('aborted') ||
          error.message.includes('closed') ||
          error.message.includes('network')
        )) {
          // Always output detailed termination information
          console.error('\n═══════════════════════════════════════════════════════════════');
          console.error('DeepSeek API Stream Termination Error');
          console.error('═══════════════════════════════════════════════════════════════');
          console.error('Error Message:', error.message);
          console.error('Error Type:', error.name || 'Unknown');
          console.error('Error Stack:', error.stack || 'No stack trace available');
          console.error('───────────────────────────────────────────────────────────────');
          console.error('Request Details:');
          console.error('  Model:', this.model);
          console.error('  API URL:', this.baseUrl);
          console.error('  Messages Count:', messages.length);
          console.error('  Last Message Role:', messages[messages.length - 1]?.role || 'N/A');
          console.error('  Last Message Length:', messages[messages.length - 1]?.content?.length || 0);
          console.error('───────────────────────────────────────────────────────────────');
          console.error('Response State:');
          console.error('  Partial Response Received:', fullResponse.length > 0 ? 'Yes' : 'No');
          console.error('  Partial Response Length:', fullResponse.length, 'characters');
          console.error('  Tool Calls Collected:', toolCalls.length);
          console.error('  Current Buffer:', buffer ? `"${buffer.substring(0, 100)}${buffer.length > 100 ? '...' : ''}"` : 'Empty');
          console.error('───────────────────────────────────────────────────────────────');
          console.error('Possible Causes:');
          console.error('  • Network connectivity issues');
          console.error('  • DeepSeek API rate limiting');
          console.error('  • Server-side timeout or overload');
          console.error('  • Request payload too large');
          console.error('  • API key issues');
          console.error('═══════════════════════════════════════════════════════════════\n');

          // If we have a partial response, return it
          if (fullResponse.length > 0) {
            console.error(`⚠️  Returning partial response (${fullResponse.length} characters)\n`);
            return {
              success: true,
              response: fullResponse,
              tokenLimitReached: false,
            };
          }

          // Otherwise, return the error
          return {
            success: false,
            error: `DeepSeek API connection terminated: ${error.message}. See detailed error output above.`,
            tokenLimitReached: false,
          };
        }

        throw error;
      }

      // Execute tool calls if any
      if (toolCalls.length > 0) {
        if (process.env.GALDR_VERBOSE) {
          this.showVerbose(`Executing ${toolCalls.length} tool call(s)`);
        }

        // Add assistant message with tool calls to conversation
        const assistantMessage: DeepSeekMessage = {
          role: 'assistant',
          content: fullResponse || '',
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments
            }
          }))
        };
        messages.push(assistantMessage);

        // Execute each tool and add results
        for (const toolCall of toolCalls) {
          try {
            const args = JSON.parse(toolCall.arguments);
            const result = await executeTool(
              toolCall.name,
              args,
              this.inkWriter,
              (toolName: string) => this.shouldDisplayTool(toolName)
            );

            // Add tool result message
            messages.push({
              role: 'tool',
              content: result,
              tool_call_id: toolCall.id
            });
          } catch (error: any) {
            messages.push({
              role: 'tool',
              content: `Error executing tool: ${error.message}`,
              tool_call_id: toolCall.id
            });
          }
        }

        // Make another API call with tool results
        return this.streamResponse(messages, model, onStream, signal);
      }

      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`========== DEEPSEEK RESPONSE COMPLETE ==========`);
        this.showVerbose(`Response length: ${fullResponse.length} characters`);
        this.showVerbose(`===============================================`);
      }

      return {
        success: true,
        response: fullResponse,
        tokenLimitReached: false,
      };
    } catch (error: any) {
      // Check if it's an abort error
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Operation cancelled',
          tokenLimitReached: false,
        };
      }

      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`DeepSeek API error: ${error.message}`);
      }
      return {
        success: false,
        error: `DeepSeek API request failed: ${error.message}`,
        tokenLimitReached: false,
      };
    }
  }

  public async execute(
    prompt: string,
    conversationHistory: Message[] = [],
    onStream?: (chunk: string) => void,
    onFirstChunk?: () => void,
    signal?: AbortSignal
  ): Promise<ProviderResult> {
    // Reset for each execution
    this.firstChunkReceived = false;
    this.onFirstChunk = onFirstChunk;

    if (!this.apiKey) {
      return {
        success: false,
        error: 'DeepSeek API key is not set. Please set it using: galdr config --set-key deepseek <your-api-key>',
        tokenLimitReached: false,
      };
    }

    // Convert conversation history to DeepSeek format
    const messages = this.convertMessages(conversationHistory);

    // Add system message if this is the first message (no conversation history)
    if (conversationHistory.length === 0) {
      messages.unshift({
        role: 'system',
        content: `You are a helpful AI coding assistant with access to powerful development tools. You can:

File Operations:
- Read files: Use read_file to examine file contents
- Write files: Use write_file to create or overwrite files
- Edit files: Use edit_file to make precise changes by replacing text
- List directories: Use list_directory to see what files and folders exist

Search & Discovery:
- Find in files: Use find_in_files to search for plain text patterns across files
- Grep: Use grep for regex pattern matching with context lines (more powerful than find_in_files)
- Glob: Use glob to find files matching patterns (e.g., "**/*.ts", "src/**/*.js")

Web Operations:
- Google Search: Use google_search to search the web for information, documentation, or solutions
  * Useful for finding current documentation, Stack Overflow solutions, or recent information
  * Returns titles, URLs, and snippets for relevant results
  * Best for questions requiring external knowledge or up-to-date information
  * Automatically falls back to DuckDuckGo if credentials are missing or API quota is exceeded
- DuckDuckGo Search: Use duckduckgo_search as an alternative web search (no API key required)
  * Works out of the box with no configuration needed
  * Returns titles, URLs, and descriptions for relevant results
  * Automatically used as fallback when Google Search is unavailable
  * Supports regional search (us-en, uk-en, de-de, etc.)
- Fetch Page: Use fetch_page to retrieve and extract readable content from web pages
  * Extracts main content using Mozilla's Readability algorithm
  * Returns title, author, text content, and excerpt
  * Works best with articles, documentation, blog posts, and Stack Overflow answers
  * Use after google_search or duckduckgo_search to read the full content of search results

Command Execution:
- Execute bash: Use execute_bash to run shell commands (npm, git, tests, builds, etc.)
  * Platform: Runs cmd.exe on Windows, /bin/sh on Unix/Linux/macOS
  * Prefer cross-platform commands: npm, git, node, python
  * OS-specific commands: Use 'dir' on Windows, 'ls' on Unix; 'type' on Windows, 'cat' on Unix

Best Practices:
- Always read files before editing them to understand the current content
- Use edit_file for targeted changes rather than rewriting entire files
- Use grep for complex pattern searches with regex support
- Use glob to discover files by patterns before reading them
- Use execute_bash for running tests, builds, git operations, and system commands
- When using execute_bash, prefer cross-platform commands (npm, git) over OS-specific ones
- Use google_search or duckduckgo_search when you need current documentation, API references, or solutions to problems
- Use fetch_page to read the full content of web pages found via search results
- Provide clear, concise responses
- Use the tools proactively to help solve the user's problems

The working directory is: ${process.cwd()}`
      });
    }

    // Add the current prompt as a user message
    messages.push({
      role: 'user',
      content: prompt,
    });

    // Use the model if set, otherwise use default
    const model = (this.model && this.model !== 'default') ? this.model : 'deepseek-chat';

    return this.streamResponse(messages, model, onStream, signal);
  }

  public async checkAvailability(): Promise<boolean> {
    // DeepSeek is available if the API key is set
    // We could also make a test API call, but checking the env var is faster
    return !!this.apiKey;
  }
}
