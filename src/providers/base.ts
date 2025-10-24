import { spawn } from 'child_process';
import { Provider, ProviderResult, Message } from '../types/index.js';
import chalk from 'chalk';
import { InkWriter } from '../chat/utils/InkWriter.js';

export abstract class BaseProvider {
  protected name: Provider;
  protected firstChunkReceived: boolean = false;
  protected onFirstChunk?: () => void;
  protected inkWriter?: InkWriter;

  constructor(name: Provider) {
    this.name = name;
  }

  abstract getCommand(): string;

  abstract parseOutput(output: string): ProviderResult;

  abstract detectTokenLimit(output: string): boolean;

  // Optional method for providers to handle streaming chunks
  protected handleStreamChunk(chunk: string): void {
    // Call onFirstChunk callback once on first actual content
    if (!this.firstChunkReceived && chunk.trim() && this.onFirstChunk) {
      this.onFirstChunk();
      this.firstChunkReceived = true;
    }
    // Write to InkWriter
    if (this.inkWriter) {
      this.inkWriter.writeText(chunk);
    }
  }

  // Helper method to determine if a tool should be displayed
  // Tools like "Read" produce verbose output, so we hide them
  protected shouldDisplayTool(toolName: string): boolean {
    const hiddenTools = ['Read'];
    return !hiddenTools.includes(toolName);
  }

