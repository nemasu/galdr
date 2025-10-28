/**
 * Simple text buffer for managing input text with cursor position
 * Simplified version inspired by gemini-cli's text-buffer.ts
 */
export class TextBuffer {
  private text: string = '';
  private cursorPosition: number = 0;

  constructor(initialText: string = '') {
    this.text = initialText;
    this.cursorPosition = initialText.length;
  }

  getText(): string {
    return this.text;
  }

  setText(text: string): void {
    this.text = text;
    this.cursorPosition = Math.min(this.cursorPosition, text.length);
  }

  getCursorPosition(): number {
    return this.cursorPosition;
  }

  setCursorPosition(position: number): void {
    this.cursorPosition = Math.max(0, Math.min(position, this.text.length));
  }

  insertText(text: string): void {
    const before = this.text.slice(0, this.cursorPosition);
    const after = this.text.slice(this.cursorPosition);
    this.text = before + text + after;
    this.cursorPosition += text.length;
  }

  deleteChar(): void {
    if (this.cursorPosition > 0) {
      const before = this.text.slice(0, this.cursorPosition - 1);
      const after = this.text.slice(this.cursorPosition);
      this.text = before + after;
      this.cursorPosition--;
    }
  }

  deleteForward(): void {
    if (this.cursorPosition < this.text.length) {
      const before = this.text.slice(0, this.cursorPosition);
      const after = this.text.slice(this.cursorPosition + 1);
      this.text = before + after;
    }
  }

  clear(): void {
    this.text = '';
    this.cursorPosition = 0;
  }

  moveLeft(): void {
    if (this.cursorPosition > 0) {
      this.cursorPosition--;
    }
  }

  moveRight(): void {
    if (this.cursorPosition < this.text.length) {
      this.cursorPosition++;
    }
  }

  moveToStart(): void {
    this.cursorPosition = 0;
  }

  moveToEnd(): void {
    this.cursorPosition = this.text.length;
  }

  moveToWordStart(): void {
    // Move left to the start of the current or previous word
    if (this.cursorPosition === 0) return;

    let pos = this.cursorPosition - 1;

    // Skip whitespace
    while (pos > 0 && /\s/.test(this.text[pos])) {
      pos--;
    }

    // Skip word characters
    while (pos > 0 && !/\s/.test(this.text[pos - 1])) {
      pos--;
    }

    this.cursorPosition = pos;
  }

  moveToWordEnd(): void {
    // Move right to the end of the current or next word
    if (this.cursorPosition === this.text.length) return;

    let pos = this.cursorPosition;

    // Skip whitespace
    while (pos < this.text.length && /\s/.test(this.text[pos])) {
      pos++;
    }

    // Skip word characters
    while (pos < this.text.length && !/\s/.test(this.text[pos])) {
      pos++;
    }

    this.cursorPosition = pos;
  }

  moveUp(): void {
    // Move cursor up one line
    const lines = this.text.split('\n');
    let charsProcessed = 0;
    let currentLine = 0;
    let colInLine = 0;

    // Find current line and column
    for (let i = 0; i < lines.length; i++) {
      const lineLength = lines[i].length;
      if (charsProcessed + lineLength >= this.cursorPosition) {
        currentLine = i;
        colInLine = this.cursorPosition - charsProcessed;
        break;
      }
      charsProcessed += lineLength + 1; // +1 for newline
    }

    // Move to previous line if possible
    if (currentLine > 0) {
      const prevLineLength = lines[currentLine - 1].length;
      const targetCol = Math.min(colInLine, prevLineLength);

      // Calculate position in previous line
      let newPos = 0;
      for (let i = 0; i < currentLine - 1; i++) {
        newPos += lines[i].length + 1;
      }
      newPos += targetCol;

      this.cursorPosition = newPos;
    }
  }

  moveDown(): void {
    // Move cursor down one line
    const lines = this.text.split('\n');
    let charsProcessed = 0;
    let currentLine = 0;
    let colInLine = 0;

    // Find current line and column
    for (let i = 0; i < lines.length; i++) {
      const lineLength = lines[i].length;
      if (charsProcessed + lineLength >= this.cursorPosition) {
        currentLine = i;
        colInLine = this.cursorPosition - charsProcessed;
        break;
      }
      charsProcessed += lineLength + 1; // +1 for newline
    }

    // Move to next line if possible
    if (currentLine < lines.length - 1) {
      const nextLineLength = lines[currentLine + 1].length;
      const targetCol = Math.min(colInLine, nextLineLength);

      // Calculate position in next line
      let newPos = 0;
      for (let i = 0; i <= currentLine; i++) {
        newPos += lines[i].length + 1;
      }
      newPos += targetCol;

      this.cursorPosition = newPos;
    }
  }

  deleteWord(): void {
    // Delete from cursor to start of word (like Ctrl+W)
    if (this.cursorPosition === 0) return;

    const originalPos = this.cursorPosition;
    this.moveToWordStart();
    const newPos = this.cursorPosition;

    const before = this.text.slice(0, newPos);
    const after = this.text.slice(originalPos);
    this.text = before + after;
    this.cursorPosition = newPos;
  }

  getDisplayText(): string {
    return this.text;
  }

  getCursorDisplayPosition(): number {
    return this.cursorPosition;
  }
}
