import { BaseProvider } from "./base.js";
import { ProviderResult, Message } from "../types/index.js";
import { UserConfigManager } from "../config/userConfig.js";
import {
  getToolDefinitions,
  executeTool,
  ToolDefinition,
} from "../tools/index.js";

interface DeepSeekMessage {
  role: "system" | "user" | "assistant" | "tool";
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        tool_use_id?: string;
        content?: string;
      }>;
  tool_calls?: Array<{
    id: string;
    type: "function";
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
  tool_choice: "none" | "auto" | "required";
  temperature: number;
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
        type?: "function";
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
  private baseUrl: string = "https://api.deepseek.com";
  private configManager: UserConfigManager;

  constructor() {
    super("deepseek");
    this.configManager = new UserConfigManager();
    // Try config file first, fallback to environment variable
    this.apiKey =
      this.configManager.getApiKey("deepseek") || process.env.DEEPSEEK_API_KEY;
  }

  // These methods are required by the abstract class but only used for availability checking
  getCommand(model?: string): string {
    // Return a dummy command - not actually used since we override execute()
    return "echo";
  }

  parseOutput(output: string): ProviderResult {
    // Not used in our API-based implementation, but required by abstract class
    return {
      success: true,
      response: output,
      usageLimitReached: false,
    };
  }

  isUsageLimitReached(output: string, httpStatus?: number): boolean {
    // DeepSeek uses HTTP 402 for credit/balance issues
    if (httpStatus === 402) {
      return true;
    }

    // Also check for DeepSeek-specific account credit limit error messages
    return (
      output.includes("insufficient balance") ||
      output.includes("insufficient funds") ||
      output.includes("credit limit") ||
      (output.includes("balance") && output.includes("insufficient"))
    );
  }

  private convertMessages(messages: Message[]): DeepSeekMessage[] {
    return messages.map((msg) => ({
      role: msg.role as "system" | "user" | "assistant",
      content: msg.content,
    }));
  }

  private trimConversationHistory(
    messages: DeepSeekMessage[]
  ): DeepSeekMessage[] {
    // DeepSeek's maximum context length is 131,072 tokens
    // We'll be conservative and trim when we approach the limit
    // Keep system message and recent messages, remove older ones

    if (messages.length <= 2) {
      // No need to trim if we only have system + user message
      return messages;
    }

    // Separate system message from conversation
    const systemMessage = messages[0];
    const conversationMessages = messages.slice(1);

    // Keep the most recent messages (last 10-15 messages)
    // This ensures we maintain recent context while removing older history
    const maxConversationMessages = 15;
    const trimmedConversation = conversationMessages.slice(
      -maxConversationMessages
    );

    // Reconstruct with system message + trimmed conversation
    return [systemMessage, ...trimmedConversation];
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
      tool_choice: "auto",
      temperature: 0,
      tools: getToolDefinitions(),
    };

    if (process.env.GALDR_VERBOSE) {
      this.showVerbose(`========== DEEPSEEK API REQUEST ==========`);
      this.showVerbose(`Model: ${model}`);
      this.showVerbose(`Messages count: ${messages.length}`);
      this.showVerbose(`Request body: ${JSON.stringify(request, null, 2)}`);
      this.showVerbose(`========================================`);
    }

    // Create a timeout for the initial connection (60 seconds)
    const connectionTimeoutMs = 60000;
    const connectionTimeoutController = new AbortController();
    const connectionTimeoutId = setTimeout(() => {
      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(
          `⚠️  Connection timeout triggered after ${connectionTimeoutMs}ms`
        );
      }
      connectionTimeoutController.abort();
    }, connectionTimeoutMs);

    // Combine the user signal with the timeout signal
    const combinedSignal = signal
      ? (() => {
          const controller = new AbortController();
          signal.addEventListener("abort", () => controller.abort());
          connectionTimeoutController.signal.addEventListener("abort", () =>
            controller.abort()
          );
          return controller.signal;
        })()
      : connectionTimeoutController.signal;

    try {
      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(
          `Initiating fetch to ${this.baseUrl}/chat/completions...`
        );
        this.showVerbose(`Connection timeout set to ${connectionTimeoutMs}ms`);
      }

      const fetchStartTime = Date.now();
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(request),
        signal: combinedSignal,
      });

      // Clear the connection timeout since we got a response
      clearTimeout(connectionTimeoutId);

      const fetchDuration = Date.now() - fetchStartTime;

      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(
          `========== DEEPSEEK API RESPONSE RECEIVED ==========`
        );
        this.showVerbose(
          `HTTP Status: ${response.status} ${response.statusText}`
        );
        this.showVerbose(`Fetch duration: ${fetchDuration}ms`);
        this.showVerbose(
          `Response headers: ${JSON.stringify(
            Object.fromEntries(response.headers.entries()),
            null,
            2
          )}`
        );
        this.showVerbose(`Response body available: ${!!response.body}`);
        this.showVerbose(`===================================================`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        let parsedError: any;

        try {
          parsedError = JSON.parse(errorText);
        } catch {
          parsedError = { error: { message: errorText } };
        }

        const errorMessage = parsedError?.error?.message || errorText;
        const usageLimitReached = this.isUsageLimitReached(
          errorMessage,
          response.status
        );
        const contextLimitReached =
          response.status === 400 && this.detectContextLimit(errorMessage);

        if (process.env.GALDR_VERBOSE) {
          this.showVerbose(`API error response: ${errorText}`);
          this.showVerbose(`HTTP Status: ${response.status}`);
          this.showVerbose(`Credit limit reached: ${usageLimitReached}`);
          this.showVerbose(`Context limit reached: ${contextLimitReached}`);
        }

        // Handle specific error codes
        if (response.status === 402) {
          return {
            success: false,
            error:
              "Insufficient balance. Please check your DeepSeek account balance and add funds.",
            usageLimitReached: true,
          };
        }

        // If context limit is reached and we have conversation history, try trimming
        if (contextLimitReached && messages.length > 2) {
          if (process.env.GALDR_VERBOSE) {
            this.showVerbose(
              `Context limit reached, trimming conversation history...`
            );
            this.showVerbose(`Original message count: ${messages.length}`);
          }

          const trimmedMessages = this.trimConversationHistory(messages);

          if (process.env.GALDR_VERBOSE) {
            this.showVerbose(
              `Trimmed message count: ${trimmedMessages.length}`
            );
          }

          // Retry with trimmed messages
          return this.streamResponse(trimmedMessages, model, onStream, signal);
        }

        // Return specific error messages for context limits
        if (contextLimitReached) {
          return {
            success: false,
            error: `Context limit exceeded: ${errorMessage}`,
            usageLimitReached: false,
          };
        }

        // Generic error handling
        return {
          success: false,
          error: `DeepSeek API error: ${response.status} ${response.statusText}\n${errorMessage}`,
          usageLimitReached: usageLimitReached,
        };
      }

      if (!response.body) {
        return {
          success: false,
          error: "No response body from DeepSeek API",
          usageLimitReached: false,
        };
      }

      let fullResponse = "";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const toolCalls: Array<{ id: string; name: string; arguments: string }> =
        [];
      let currentToolCall: {
        id?: string;
        name?: string;
        arguments: string;
      } | null = null;
      let currentToolIndex = -1;
      let chunkCount = 0;
      let lastChunkTime = Date.now();
      const streamStartTime = Date.now();

      // Create a timeout for stream inactivity (5 minutes of no data = stream stalled)
      const streamTimeoutMs = 300000; // 5 minutes
      let streamTimeoutId: NodeJS.Timeout | undefined;

      const resetStreamTimeout = () => {
        if (streamTimeoutId) {
          clearTimeout(streamTimeoutId);
        }
        streamTimeoutId = setTimeout(() => {
          if (process.env.GALDR_VERBOSE) {
            this.showVerbose(
              `⚠️  Stream timeout: No data received for ${streamTimeoutMs}ms`
            );
          }
          reader.cancel("Stream timeout - no data received");
        }, streamTimeoutMs);
      };

      // Start the timeout
      resetStreamTimeout();

      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`Starting to read response stream...`);
        this.showVerbose(
          `Stream inactivity timeout set to ${streamTimeoutMs}ms`
        );
      }

      try {
        while (true) {
          if (process.env.GALDR_VERBOSE) {
            const now = Date.now();
            const timeSinceLastChunk = now - lastChunkTime;
            const totalStreamTime = now - streamStartTime;

            // Log every 30 seconds if no chunks received
            if (chunkCount === 0 && timeSinceLastChunk > 30000) {
              this.showVerbose(
                `⚠️  WARNING: Waiting for first chunk for ${Math.round(
                  totalStreamTime / 1000
                )}s...`
              );
              lastChunkTime = now; // Update to avoid spam
            }
          }

          const { done, value } = await reader.read();

          // Reset timeout on each chunk received
          resetStreamTimeout();

          if (process.env.GALDR_VERBOSE && chunkCount === 0) {
            this.showVerbose(
              `First chunk received after ${Date.now() - streamStartTime}ms`
            );
          }

          chunkCount++;
          lastChunkTime = Date.now();

          if (done) {
            if (process.env.GALDR_VERBOSE) {
              this.showVerbose(
                `Stream ended. Total chunks received: ${chunkCount}, Duration: ${
                  Date.now() - streamStartTime
                }ms`
              );
            }
            break;
          }

          const decodedChunk = decoder.decode(value, { stream: true });
          buffer += decodedChunk;

          if (process.env.GALDR_VERBOSE && chunkCount % 10 === 0) {
            this.showVerbose(
              `Processed ${chunkCount} chunks, current response length: ${fullResponse.length} chars`
            );
          }

          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep the last incomplete line in buffer

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine === "data: [DONE]") continue;

            if (trimmedLine.startsWith("data: ")) {
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
                      if (
                        currentToolCall &&
                        currentToolCall.id &&
                        currentToolCall.name
                      ) {
                        toolCalls.push({
                          id: currentToolCall.id,
                          name: currentToolCall.name,
                          arguments: currentToolCall.arguments,
                        });
                      }

                      // Start new tool call
                      currentToolIndex = index;
                      currentToolCall = {
                        id: toolCallDelta.id,
                        name: toolCallDelta.function?.name,
                        arguments: toolCallDelta.function?.arguments || "",
                      };
                    } else {
                      // Continue existing tool call
                      if (currentToolCall) {
                        if (toolCallDelta.id)
                          currentToolCall.id = toolCallDelta.id;
                        if (toolCallDelta.function?.name)
                          currentToolCall.name = toolCallDelta.function.name;
                        if (toolCallDelta.function?.arguments) {
                          currentToolCall.arguments +=
                            toolCallDelta.function.arguments;
                        }
                      }
                    }
                  }
                }

                // If we got finish_reason === 'tool_calls', save the last tool call
                if (
                  finishReason === "tool_calls" &&
                  currentToolCall &&
                  currentToolCall.id &&
                  currentToolCall.name
                ) {
                  toolCalls.push({
                    id: currentToolCall.id,
                    name: currentToolCall.name,
                    arguments: currentToolCall.arguments,
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
        // Clear the stream timeout
        clearTimeout(streamTimeoutId);

        // Check if it's an abort error
        if (error.name === "AbortError") {
          return {
            success: false,
            error: "Operation cancelled",
            usageLimitReached: false,
          };
        }

        // Handle stream termination errors
        if (
          error.message &&
          (error.message.includes("terminated") ||
            error.message.includes("aborted") ||
            error.message.includes("closed") ||
            error.message.includes("network"))
        ) {
          // Always output detailed termination information
          console.error(
            "\n═══════════════════════════════════════════════════════════════"
          );
          console.error("DeepSeek API Stream Termination Error");
          console.error(
            "═══════════════════════════════════════════════════════════════"
          );
          console.error("Error Message:", error.message);
          console.error("Error Type:", error.name || "Unknown");
          console.error(
            "Error Stack:",
            error.stack || "No stack trace available"
          );
          console.error(
            "───────────────────────────────────────────────────────────────"
          );
          console.error("Request Details:");
          console.error("  Model:", this.model);
          console.error("  API URL:", this.baseUrl);
          console.error("  Messages Count:", messages.length);
          console.error(
            "  Last Message Role:",
            messages[messages.length - 1]?.role || "N/A"
          );
          console.error(
            "  Last Message Length:",
            messages[messages.length - 1]?.content?.length || 0
          );
          console.error(
            "───────────────────────────────────────────────────────────────"
          );
          console.error("Response State:");
          console.error(
            "  Partial Response Received:",
            fullResponse.length > 0 ? "Yes" : "No"
          );
          console.error(
            "  Partial Response Length:",
            fullResponse.length,
            "characters"
          );
          console.error("  Tool Calls Collected:", toolCalls.length);
          console.error(
            "  Current Buffer:",
            buffer
              ? `"${buffer.substring(0, 100)}${
                  buffer.length > 100 ? "..." : ""
                }"`
              : "Empty"
          );
          console.error(
            "───────────────────────────────────────────────────────────────"
          );
          console.error("Possible Causes:");
          console.error("  • Network connectivity issues");
          console.error("  • DeepSeek API rate limiting");
          console.error("  • Server-side timeout or overload");
          console.error("  • Request payload too large");
          console.error("  • API key issues");
          console.error(
            "═══════════════════════════════════════════════════════════════\n"
          );

          // If we have a partial response, return it
          if (fullResponse.length > 0) {
            console.error(
              `⚠️  Returning partial response (${fullResponse.length} characters)\n`
            );
            return {
              success: true,
              response: fullResponse,
              usageLimitReached: false,
            };
          }

          // Otherwise, return the error
          return {
            success: false,
            error: `DeepSeek API connection terminated: ${error.message}. See detailed error output above.`,
            usageLimitReached: false,
          };
        }

        throw error;
      }

      // Clear the stream timeout since we successfully completed
      clearTimeout(streamTimeoutId);

      // Execute tool calls if any
      if (toolCalls.length > 0) {
        if (process.env.GALDR_VERBOSE) {
          this.showVerbose(`Executing ${toolCalls.length} tool call(s)`);
        }

        // Add assistant message with tool calls to conversation
        const assistantMessage: DeepSeekMessage = {
          role: "assistant",
          content: fullResponse || "",
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })),
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
              role: "tool",
              content: result,
              tool_call_id: toolCall.id,
            });
          } catch (error: any) {
            messages.push({
              role: "tool",
              content: `Error executing tool: ${error.message}`,
              tool_call_id: toolCall.id,
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
        usageLimitReached: false,
      };
    } catch (error: any) {
      // Clear the timeout
      clearTimeout(connectionTimeoutId);

      // Check if it's an abort error
      if (error.name === "AbortError") {
        if (process.env.GALDR_VERBOSE) {
          this.showVerbose(
            `AbortError caught. Checking if it was a timeout or user cancellation...`
          );
        }

        // Check if the abort was due to timeout
        if (connectionTimeoutController.signal.aborted && !signal?.aborted) {
          const timeoutMessage = `DeepSeek API connection timeout after ${connectionTimeoutMs}ms. The API did not respond in time. This could indicate network issues or API server overload.`;

          if (process.env.GALDR_VERBOSE) {
            this.showVerbose(`Timeout detected: ${timeoutMessage}`);
          }

          return {
            success: false,
            error: timeoutMessage,
            usageLimitReached: false,
          };
        }

        // Otherwise it was a user cancellation
        return {
          success: false,
          error: "Operation cancelled",
          usageLimitReached: false,
        };
      }

      // Check for network errors that might indicate context or credit issues
      const errorMessage = error.message || "Unknown error";
      const usageLimitReached = this.isUsageLimitReached(errorMessage);
      const contextLimitReached = this.detectContextLimit(errorMessage);

      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`========== DEEPSEEK API ERROR ==========`);
        this.showVerbose(`Error name: ${error.name}`);
        this.showVerbose(`Error message: ${errorMessage}`);
        this.showVerbose(`Error stack: ${error.stack || "No stack trace"}`);
        this.showVerbose(`Credit limit detected: ${usageLimitReached}`);
        this.showVerbose(`Context limit detected: ${contextLimitReached}`);
        this.showVerbose(`=======================================`);
      }

      if (usageLimitReached) {
        return {
          success: false,
          error:
            "Insufficient balance. Please check your DeepSeek account balance and add funds.",
          usageLimitReached: true,
        };
      }

      if (contextLimitReached) {
        return {
          success: false,
          error: `Context limit exceeded: ${errorMessage}`,
          usageLimitReached: false,
        };
      }

      return {
        success: false,
        error: `DeepSeek API request failed: ${errorMessage}`,
        usageLimitReached: false,
      };
    }
  }

  private hasGoogleSearchKeys(): boolean {
    const googleApiKey = this.configManager.getApiKey("googleSearch");
    const googleSearchEngineId = this.configManager.getGoogleSearchEngineId();
    return !!(googleApiKey && googleSearchEngineId);
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
        error:
          "DeepSeek API key is not set. Please set it using: galdr config --set-key deepseek <your-api-key>",
        usageLimitReached: false,
      };
    }

    // --- FIX: Build the system prompt every time ---

    const hasGoogleSearch = this.hasGoogleSearchKeys();
    const searchProviderInfo = hasGoogleSearch
      ? "Google Search is configured. Prefer google_search over duckduckgo_search when searching the web."
      : "Google Search is not configured. Use duckduckgo_search for web searches (no API key required).";

    // Combine all instructions into one system prompt
    const systemPromptContent = `You are a helpful AI coding assistant with access to development tools for file operations, code search, web search, and command execution.

${searchProviderInfo}

Working directory: ${process.cwd()}

CRITICAL INSTRUCTION - TOOL EXECUTION:
When the user asks you to modify, fix, change, or edit code, you must IMMEDIATELY use the appropriate tools to make the actual changes. Do not just analyze and explain what should be done - actually do it using edit_file or write_file.

WORKFLOW FOR CODE MODIFICATIONS:
1. Use read_file to read the current file
2. Use edit_file (with exact old_string and new_string) to make the actual modification
3. Then explain what you did

The key point: EXECUTE FIRST (steps 1-2), EXPLAIN AFTER (step 3).

WRONG: Reading files, analyzing the problem, explaining the solution without calling edit_file
RIGHT: Reading files, calling edit_file to make changes, then explaining what you changed

If you only call read_file but never call edit_file or write_file, you have NOT actually modified the code. The file remains unchanged.

Available tools:
- read_file(file_path) - Read a file's contents
- edit_file(file_path, old_string, new_string, replace_all?) - Modify a file by replacing exact text
- write_file(file_path, content) - Write entire file contents
- find_in_files(directory_path, pattern, file_pattern?, case_sensitive?) - Search for text in files
- grep(pattern, path?, file_glob?, case_insensitive?) - Search using regex patterns
- glob(pattern, base_path?) - Find files matching glob patterns
- execute_bash(command, timeout?) - Execute shell commands
- google_search(query, num_results?) - Search the web with Google
- duckduckgo_search(query, num_results?) - Search the web with DuckDuckGo
- fetch_page(url, include_html?) - Fetch and extract web page content
- get_current_date(timezone?, format?) - Get current date/time

SEARCH WORKFLOW: After using google_search or duckduckgo_search, always call fetch_page on at least one URL from the results to get actual content.

Remember: You have tools to actually modify files. Use them! When asked to fix or change code, use edit_file to make the actual change, don't just describe what the change should be.`;

    const systemMessage: DeepSeekMessage = {
      role: "system",
      content: systemPromptContent,
    };

    // Convert conversation history
    const historyMessages = this.convertMessages(conversationHistory);

    // Add the current prompt as a user message (cleanly)
    const userMessage: DeepSeekMessage = {
      role: "user",
      content: prompt, // Just the prompt, no meta-instructions
    };

    // Construct the final message array
    // The correct order is [system, ...history, user]
    const messages = [systemMessage, ...historyMessages, userMessage];

    // Use the model if set, otherwise use default
    const model =
      this.model && this.model !== "default" ? this.model : "deepseek-chat";

    return this.streamResponse(messages, model, onStream, signal);
  }

  public async checkAvailability(): Promise<boolean> {
    // DeepSeek is available if the API key is set
    // We could also make a test API call, but checking the env var is faster
    return !!this.apiKey;
  }
}
