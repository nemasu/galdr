/**
 * Input history management for tracking and navigating through previous user inputs
 */
export class InputHistory {
  private history: string[] = [];
  private currentIndex: number = -1; // -1 means we're not browsing history (at current input)
  private maxSize: number = 100;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Add a new input to history
   */
  add(input: string): void {
    if (!input.trim()) {
      return; // Don't add empty inputs
    }

    // Remove duplicates - if the last item is the same, don't add
    if (this.history.length > 0 && this.history[this.history.length - 1] === input) {
      return;
    }

    this.history.push(input);
    
    // Trim history if it exceeds max size
    if (this.history.length > this.maxSize) {
      this.history = this.history.slice(-this.maxSize);
    }
    
    // Reset current index when adding new input
    this.currentIndex = -1;
  }

  /**
   * Load history from session data (user messages)
   */
  loadFromSession(messages: Array<{ role: string; content: string }>): void {
    // Extract user messages and add them to history
    const userMessages = messages
      .filter(msg => msg.role === 'user')
      .map(msg => msg.content)
      .filter(content => content.trim()); // Filter out empty messages

    // Add to history, avoiding duplicates
    userMessages.forEach(message => {
      if (!this.history.includes(message)) {
        this.history.push(message);
      }
    });

    // Trim history if it exceeds max size
    if (this.history.length > this.maxSize) {
      this.history = this.history.slice(-this.maxSize);
    }

    // Reset browsing position
    this.currentIndex = -1;
  }

  /**
   * Get previous input from history
   */
  getPrevious(): string | null {
    if (this.history.length === 0) {
      return null;
    }

    if (this.currentIndex === -1) {
      // Start browsing from the end
      this.currentIndex = this.history.length - 1;
    } else if (this.currentIndex > 0) {
      // Move to previous item
      this.currentIndex--;
    } else {
      // Already at the beginning, stay there
      return this.history[this.currentIndex];
    }

    return this.history[this.currentIndex];
  }

  /**
   * Get next input from history
   */
  getNext(): string | null {
    if (this.history.length === 0 || this.currentIndex === -1) {
      return null;
    }

    if (this.currentIndex < this.history.length - 1) {
      // Move to next item
      this.currentIndex++;
      return this.history[this.currentIndex];
    } else {
      // At the end, return to current input (empty)
      this.currentIndex = -1;
      return '';
    }
  }

  /**
   * Reset history browsing to current input
   */
  resetBrowsing(): void {
    this.currentIndex = -1;
  }

  /**
   * Get all history items (for debugging)
   */
  getAll(): string[] {
    return [...this.history];
  }

  /**
   * Clear history
   */
  clear(): void {
    this.history = [];
    this.currentIndex = -1;
  }

  /**
   * Get current browsing index
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Get total history size
   */
  getSize(): number {
    return this.history.length;
  }
}