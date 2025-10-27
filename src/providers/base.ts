import { spawn } from 'child_process';
import { Provider, ProviderResult, Message } from '../types/index.js';
import chalk from 'chalk';
import { InkWriter } from '../chat/utils/InkWriter.js';

export abstract class BaseProvider {
  protected name: Provider;
  protected firstChunkReceived: boolean = false;
  protected onFirstChunk?: () => void;
  protected inkWriter?: InkWriter;
  protected model?: string;

  constructor(name: Provider) {
    this.name = name;
  }

  abstract getCommand(model?: string): string;

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

  // Helper method to show verbose messages inline with output
  protected showVerbose(message: string): void {
    if (this.inkWriter) {
      this.inkWriter.showInfo(`[VERBOSE] ${message}`);
    } else {
      // Fallback to console.error if InkWriter is not available
      console.error(chalk.dim(`[VERBOSE] ${message}`));
    }
  }

  protected handleChildProcess(
    child: ReturnType<typeof spawn>,
    onStream: ((chunk: string) => void) | undefined,
    resolve: (value: ProviderResult) => void,
    signal?: AbortSignal
  ): void {
    let stdout = '';
    let stderr = '';
    let isAborted = false;

    if (process.env.GALDR_VERBOSE) {
      this.showVerbose(`Child process spawned with PID: ${child.pid}`);
    }

    // Handle cancellation
    if (signal) {
      signal.addEventListener('abort', () => {
        if (child.pid && !isAborted) {
          isAborted = true;
          if (process.env.GALDR_VERBOSE) {
            this.showVerbose(`Abort signal received, killing child process ${child.pid}`);
          }

          if (process.platform === 'win32') {
            // Kill the entire process tree on Windows - use BOTH methods for maximum reliability

            // Method 1: taskkill with /F (force, equivalent to kill -9) and /T (tree)
            const taskkillProcess = spawn('taskkill', ['/PID', child.pid.toString(), '/T', '/F'], {
              windowsHide: true
            });

            taskkillProcess.on('close', (code) => {
              if (process.env.GALDR_VERBOSE) {
                this.showVerbose(`taskkill /F /T exited with code ${code}`);
              }
            });

            // Method 2: PowerShell recursive kill for any orphaned processes
            const killScript = `
              function Kill-ProcessTree {
                param([int]$ProcessId)
                Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $ProcessId } | ForEach-Object { Kill-ProcessTree $_.ProcessId }
                Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
              }
              Kill-ProcessTree ${child.pid}
            `.trim();

            const killProcess = spawn('powershell.exe', ['-NoProfile', '-Command', killScript], {
              windowsHide: true
            });

            killProcess.on('close', (code) => {
              if (process.env.GALDR_VERBOSE) {
                this.showVerbose(`PowerShell kill exited with code ${code}`);
              }
            });

            // Method 3: Kill the child handle directly
            child.kill('SIGKILL');
          } else {
            // Kill the entire process group using the parent PID
            // This is more reliable for stopping processes that spawn children
            process.kill(-child.pid, 'SIGKILL');
            child.kill('SIGKILL');
          }

          // Don't resolve here - let the close handler do it
        }
      });
    }

    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`stdout chunk (${chunk.length} bytes):\n${chunk}`);
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
        this.showVerbose(`stderr chunk (${chunk.length} bytes):\n${chunk}`);
      }
      if (process.env.DEBUG) {
        process.stderr.write(chunk);
      }
    });

    child.on('close', (code) => {
      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`========== PROVIDER RESPONSE COMPLETE ==========`);
        this.showVerbose(`Process exited with code: ${code}`);
        this.showVerbose(`Full stdout (${stdout.length} bytes):\n${stdout}`);
        this.showVerbose(`Full stderr (${stderr.length} bytes):\n${stderr}`);
        this.showVerbose(`===============================================`);
      }

      // If we aborted, resolve with cancellation error
      if (isAborted) {
        resolve({
          success: false,
          error: 'Operation cancelled',
          tokenLimitReached: false,
        });
        return;
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
        this.showVerbose(`Parsed response length: ${result.response?.length || 0} characters`);
        this.showVerbose(`Token limit reached: ${result.tokenLimitReached}`);
      }
      resolve(result);
    });

    child.on('error', (error) => {
      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`Child process error: ${error.message}`);
        this.showVerbose(`Error stack: ${error.stack}`);
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

  public setModel(model?: string): void {
    this.model = model;
  }

  public async execute(prompt: string, conversationHistory: Message[] = [], onStream?: (chunk: string) => void, onFirstChunk?: () => void, signal?: AbortSignal): Promise<ProviderResult> {
    // Reset for each execution
    this.firstChunkReceived = false;
    this.onFirstChunk = onFirstChunk;
    
    return new Promise((resolve) => {
      const command = this.getCommand(this.model);
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
        this.showVerbose(`========== EXECUTING PROVIDER ==========`);
        this.showVerbose(`Provider: ${this.name}`);
        this.showVerbose(`Executable: ${executable}`);
        this.showVerbose(`Command args: ${cmdArgs.join(' ')}`);
        this.showVerbose(`Prompt length: ${fullPrompt.length} characters`);
        this.showVerbose(`========== FULL PROMPT SENT ==========`);
        this.showVerbose(fullPrompt);
        this.showVerbose(`========================================`);
      }

      let child;

      if (process.platform === 'win32') {
        // On Windows, we need shell: true to resolve PATH, but we use windowsHide to prevent popups
        // The PID will be the shell's PID, but taskkill /T will kill the entire tree
        if (process.env.GALDR_VERBOSE) {
          this.showVerbose(`Executing with shell and windowsHide`);
        }

        child = spawn(executable, cmdArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
          windowsHide: true, // Prevent console window from appearing
        });

        // If using piped input, write the prompt to stdin and close it
        if (child.stdin) {
          child.stdin.write(fullPrompt);
          child.stdin.end();
        }
      } else {
        // On Unix, use array arguments - shell will handle quoting
        if (process.env.GALDR_VERBOSE) {
          this.showVerbose(`Executing with array args (Unix)`);
        }

        // If using piped input, don't include the prompt in args
        const args = cmdArgs;
        child = spawn(executable, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
          detached: true,
        });

        // If using piped input, write the prompt to stdin and close it
        if (child.stdin) {
          child.stdin.write(fullPrompt);
          child.stdin.end();
        }
      }

      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`Spawn returned, PID: ${child.pid}`);
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
