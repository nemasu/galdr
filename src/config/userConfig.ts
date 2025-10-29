import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Provider, SwitchMode } from '../types/index.js';

export interface UserConfig {
  apiKeys?: {
    deepseek?: string;
    googleSearch?: string;  // Google Custom Search API Key
    // Add more provider API keys as needed
  };
  googleSearchEngineId?: string;  // Google Custom Search Engine ID (CX)
  defaultProvider?: Provider;
  defaultMode?: SwitchMode;
  defaultModels?: {
    claude?: string;
    gemini?: string;
    copilot?: string;
    deepseek?: string;
    cursor?: string;
  };
}

export class UserConfigManager {
  private configPath: string;
  private config: UserConfig;

  constructor() {
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.galdr');
    this.configPath = path.join(configDir, 'config.json');

    // Ensure config directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Load or initialize config
    this.config = this.loadConfig();
  }

  private loadConfig(): UserConfig {
    if (!fs.existsSync(this.configPath)) {
      // Create default config with all keys populated
      const defaultConfig: UserConfig = {
        apiKeys: {
          deepseek: '',
          googleSearch: '',
        },
        googleSearchEngineId: '',
        defaultProvider: undefined,
        defaultMode: undefined,
        defaultModels: {
          claude: '',
          gemini: '',
          copilot: '',
          deepseek: '',
          cursor: '',
        },
      };

      // Write the default config file
      try {
        fs.writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
        console.log(`Created default config file at: ${this.configPath}`);
      } catch (error) {
        console.error('Error creating default config file:', error);
      }

      return defaultConfig;
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('Error loading config file:', error);
      return {};
    }
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error saving config file:', error);
    }
  }

  // API Keys
  getApiKey(provider: 'deepseek' | 'googleSearch'): string | undefined {
    return this.config.apiKeys?.[provider];
  }

  setApiKey(provider: 'deepseek' | 'googleSearch', apiKey: string): void {
    if (!this.config.apiKeys) {
      this.config.apiKeys = {};
    }
    this.config.apiKeys[provider] = apiKey;
    this.saveConfig();
  }

  // Google Search Engine ID
  getGoogleSearchEngineId(): string | undefined {
    return this.config.googleSearchEngineId;
  }

  setGoogleSearchEngineId(searchEngineId: string): void {
    this.config.googleSearchEngineId = searchEngineId;
    this.saveConfig();
  }

  // Default Provider
  getDefaultProvider(): Provider | undefined {
    return this.config.defaultProvider;
  }

  setDefaultProvider(provider: Provider): void {
    this.config.defaultProvider = provider;
    this.saveConfig();
  }

  // Default Mode
  getDefaultMode(): SwitchMode | undefined {
    return this.config.defaultMode;
  }

  setDefaultMode(mode: SwitchMode): void {
    this.config.defaultMode = mode;
    this.saveConfig();
  }

  // Default Models
  getDefaultModel(provider: Provider): string | undefined {
    return this.config.defaultModels?.[provider];
  }

  setDefaultModel(provider: Provider, model: string): void {
    if (!this.config.defaultModels) {
      this.config.defaultModels = {};
    }
    this.config.defaultModels[provider] = model;
    this.saveConfig();
  }

  // Get all config
  getConfig(): UserConfig {
    return { ...this.config };
  }

  // Get config file path
  getConfigPath(): string {
    return this.configPath;
  }
}
