import { BaseProvider } from "./base.js";
import { ProviderResult, Message } from "../types/index.js";
import { UserConfigManager } from "../config/userConfig.js";
import {
  getToolDefinitions,
  executeTool,
  ToolDefinition,
} from "../tools/index.js";
import { tokenizer } from "../utils/tokenizer.js";

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
  max_tokens?: number;
  tools?: Array<ToolDefinition & { strict?: boolean }>;
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
  private baseUrl: string = "https://api.deepseek.com/beta";
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
    // We'll be conservative and aim for ~60,000 tokens max (leaving room for response and tools)
    const MAX_CONTEXT_TOKENS = 60000;

    if (messages.length <= 2) {
      // No need to trim if we only have system + user message
      return messages;
    }

    // Separate system message from conversation
    const systemMessage = messages[0];
    const conversationMessages = messages.slice(1);

    // Calculate current token count
    let currentTokens = tokenizer.quickEstimateMessages(messages);

    if (process.env.GALDR_VERBOSE) {
      this.showVerbose(`Trimming: Current tokens: ${currentTokens}, Max: ${MAX_CONTEXT_TOKENS}`);
    }

    // If we're under the limit, no need to trim
    if (currentTokens <= MAX_CONTEXT_TOKENS) {
      return messages;
    }

    // Remove oldest messages until we're under the token limit
    // Always keep at least the last 4 conversation messages for context
    const minConversationMessages = 4;
    let trimmedConversation = conversationMessages.slice();

    while (trimmedConversation.length > minConversationMessages) {
      // Try removing the oldest message
      trimmedConversation = trimmedConversation.slice(1);

      // Recalculate tokens
      const testMessages = [systemMessage, ...trimmedConversation];
      currentTokens = tokenizer.quickEstimateMessages(testMessages);

      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`  Removed 1 message, now ${trimmedConversation.length} messages, ${currentTokens} tokens`);
      }

      // If we're under the limit, we're done
      if (currentTokens <= MAX_CONTEXT_TOKENS) {
        break;
      }
    }

    // Reconstruct with system message + trimmed conversation
    return [systemMessage, ...trimmedConversation];
  }

  private async streamResponse(
    messages: DeepSeekMessage[],
    model: string,
    onStream?: (chunk: string) => void,
    signal?: AbortSignal,
    retryCount: number = 0
  ): Promise<ProviderResult> {
    // Add strict: true to all tool definitions for strict mode
    const tools = getToolDefinitions().map(tool => ({
      ...tool,
      strict: true
    }));

    const request: DeepSeekRequest = {
      model,
      messages,
      stream: true,
      tool_choice: "auto",
      temperature: 0,
      max_tokens: 8192, // Set a reasonable limit to prevent excessive reasoning
      tools,
    };

    if (process.env.GALDR_VERBOSE) {
      // Calculate token estimates
      const tokenEstimate = tokenizer.quickEstimateMessages(messages);
      const toolsTokenEstimate = request.tools 
        ? tokenizer.quickEstimate(JSON.stringify(request.tools))
        : 0;
      const totalTokenEstimate = tokenEstimate + toolsTokenEstimate;

      this.showVerbose(`========== DEEPSEEK API REQUEST ==========`);
      this.showVerbose(`Model: ${model}`);
      this.showVerbose(`Messages count: ${messages.length}`);
      this.showVerbose(`Estimated tokens: ${totalTokenEstimate} (messages: ${tokenEstimate}, tools: ${toolsTokenEstimate})`);
      this.showVerbose(`Request body: ${JSON.stringify(request, null, 2)}`);
      this.showVerbose(`========================================`);
    }

    // Create a timeout for the initial connection (5 minutes)
    const connectionTimeoutMs = 1000 * 60 * 5; // 5 minutes
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

        // Handle 404 errors with retry logic (intermittent API issues)
        if (response.status === 404 && retryCount < 3) {
          const delayMs = Math.pow(2, retryCount) * 1000; // Exponential backoff: 1s, 2s, 4s
          if (process.env.GALDR_VERBOSE) {
            this.showVerbose(`⚠️  Received 404 Not Found (attempt ${retryCount + 1}/3)`);
            this.showVerbose(`   This may be intermittent. Retrying in ${delayMs}ms...`);
          }

          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, delayMs));

          // Retry with incremented count
          return this.streamResponse(messages, model, onStream, signal, retryCount + 1);
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
      let contentfulChunkCount = 0; // Chunks that actually added content
      let emptyChunkStreakCount = 0; // Consecutive empty chunks
      let lastChunkTime = Date.now();
      let lastContentLength = 0; // Track content growth
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
                  contentfulChunkCount++;
                  emptyChunkStreakCount = 0; // Reset empty streak
                  lastContentLength = fullResponse.length;
                  if (onStream) {
                    onStream(content);
                  }
                  this.handleStreamChunk(content);
                } else {
                  // Track empty chunks
                  emptyChunkStreakCount++;

                  // Warn if we're getting too many consecutive empty chunks
                  if (emptyChunkStreakCount === 100 && process.env.GALDR_VERBOSE) {
                    this.showVerbose(
                      `Received 100 consecutive empty chunks. DeepSeek may be doing internal reasoning. Total chunks: ${chunkCount}, content chunks: ${contentfulChunkCount}`
                    );
                  }
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
          // Output detailed termination information
          if (process.env.GALDR_VERBOSE) {
            this.showVerbose("\n═══════════════════════════════════════════════════════════════");
            this.showVerbose("DeepSeek API Stream Termination Error");
            this.showVerbose("═══════════════════════════════════════════════════════════════");
            this.showVerbose(`Error Message: ${error.message}`);
            this.showVerbose(`Error Type: ${error.name || "Unknown"}`);
            this.showVerbose(`Error Stack: ${error.stack || "No stack trace available"}`);
            this.showVerbose("───────────────────────────────────────────────────────────────");
            this.showVerbose("Request Details:");
            this.showVerbose(`  Model: ${this.model}`);
            this.showVerbose(`  API URL: ${this.baseUrl}`);
            this.showVerbose(`  Messages Count: ${messages.length}`);
            this.showVerbose(`  Last Message Role: ${messages[messages.length - 1]?.role || "N/A"}`);
            this.showVerbose(`  Last Message Length: ${messages[messages.length - 1]?.content?.length || 0}`);
            this.showVerbose("───────────────────────────────────────────────────────────────");
            this.showVerbose("Response State:");
            this.showVerbose(`  Partial Response Received: ${fullResponse.length > 0 ? "Yes" : "No"}`);
            this.showVerbose(`  Partial Response Length: ${fullResponse.length} characters`);
            this.showVerbose(`  Tool Calls Collected: ${toolCalls.length}`);
            this.showVerbose(`  Current Buffer: ${buffer ? `"${buffer.substring(0, 100)}${buffer.length > 100 ? "..." : ""}"` : "Empty"}`);
            this.showVerbose("───────────────────────────────────────────────────────────────");
            this.showVerbose("Possible Causes:");
            this.showVerbose("  • Network connectivity issues");
            this.showVerbose("  • DeepSeek API rate limiting");
            this.showVerbose("  • Server-side timeout or overload");
            this.showVerbose("  • Request payload too large");
            this.showVerbose("  • API key issues");
            this.showVerbose("═══════════════════════════════════════════════════════════════");
          }

          // If we have a partial response, return it
          if (fullResponse.length > 0) {
            if (process.env.GALDR_VERBOSE) {
              this.showVerbose(`⚠️  Returning partial response (${fullResponse.length} characters)`);
            }
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
          const toolCallsTokenEstimate = tokenizer.quickEstimate(JSON.stringify(toolCalls));
          this.showVerbose(`Executing ${toolCalls.length} tool call(s)`);
          this.showVerbose(`Estimated tool calls tokens: ${toolCallsTokenEstimate}`);
        }

        // Clone messages array to avoid mutating the original
        // This prevents accumulated tool execution state from persisting across requests
        const updatedMessages: DeepSeekMessage[] = [...messages];

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
        updatedMessages.push(assistantMessage);

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
            updatedMessages.push({
              role: "tool",
              content: result,
              tool_call_id: toolCall.id,
            });
          } catch (error: any) {
            updatedMessages.push({
              role: "tool",
              content: `Error executing tool: ${error.message}`,
              tool_call_id: toolCall.id,
            });
          }
        }

        // Make another API call with tool results
        return this.streamResponse(updatedMessages, model, onStream, signal);
      }

      if (process.env.GALDR_VERBOSE) {
        const responseTokenEstimate = tokenizer.quickEstimate(fullResponse);
        const emptyChunks = chunkCount - contentfulChunkCount;
        const emptyChunkPercentage = chunkCount > 0 ? ((emptyChunks / chunkCount) * 100).toFixed(1) : "0";

        this.showVerbose(`========== DEEPSEEK RESPONSE COMPLETE ==========`);
        this.showVerbose(`Response length: ${fullResponse.length} characters`);
        this.showVerbose(`Estimated response tokens: ${responseTokenEstimate}`);
        this.showVerbose(`Total chunks: ${chunkCount}, Content chunks: ${contentfulChunkCount}, Empty: ${emptyChunks} (${emptyChunkPercentage}%)`);

        // Warn if too many empty chunks
        if (emptyChunks > 1000) {
          this.showVerbose(`⚠️  WARNING: Received ${emptyChunks} empty chunks. This indicates DeepSeek is doing extensive internal reasoning.`);
          this.showVerbose(`   Consider using a more specific prompt or breaking the task into smaller steps.`);
        }

        this.showVerbose(`===============================================`);
      }

      // Check if response looks incomplete or contains hallucinated tool usage
      const suspiciousPatterns = [
        /Now (I'll|I will|let me|let's)\s+\w+.*:$/im,
        /Let me \w+.*:$/im,
        /I'll (now|next|then)\s+\w+.*:$/im,
        // More comprehensive patterns to detect hallucinated tool narration
        /Let me (check|examine|update|modify|test|verify|create|add|remove)/i,
        /Now I (can see|understand|need to)/i,
        /I need to use/i,
      ];

      const endsWithAnnouncement = suspiciousPatterns.some(pattern =>
        pattern.test(fullResponse.trim())
      );

      // Count how many tool announcement patterns appear in the response
      const toolAnnouncementCount = suspiciousPatterns.reduce((count, pattern) => {
        const matches = fullResponse.match(new RegExp(pattern.source, 'gi'));
        return count + (matches ? matches.length : 0);
      }, 0);

      // Detect hallucinated tool usage: multiple tool announcements but no actual tool calls
      const likelyHallucination = toolCalls.length === 0 && toolAnnouncementCount >= 3;

      if (likelyHallucination) {
        if (process.env.GALDR_VERBOSE) {
          this.showVerbose(`⚠️  WARNING: Detected hallucinated tool usage!`);
          this.showVerbose(`   The model narrated ${toolAnnouncementCount} tool actions but made 0 actual tool calls.`);
          this.showVerbose(`   Response length: ${fullResponse.length} chars`);
          this.showVerbose(`   This is a known DeepSeek behavior where it describes actions instead of performing them.`);
          this.showVerbose(`   Response preview: "${fullResponse.substring(0, 200)}..."`);
        }

        // Return an error to indicate the response is invalid
        return {
          success: false,
          error: `DeepSeek hallucinated tool usage: The model narrated ${toolAnnouncementCount} tool actions but made no actual tool calls. Please try rephrasing your request or use a different provider.`,
          usageLimitReached: false,
        };
      }

      // Also check for incomplete responses (ends with announcement, short response)
      if (endsWithAnnouncement && toolCalls.length === 0 && fullResponse.length < 500) {
        if (process.env.GALDR_VERBOSE) {
          this.showVerbose(`⚠️  WARNING: Response appears incomplete!`);
          this.showVerbose(`   The model announced an action ("${fullResponse.trim().slice(-80)}") but never executed it.`);
          this.showVerbose(`   This suggests the response was cut off (possibly hit max_tokens limit).`);
          this.showVerbose(`   Empty chunks: ${chunkCount - contentfulChunkCount}/${chunkCount}`);
        }
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
    const systemPromptContent = `You are an interactive CLI coding assistant specializing in software engineering tasks. Your primary goal is to help users safely and efficiently, adhering strictly to the following instructions and utilizing your available tools.

# Core Mandates

- **Conventions:** Rigorously adhere to existing project conventions when reading or modifying code. Analyze surrounding code, tests, and configuration first.
- **Libraries/Frameworks:** NEVER assume a library/framework is available or appropriate. Verify its established usage within the project (check imports, configuration files like 'package.json', 'requirements.txt', etc.) before employing it.
- **Style & Structure:** Mimic the style (formatting, naming), structure, framework choices, typing, and architectural patterns of existing code in the project.
- **Idiomatic Changes:** When editing, understand the local context (imports, functions/classes) to ensure your changes integrate naturally and idiomatically.
- **Comments:** Add code comments sparingly. Focus on *why* something is done, especially for complex logic, rather than *what* is done. Only add high-value comments if necessary for clarity. *NEVER* talk to the user or describe your changes through comments.
- **Proactiveness:** Fulfill the user's request thoroughly. When adding features or fixing bugs, this includes adding tests to ensure quality. *HOWEVER*, do not run the program after fixes are made unless explicitly instructed.
- **Confirm Ambiguity:** Do not take significant actions beyond the clear scope of the request without confirming with the user. If asked *how* to do something, explain first, don't just do it.

# Primary Workflows

## Software Engineering Tasks
When requested to perform tasks like fixing bugs, adding features, refactoring, or explaining code, follow this sequence:

1. **Understand:** Think about the user's request and the relevant codebase context. Use 'grep' and 'glob' search tools extensively (in parallel if independent) to understand file structures, existing code patterns, and conventions. Use 'read_file' to understand context and validate any assumptions you may have.

2. **Plan:** Build a coherent and grounded (based on the understanding in step 1) plan for how you intend to resolve the user's task. Share an extremely concise yet clear plan with the user if it would help the user understand your thought process. Use output logs or debug statements as part of this process to arrive at a solution.

3. **Implement:** Use the available tools (e.g., 'edit_file', 'write_file', 'execute_bash') to act on the plan, strictly adhering to the project's established conventions (detailed under 'Core Mandates'). **CRITICAL: When the user asks you to modify, fix, change, or edit code, you must use the appropriate tools to make the actual changes. Do not just analyze and explain what should be done - actually do it using edit_file or write_file.**

4. **Verify (Tests):** If applicable and feasible, verify the changes using the project's testing procedures. Identify the correct test commands and frameworks by examining 'README' files, build/package configuration (e.g., 'package.json'), or existing test execution patterns. NEVER assume standard test commands.

5. **Verify (Standards):** After making code changes, execute the project-specific build, linting and type-checking commands (e.g., 'tsc', 'npm run lint', 'ruff check .') that you have identified for this project. This ensures code quality and adherence to standards. If unsure about these commands, you can ask the user if they'd like you to run them and if so how to. DO NOT run the application unless explicitly instructed.

6. **Finalize:** After all verification passes, consider the task complete. Do not remove or revert any changes or created files (like tests). Await the user's next instruction.

# Operational Guidelines

## Tone and Style (CLI Interaction)
- **Concise & Direct:** Adopt a professional, direct, and concise tone suitable for a CLI environment.
- **Formatting:** Use GitHub-flavored Markdown.
- **Tools vs. Text:** Use tools for actions WITHOUT any accompanying narrative text. Only output text when providing final answers or asking clarification questions. NEVER say "Let me...", "I'll...", "Now I will...", or similar phrases before or during tool calls. When making tool calls, the content field should be empty or contain only the final result.

## Security and Safety Rules
- **Security First:** Always apply security best practices. Never introduce code that exposes, logs, or commits secrets, API keys, or other sensitive information.

## Tool Usage
- **CRITICAL - No Narration:** When calling tools, do NOT include explanatory text like "Let me...", "Now I'll...", or "I'm going to...". Just call the tools directly with an empty content field. Only include text content when responding with final results or asking clarification questions.
- **Tool Call Format:** Assistant messages with tool_calls should have empty content ("") or contain only the final answer after all tool executions are complete. Never mix tool calls with narrative explanations in the same message.
- **Parallelism:** Execute multiple independent tool calls in parallel when feasible (i.e. searching the codebase).
- **Search Workflow:** After using 'google_search' or 'duckduckgo_search', always call 'fetch_page' on at least one URL from the results to get actual content.

# Environment

Working directory: ${process.cwd()}
${searchProviderInfo}

# Available Tools

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

# Final Reminder

Your core function is efficient and safe assistance. Balance extreme conciseness with the crucial need for clarity, especially regarding safety and potential system modifications. Always prioritize user control and project conventions. Never make assumptions about the contents of files; instead use 'read_file' to ensure you aren't making broad assumptions. Finally, you are an agent - please keep going until the user's query is completely resolved.`;

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
    let messages = [systemMessage, ...historyMessages, userMessage];

    // Proactively trim conversation history to prevent context overflow
    // This prevents the connection termination issues caused by oversized requests
    const messageTokens = tokenizer.quickEstimateMessages(messages);
    const toolsTokens = tokenizer.quickEstimate(JSON.stringify(getToolDefinitions()));
    const totalInputTokens = messageTokens + toolsTokens;

    // DeepSeek's context is 131K tokens, but we want to leave room for:
    // - Response tokens (max_tokens: 8192)
    // - Tool definitions (~2000 tokens)
    // - Safety margin
    // So we trim proactively if input is approaching 60K tokens
    const PROACTIVE_TRIM_THRESHOLD = 60000;

    if (totalInputTokens > PROACTIVE_TRIM_THRESHOLD) {
      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`⚠️  Conversation has ${messages.length} messages (${totalInputTokens} tokens), trimming to prevent context issues...`);
      }
      messages = this.trimConversationHistory(messages);
      const newTokenCount = tokenizer.quickEstimateMessages(messages);
      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`   Trimmed to ${messages.length} messages (${newTokenCount} tokens)`);
      }
    }

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
