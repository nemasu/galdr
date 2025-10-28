/**
 * Utilities for splitting streaming messages at safe boundaries
 * to avoid excessive terminal scrollback during re-renders.
 *
 * Based on gemini-cli's approach.
 */

/**
 * Estimates the number of terminal lines a text string will occupy.
 * This is a rough approximation that accounts for:
 * - Line breaks in the text
 * - Text wrapping based on terminal width
 * - Code blocks (which don't wrap)
 */
export function estimateLineCount(text: string, terminalWidth: number = 80): number {
  if (text.length === 0) return 0;

  const lines = text.split('\n');
  let totalLines = 0;
  let inCodeBlock = false;

  for (const line of lines) {
    // Check if this line starts or ends a code block
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      totalLines += 1;
      continue;
    }

    if (inCodeBlock) {
      // Code blocks don't wrap
      totalLines += 1;
    } else {
      // Regular text wraps at terminal width
      if (line.length === 0) {
        totalLines += 1;
      } else {
        // Estimate wrapped lines (accounting for indentation and formatting)
        const effectiveWidth = Math.max(terminalWidth - 4, 40); // Leave margin
        totalLines += Math.ceil(line.length / effectiveWidth);
      }
    }
  }

  return totalLines;
}

/**
 * Finds the start of a code block that encloses the given index
 */
function findEnclosingCodeBlockStart(content: string, index: number): number {
  // Look for ``` backwards from index
  let pos = index;
  let inCodeBlock = false;
  let codeBlockStart = -1;

  // Count how many ``` we see going backwards
  let backtickCount = 0;
  for (let i = index; i >= 0; i--) {
    if (content.substring(i, i + 3) === '```') {
      backtickCount++;
      if (backtickCount === 1) {
        // First ``` going backwards - this might be the closing one
        continue;
      } else {
        // Second ``` - this is the opening one
        codeBlockStart = i;
        break;
      }
    }
  }

  // If we found an odd number of ```, we're inside a code block
  if (backtickCount % 2 === 1) {
    return codeBlockStart;
  }

  return -1;
}

/**
 * Checks if the given index is inside a code block
 */
function isIndexInsideCodeBlock(content: string, index: number): boolean {
  // Count ``` before this index
  let count = 0;
  let pos = 0;
  while (pos < index) {
    const next = content.indexOf('```', pos);
    if (next === -1 || next >= index) break;
    count++;
    pos = next + 3;
  }
  // Odd count means we're inside a code block
  return count % 2 === 1;
}

/**
 * Finds the last safe point to split the content.
 * Returns the index after which to split, or content.length if no safe split found.
 *
 * Priority:
 * 1. If content ends inside a code block, split before the block
 * 2. Find last double newline (\n\n) outside code blocks
 * 3. If no safe split, return full length (don't split)
 */
export function findLastSafeSplitPoint(content: string): number {
  if (content.length === 0) return 0;

  // 1. Check if we're ending inside a code block
  const enclosingBlockStart = findEnclosingCodeBlockStart(content, content.length);
  if (enclosingBlockStart !== -1) {
    // Split before the code block starts
    return enclosingBlockStart;
  }

  // 2. Find last double newline outside code blocks
  let searchStartIndex = content.length - 1;
  while (searchStartIndex >= 0) {
    const dnlIndex = content.lastIndexOf('\n\n', searchStartIndex);
    if (dnlIndex === -1) break;

    const potentialSplitPoint = dnlIndex + 2; // After the \n\n
    if (!isIndexInsideCodeBlock(content, potentialSplitPoint)) {
      return potentialSplitPoint;
    }
    searchStartIndex = dnlIndex - 1;
  }

  // 3. No safe split found - return full length (don't split)
  return content.length;
}

/**
 * Determines if the accumulated text should be split based on terminal height.
 * Split if text exceeds visible terminal lines AND we can find a safe split point.
 *
 * @param text The accumulated text content
 * @param terminalHeight Available terminal height (rows)
 * @param terminalWidth Terminal width for line wrapping calculations
 * @param reservedLines Lines reserved for UI elements (input area, notifications, etc.)
 * @returns true if the message should be split
 */
export function shouldSplitMessage(
  text: string,
  terminalHeight: number = 24,
  terminalWidth: number = 80,
  reservedLines: number = 8
): boolean {
  if (text.length === 0) return false;

  // Calculate how many lines are available for content
  const availableLines = Math.max(terminalHeight - reservedLines, 10);

  // Estimate how many lines this text will take
  const estimatedLines = estimateLineCount(text, terminalWidth);

  // Only split if we're exceeding available space
  if (estimatedLines < availableLines) return false;

  const splitPoint = findLastSafeSplitPoint(text);
  // Only split if we found a point that's not at the very end
  return splitPoint < text.length && splitPoint > 0;
}

/**
 * Gets the accumulated text content from stream items
 */
export function getAccumulatedText(items: Array<{ type: string; text?: string }>): string {
  return items
    .filter(item => item.type === 'text' && item.text)
    .map(item => item.text || '')
    .join('');
}
