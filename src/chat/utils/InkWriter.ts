/**
 * InkWriter - A writer interface for providers to output to Ink components
 * This replaces direct process.stdout.write calls to be compatible with Ink
 */

export interface InkWriterCallbacks {
  onTextChunk: (chunk: string) => void;
  onToolUse: (name: string, parameters?: any) => void;
  onToolComplete: (success: boolean) => void;
  onInfo: (message: string) => void;
}

export class InkWriter {
  private callbacks: InkWriterCallbacks;
  private isActive: boolean = false;

  constructor(callbacks: InkWriterCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Write text content (streaming)
   */
  public writeText(chunk: string): void {
    if (!this.isActive) return;
    this.callbacks.onTextChunk(chunk);
  }

  /**
   * Show tool usage
   */
  public showTool(name: string, parameters?: any): void {
    if (!this.isActive) return;
    this.callbacks.onToolUse(name, parameters);
  }

  /**
   * Update tool completion status
   */
  public completeTool(success: boolean): void {
    if (!this.isActive) return;
    this.callbacks.onToolComplete(success);
  }

  /**
   * Show info message
   */
  public showInfo(message: string): void {
    if (!this.isActive) return;
    this.callbacks.onInfo(message);
  }

  /**
   * Activate the writer (start accepting writes)
   */
  public activate(): void {
    this.isActive = true;
  }

  /**
   * Deactivate the writer (stop accepting writes)
   */
  public deactivate(): void {
    this.isActive = false;
  }

  /**
   * Check if writer is active
   */
  public isWriterActive(): boolean {
    return this.isActive;
  }
}
