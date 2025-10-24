import { ProviderResult } from '../types';
import { BaseProvider } from './base';

export class ClaudeProvider extends BaseProvider {
  constructor() {
    super('claude');
  }

  getCommand(): string {
    return 'claude --print --permission-mode bypassPermissions';
  }

  parseOutput(output: string): ProviderResult {
    return {
      success: true,
      response: output,
    };
  }

  detectTokenLimit(output: string): boolean {
    // Common patterns that indicate token limit reached
    const patterns = [
      /token limit/i,
      /usage limit/i,
      /quota exceeded/i,
      /rate limit/i,
      /maximum.*tokens/i,
    ];

    return patterns.some((pattern) => pattern.test(output));
  }
}
