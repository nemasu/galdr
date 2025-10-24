import { ProviderResult } from '../types';
import { BaseProvider } from './base';

export class CopilotProvider extends BaseProvider {
  constructor() {
    super('copilot');
  }

  getCommand(): string {
    return 'copilot --allow-all-tools -p';
  }

  parseOutput(output: string): ProviderResult {
    return {
      success: true,
      response: output,
    };
  }

  detectTokenLimit(output: string): boolean {
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
