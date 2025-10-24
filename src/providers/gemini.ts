import { ProviderResult } from '../types';
import { BaseProvider } from './base';

export class GeminiProvider extends BaseProvider {
  constructor() {
    super('gemini');
  }

  getCommand(): string {
    return 'gemini --approval-mode yolo';
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
      /resource.*exhausted/i,
    ];

    return patterns.some((pattern) => pattern.test(output));
  }
}
