import { Provider } from '../types/index.js';
import { BaseProvider } from './base.js';
import { ClaudeProvider } from './claude.js';
import { GeminiProvider } from './gemini.js';
import { CopilotProvider } from './copilot.js';
import { CursorProvider } from './cursor.js';

export class ProviderManager {
  private providers: Map<Provider, BaseProvider>;

  constructor() {
    this.providers = new Map([
      ['claude', new ClaudeProvider()],
      ['gemini', new GeminiProvider()],
      ['copilot', new CopilotProvider()],
      ['cursor', new CursorProvider()],
    ]);
  }

  public getProvider(name: Provider): BaseProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Provider ${name} not found`);
    }
    return provider;
  }

  public async checkAvailability(name: Provider): Promise<boolean> {
    const provider = this.getProvider(name);
    return provider.checkAvailability();
  }

  public async checkAllAvailability(): Promise<Map<Provider, boolean>> {
    const results = new Map<Provider, boolean>();

    for (const [name, provider] of this.providers) {
      results.set(name, await provider.checkAvailability());
    }

    return results;
  }

  public getNextProvider(current: Provider, mode: 'round-robin'): Provider {
    const providers: Provider[] = ['claude', 'gemini', 'copilot', 'cursor'];
    const currentIndex = providers.indexOf(current);
    const nextIndex = (currentIndex + 1) % providers.length;
    return providers[nextIndex];
  }

  public async getNextAvailableProvider(current: Provider, mode: 'round-robin'): Promise<Provider | null> {
    const providers: Provider[] = ['claude', 'gemini', 'copilot', 'cursor'];
    const currentIndex = providers.indexOf(current);
    
    for (let i = 1; i < providers.length; i++) {
      const nextIndex = (currentIndex + i) % providers.length;
      const nextProvider = providers[nextIndex];
      const available = await this.checkAvailability(nextProvider);
      
      if (available) {
        return nextProvider;
      }
    }
    
    return null;
  }
}

export { BaseProvider } from './base.js';
export { ClaudeProvider } from './claude.js';
export { GeminiProvider } from './gemini.js';
export { CopilotProvider } from './copilot.js';
export { CursorProvider } from './cursor.js';
