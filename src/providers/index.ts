import { Provider } from '../types';
import { BaseProvider } from './base';
import { ClaudeProvider } from './claude';
import { GeminiProvider } from './gemini';
import { CopilotProvider } from './copilot';

export class ProviderManager {
  private providers: Map<Provider, BaseProvider>;

  constructor() {
    this.providers = new Map([
      ['claude', new ClaudeProvider()],
      ['gemini', new GeminiProvider()],
      ['copilot', new CopilotProvider()],
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
    const providers: Provider[] = ['claude', 'gemini', 'copilot'];
    const currentIndex = providers.indexOf(current);
    const nextIndex = (currentIndex + 1) % providers.length;
    return providers[nextIndex];
  }
}

export { BaseProvider } from './base';
export { ClaudeProvider } from './claude';
export { GeminiProvider } from './gemini';
export { CopilotProvider } from './copilot';
