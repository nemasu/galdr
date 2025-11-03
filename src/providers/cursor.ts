import { ProviderResult } from '../types/index.js';
import { BaseProvider } from './base.js';

//TODO this needs more work

export class CursorProvider extends BaseProvider {
  constructor() {
    super('cursor');
  }

  getCommand(model?: string): string {
    const baseCommand = 'cursor-agent --force --output-format stream-json';
    if (model && model !== 'default') {
      return `${baseCommand} --model ${model}`;
    }
    return baseCommand;
  }

  parseOutput(output: string): ProviderResult {
    return {
      success: true,
      response: output,
    };
  }

  isUsageLimitReached(output: string, httpStatus?: number): boolean {
    // Cursor uses HTTP 429 for rate limits and quota limits
    if (httpStatus === 429) {
      return true;
    }
    
    // Also check for Cursor-specific token limit error messages
    const errorPatterns = [
      /reached.*token limit/i,
      //TODO add these as you find them
    ];

    return errorPatterns.some((pattern) => pattern.test(output));
  }
}
