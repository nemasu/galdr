import { spawn } from 'child_process';
import { Provider, ProviderResult, Message } from '../types';

export abstract class BaseProvider {
  protected name: Provider;

  constructor(name: Provider) {
    this.name = name;
  }

  abstract getCommand(): string;

  abstract parseOutput(output: string): ProviderResult;

  abstract detectTokenLimit(output: string): boolean;

  protected formatContextWithPrompt(messages: Message[], currentPrompt: string): string {
    if (messages.length === 0) {
      return currentPrompt;
    }

    // Build conversation history
    let context = 'Previous conversation:\n\n';
    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      context += `${role}: ${msg.content}\n\n`;
    }
    context += `Current request:\n${currentPrompt}`;
    return context;
  }

  public async execute(prompt: string, conversationHistory: Message[] = []): Promise<ProviderResult> {
    return new Promise((resolve) => {
      const command = this.getCommand();
      let stdout = '';
      let stderr = '';

      // Format prompt with conversation history
      const fullPrompt = this.formatContextWithPrompt(conversationHistory, prompt);

      // Construct full command with quoted prompt
      const fullCommand = `${command} "${fullPrompt.replace(/"/g, '\\"')}"`;

      // Spawn the CLI tool
      const child = spawn(fullCommand, {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Close stdin immediately since we're not sending interactive input
      child.stdin?.end();

      child.stdout?.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        // Stream output to user in real-time
        process.stdout.write(chunk);
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          resolve({
            success: false,
            error: stderr || `Command exited with code ${code}`,
            tokenLimitReached: this.detectTokenLimit(stderr),
          });
          return;
        }

        const result = this.parseOutput(stdout);
        result.tokenLimitReached = this.detectTokenLimit(stdout + stderr);
        resolve(result);
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          error: `Failed to execute ${command}: ${error.message}`,
          tokenLimitReached: false,
        });
      });
    });
  }

  public async checkAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
      const command = this.getCommand();
      const child = spawn('which', [command.split(' ')[0]], {
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
