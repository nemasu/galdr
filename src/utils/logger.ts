import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Logger utility for verbose output
 * Writes verbose logs to ~/.galdr/logs/ directory instead of the screen
 */
export class VerboseLogger {
  private static instance: VerboseLogger;
  private logFile: string;
  private isEnabled: boolean = false;

  private constructor() {
    // Determine the home directory path
    const homeDir = os.homedir();
    const logDir = path.join(homeDir, '.galdr', 'logs');
    
    // Ensure the logs directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Create log file with timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
    this.logFile = path.join(logDir, `verbose-${timestamp}.log`);
    
    // Write initial log entry
    this.writeToFile(`[${new Date().toISOString()}] Verbose logging started\n`);
  }

  public static getInstance(): VerboseLogger {
    if (!VerboseLogger.instance) {
      VerboseLogger.instance = new VerboseLogger();
    }
    return VerboseLogger.instance;
  }

  public enable(): void {
    this.isEnabled = true;
  }

  public disable(): void {
    this.isEnabled = false;
  }

  public log(message: string): void {
    if (!this.isEnabled) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    this.writeToFile(logMessage);
  }

  private writeToFile(message: string): void {
    try {
      fs.appendFileSync(this.logFile, message, 'utf8');
    } catch (error) {
      // If file writing fails, fall back to console.error
      console.error(`[VERBOSE LOGGER ERROR] Failed to write to log file: ${error}`);
      console.error(`[VERBOSE] ${message.trim()}`);
    }
  }

  public getLogFilePath(): string {
    return this.logFile;
  }
}

// Export a singleton instance
export const verboseLogger = VerboseLogger.getInstance();