  private handleChildProcess(
    child: ReturnType<typeof spawn>,
    onStream: ((chunk: string) => void) | undefined,
    resolve: (value: ProviderResult) => void,
    signal?: AbortSignal
  ): void {
    let stdout = '';
    let stderr = '';

    if (process.env.GALDR_VERBOSE) {
      console.error(chalk.dim(`[VERBOSE] Child process spawned with PID: ${child.pid}`));
    }

    // Handle cancellation
    if (signal) {
      signal.onabort = () => {
        if (child.pid) {
          if (process.env.GALDR_VERBOSE) {
            console.error(chalk.dim(`[VERBOSE] Abort signal received, killing child process ${child.pid}`));
          }
          child.kill(); // Send SIGTERM, or SIGKILL if already terminated
          resolve({
            success: false,
            error: 'Operation cancelled',
            tokenLimitReached: false,
          });
        }
      };
    }

    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      if (process.env.GALDR_VERBOSE) {
        console.error(chalk.dim(`[VERBOSE] stdout: ${chunk}...`));
      }
      if (onStream) {
        onStream(chunk);
      }
      this.handleStreamChunk(chunk);
    });

    child.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      if (process.env.GALDR_VERBOSE) {
        console.error(chalk.dim(`[VERBOSE] stderr: ${chunk}...`));
      }
      if (process.env.DEBUG) {
        process.stderr.write(chunk);
      }
    });

    child.on('close', (code) => {
      if (process.env.GALDR_VERBOSE) {
        console.error(chalk.dim(`[VERBOSE] Process exited with code: ${code}`));
        console.error(chalk.dim(`[VERBOSE] Full stdout:\n${stdout}\n`));
        console.error(chalk.dim(`[VERBOSE] Full stderr:\n${stderr}\n`));
      }
      if (code !== 0) {
        const combinedOutput = stdout + stderr;
        resolve({
          success: false,
          error: stderr || `Command exited with code ${code}`,
          tokenLimitReached: this.detectTokenLimit(combinedOutput),
        });
        return;
      }
      const result = this.parseOutput(stdout);
      const combinedOutput = stdout + stderr;
      result.tokenLimitReached = this.detectTokenLimit(combinedOutput);
      if (process.env.GALDR_VERBOSE) {
        console.error(chalk.dim(`[VERBOSE] Parsed response length: ${result.response?.length || 0}`));
        console.error(chalk.dim(`[VERBOSE] Token limit reached: ${result.tokenLimitReached}`));
      }
      resolve(result);
    });

    child.on('error', (error) => {
      if (process.env.GALDR_VERBOSE) {
        console.error(chalk.dim(`[VERBOSE] Child process error: ${error.message}`));
        console.error(chalk.dim(`[VERBOSE] Error stack: ${error.stack}`));
      }
      resolve({
        success: false,
        error: `Failed to execute command: ${error.message}`,
        tokenLimitReached: false,
      });
    });
  }

  protected formatContextWithPrompt(messages: Message[], currentPrompt: string): string {
    // Build a JSON structure containing conversation history and current prompt
    // This avoids issues with HEREDOC and special characters in the prompt
    const conversationData = {
      history: messages.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      currentPrompt: currentPrompt
    };

    const jsonString = JSON.stringify(conversationData);

    // Wrap the JSON in a prompt that tells the AI how to interpret it (no newlines allowed)
    return `The following JSON contains a conversation history and a current prompt. Please continue the conversation by responding to the currentPrompt, taking into account the conversation history: ${jsonString}`;
  }

  public setInkWriter(writer: InkWriter): void {
    this.inkWriter = writer;
  }

  public async execute(prompt: string, conversationHistory: Message[] = [], onStream?: (chunk: string) => void, onFirstChunk?: () => void, signal?: AbortSignal): Promise<ProviderResult> {
    // Reset for each execution
    this.firstChunkReceived = false;
    this.onFirstChunk = onFirstChunk;
    
    return new Promise((resolve) => {
      const command = this.getCommand();
      let stdout = '';
      let stderr = '';

      // Format prompt with conversation history
      const fullPrompt = this.formatContextWithPrompt(conversationHistory, prompt);

      // Parse command parts
      const commandParts = command.split(' ');
      const executable = commandParts[0];
      const cmdArgs = commandParts.slice(1);

      // Debug: log the command being executed
      if (process.env.GALDR_VERBOSE) {
        console.error(chalk.dim(`[VERBOSE] Executable: ${executable}`));
        console.error(chalk.dim(`[VERBOSE] Command args: ${cmdArgs.join(' ')}`));
        console.error(chalk.dim(`[VERBOSE] Prompt length: ${fullPrompt.length}`));
        console.error(chalk.dim(`[VERBOSE] Full prompt: ${fullPrompt}`));
      }

      let child;

      if (process.platform === 'win32') {
        // On Windows, use cmd.exe /c with array arguments
        // When passing as array to spawn(), Node.js handles the quoting correctly
        // We don't need to escape anything - just pass the raw prompt
        if (process.env.GALDR_VERBOSE) {
          console.error(chalk.dim(`[VERBOSE] Executing via cmd.exe /c with array args`));
        }

        // Build command: cmd.exe /c executable arg1 arg2 ...
        // If using piped input, don't include the prompt in args
        const args = ['/c', executable, ...cmdArgs];
        child = spawn('cmd.exe', args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true, // Need shell: true to resolve executables in PATH
          signal: signal,
        });

        // If using piped input, write the prompt to stdin and close it
        if (child.stdin) {
          child.stdin.write(fullPrompt);
          child.stdin.end();
        }
      } else {
        // On Unix, use array arguments - shell will handle quoting
        if (process.env.GALDR_VERBOSE) {
          console.error(chalk.dim(`[VERBOSE] Executing with array args (Unix)`));
        }

        // If using piped input, don't include the prompt in args
        const args = cmdArgs;
        child = spawn(executable, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
          signal: signal,
        });

        // If using piped input, write the prompt to stdin and close it
        if (child.stdin) {
          child.stdin.write(fullPrompt);
          child.stdin.end();
        }
      }

      if (process.env.GALDR_VERBOSE) {
        console.error(chalk.dim(`[VERBOSE] Spawn returned, PID: ${child.pid}`));
      }

      this.handleChildProcess(child, onStream, resolve, signal);
    });
  }

  public async checkAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
      const command = this.getCommand();
      const commandName = command.split(' ')[0];

      // Use 'where' on Windows, 'which' on Unix-based systems
      const checkCommand = process.platform === 'win32' ? 'where' : 'which';

      const child = spawn(checkCommand, [commandName], {
        shell: true,
      });

      child.on('close', (code) => {
        resolve(code === 0);
      });

      child.on('error', () => {
        resolve(false);
      });
    });
  }
}
