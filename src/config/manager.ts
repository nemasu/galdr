import fs from 'fs';
import path from 'path';
import { GaldrConfig, Provider, SwitchMode } from '../types';

const CONFIG_DIR = '.galdr';
const CONFIG_FILE = 'config.json';

export class ConfigManager {
  private configPath: string;
  private config: GaldrConfig;

  constructor(workingDir: string = process.cwd()) {
    this.configPath = path.join(workingDir, CONFIG_DIR);
    this.ensureConfigDir();
    this.config = this.loadConfig();
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configPath)) {
      fs.mkdirSync(this.configPath, { recursive: true });
    }
  }

  private getConfigFilePath(): string {
    return path.join(this.configPath, CONFIG_FILE);
  }

  private loadConfig(): GaldrConfig {
    const filePath = this.getConfigFilePath();

    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
      } catch (error) {
        console.error('Error loading config, creating default:', error);
      }
    }

    return this.createDefaultConfig();
  }

  private createDefaultConfig(): GaldrConfig {
    const config: GaldrConfig = {
      defaultProvider: 'claude',
      switchMode: 'rollover',
    };
    this.config = config;
    this.save();
    return config;
  }

  public save(): void {
    const filePath = this.getConfigFilePath();
    fs.writeFileSync(filePath, JSON.stringify(this.config, null, 2));
  }

  public getDefaultProvider(): Provider {
    return this.config.defaultProvider;
  }

  public setDefaultProvider(provider: Provider): void {
    this.config.defaultProvider = provider;
    this.save();
  }

  public getSwitchMode(): SwitchMode {
    return this.config.switchMode;
  }

  public setSwitchMode(mode: SwitchMode): void {
    this.config.switchMode = mode;
    this.save();
  }

  public getTokenLimit(): number | undefined {
    return this.config.tokenLimit;
  }

  public setTokenLimit(limit?: number): void {
    this.config.tokenLimit = limit;
    this.save();
  }

  public getConfig(): GaldrConfig {
    return { ...this.config };
  }
}
