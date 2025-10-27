import React, { useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { Provider } from '../../types/index.js';
import { useKeypress, Key } from '../contexts/KeypressContext.js';
import { TextBuffer } from '../utils/TextBuffer.js';
import { ProviderBadge } from './ProviderBadge.js';
import { CustomSpinner } from './CustomSpinner.js';
import { getProviderColor } from './ProviderBadge.js';

interface InputAreaProps {
  buffer: TextBuffer;
  onSubmit: (text: string) => void;
  isActive: boolean;
  provider: Provider;
  isLoading?: boolean;
  label?: string;
}

export const InputArea: React.FC<InputAreaProps> = React.memo(({
  buffer,
  onSubmit,
  isActive,
  provider,
  isLoading = false,
  label = 'You> ',
}) => {
  const [, forceUpdate] = useState(0);
  const [pasteInfo, setPasteInfo] = useState<{ lineCount: number } | null>(null);
  const { stdout } = useStdout();
  const color = getProviderColor(provider);

  const handleKeypress = (key: Key) => {
    if (!isActive) return;

    // Handle paste
    if (key.paste && key.pasteContent) {
      buffer.insertText(key.pasteContent);
      // Count lines - handle Windows (\r\n), Unix (\n), and old Mac (\r) line endings
      const lineCount = key.pasteContent.split(/\r\n|\r|\n/).length;
      const terminalWidth = stdout?.columns || 80;
      const labelWidth = label.length;
      const contentWidth = key.pasteContent.length;
      
      // Only show paste info if more than 1 line OR if content exceeds terminal width
      if (lineCount > 1 || (contentWidth + labelWidth) > terminalWidth) {
        setPasteInfo({ lineCount });
      }
      forceUpdate((n) => n + 1);
      return;
    }

    // Handle Enter
    if (key.name === 'return') {
      // Ctrl+Return inserts newline, plain Return submits
      if (key.ctrl) {
        buffer.insertText('\n');
        setPasteInfo(null);
        forceUpdate((n) => n + 1);
        return;
      }

      const text = buffer.getText();
      if (text.trim()) {
        onSubmit(text.trim());
        buffer.clear();
        setPasteInfo(null);
        forceUpdate((n) => n + 1);
      }
      return;
    }

    // Handle backspace/delete
    if (key.name === 'backspace') {
      buffer.deleteChar();
      setPasteInfo(null);
      forceUpdate((n) => n + 1);
      return;
    }

    if (key.name === 'delete') {
      buffer.deleteForward();
      setPasteInfo(null);
      forceUpdate((n) => n + 1);
      return;
    }

    // Handle arrow keys
    if (key.name === 'left') {
      if (key.ctrl) {
        buffer.moveToWordStart();
      } else {
        buffer.moveLeft();
      }
      forceUpdate((n) => n + 1);
      return;
    }

    if (key.name === 'right') {
      if (key.ctrl) {
        buffer.moveToWordEnd();
      } else {
        buffer.moveRight();
      }
      forceUpdate((n) => n + 1);
      return;
    }

    // Handle Home/End
    if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
      buffer.moveToStart();
      forceUpdate((n) => n + 1);
      return;
    }

    if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
      buffer.moveToEnd();
      forceUpdate((n) => n + 1);
      return;
    }

    // Handle Ctrl+W (delete word)
    if (key.ctrl && key.name === 'w') {
      buffer.deleteWord();
      forceUpdate((n) => n + 1);
      return;
    }

    // Handle Ctrl+U (clear line)
    if (key.ctrl && key.name === 'u') {
      buffer.clear();
      setPasteInfo(null);
      forceUpdate((n) => n + 1);
      return;
    }

    // Handle Ctrl+C (clear buffer if there's text)
    if (key.ctrl && key.name === 'c') {
      const text = buffer.getText();
      if (text.length > 0) {
        buffer.clear();
        setPasteInfo(null);
        forceUpdate((n) => n + 1);
        return;
      }
      // If buffer is empty, let it propagate for normal interrupt behavior
    }

    // Handle Ctrl+K (delete to end)
    if (key.ctrl && key.name === 'k') {
      const pos = buffer.getCursorPosition();
      const text = buffer.getText();
      buffer.setText(text.slice(0, pos));
      forceUpdate((n) => n + 1);
      return;
    }

    // Handle regular character input
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      buffer.insertText(key.sequence);
      setPasteInfo(null);
      forceUpdate((n) => n + 1);
      return;
    }
  };

  useKeypress(handleKeypress, { isActive });

  // Use paste info display if available, otherwise show actual text
  const text = pasteInfo
    ? `[Pasted ${pasteInfo.lineCount} line${pasteInfo.lineCount !== 1 ? 's' : ''}]`
    : buffer.getDisplayText();
  const cursorPos = buffer.getCursorDisplayPosition();

  // Split text into lines
  const lines = pasteInfo ? [text] : text.split('\n');

  // Find which line the cursor is on
  let charsProcessed = 0;
  let cursorLine = 0;
  let cursorCol = cursorPos;

  if (!pasteInfo) {
    for (let i = 0; i < lines.length; i++) {
      const lineLength = lines[i].length;
      if (charsProcessed + lineLength >= cursorPos) {
        cursorLine = i;
        cursorCol = cursorPos - charsProcessed;
        break;
      }
      charsProcessed += lineLength + 1; // +1 for the newline character
    }
  } else {
    // When showing paste info, cursor position doesn't apply
    cursorLine = 0;
    cursorCol = text.length;
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      {/* Provider badge and status */}
      <Box marginBottom={1}>
        {isLoading ? (
          <>
            <CustomSpinner />
            <Text> </Text>
          </>
        ) : (
          <Text color={color}>●</Text>
        )}
        <Text> </Text>
        <ProviderBadge provider={provider} />
      </Box>

      {/* Input prompt */}
      <Box flexDirection="column">
        {lines.map((line, idx) => {
          if (idx === cursorLine) {
            const beforeCursor = line.slice(0, cursorCol);
            const atCursor = line[cursorCol] || ' ';
            const afterCursor = line.slice(cursorCol + 1);
            return (
              <Box key={idx}>
                {idx === 0 && (
                  <Text color="cyan" bold>
                    {label}
                  </Text>
                )}
                {idx !== 0 && <Text>{'  '}</Text>}
                {pasteInfo ? (
                  <Text color="green">{line}</Text>
                ) : (
                  <>
                    <Text>{beforeCursor}</Text>
                    {isActive && <Text inverse>{atCursor}</Text>}
                    {!isActive && <Text dimColor>{atCursor}</Text>}
                    <Text>{afterCursor}</Text>
                  </>
                )}
              </Box>
            );
          }
          return (
            <Box key={idx}>
              {idx === 0 && (
                <Text color="cyan" bold>
                  {label}
                </Text>
              )}
              {idx !== 0 && <Text>{'  '}</Text>}
              <Text>{line}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}, (prevProps, nextProps) => {
  // Re-render if any of these props change
  return (
    prevProps.isActive === nextProps.isActive &&
    prevProps.label === nextProps.label &&
    prevProps.provider === nextProps.provider &&
    prevProps.isLoading === nextProps.isLoading
  );
});
