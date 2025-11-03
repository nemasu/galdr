import type { InkWriterCallbacks } from '../../chat/utils/InkWriter.js';

export class MockInkWriter {
  private callbacks: InkWriterCallbacks;
  private isActive: boolean = false;
  
  public writtenText: string[] = [];
  public infoMessages: string[] = [];
  public toolUses: Array<{name: string, parameters?: any}> = [];
  public toolCompletions: boolean[] = [];

  constructor(callbacks?: Partial<InkWriterCallbacks>) {
    this.callbacks = {
      onTextChunk: (chunk: string) => {
        this.writtenText.push(chunk);
        if (callbacks?.onTextChunk) {
          callbacks.onTextChunk(chunk);
        }
      },
      onToolUse: (name: string, parameters?: any) => {
        this.toolUses.push({name, parameters});
        if (callbacks?.onToolUse) {
          callbacks.onToolUse(name, parameters);
        }
      },
      onToolComplete: (success: boolean) => {
        this.toolCompletions.push(success);
        if (callbacks?.onToolComplete) {
          callbacks.onToolComplete(success);
        }
      },
      onInfo: (message: string) => {
        this.infoMessages.push(message);
        if (callbacks?.onInfo) {
          callbacks.onInfo(message);
        }
      },
    };
  }

  public writeText(chunk: string): void {
    if (!this.isActive) return;
    this.callbacks.onTextChunk(chunk);
  }

  public showTool(name: string, parameters?: any): void {
    if (!this.isActive) return;
    this.callbacks.onToolUse(name, parameters);
  }

  public completeTool(success: boolean): void {
    if (!this.isActive) return;
    this.callbacks.onToolComplete(success);
  }

  public showInfo(message: string): void {
    if (!this.isActive) return;
    this.callbacks.onInfo(message);
  }

  public activate(): void {
    this.isActive = true;
  }

  public deactivate(): void {
    this.isActive = false;
  }

  public isWriterActive(): boolean {
    return this.isActive;
  }

  public clear(): void {
    this.writtenText = [];
    this.infoMessages = [];
    this.toolUses = [];
    this.toolCompletions = [];
  }
}