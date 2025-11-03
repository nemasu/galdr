import React, { useMemo, useEffect, useState } from 'react';
import { Box, Text, Static, useStdout } from 'ink';
import { Provider, Message, StreamItem } from '../../types/index.js';
import { OutputItem } from './OutputItem.js';
import { verboseLogger } from '../../utils/logger.js';
import { displayManager, Notification } from '../utils/DisplayManager.js';

interface ContentAreaProps {
  currentProvider: Provider;
  switchMode: string;
  initialMessageCount: number;
  historyItems: React.ReactElement[];
  notifications: Notification[];
  pendingMessage?: Message | null;
  isLoading: boolean;
}

// Custom hook to split streaming content into static (completed lines) and dynamic (current line)
const useSplitStreamContent = (pendingMessage: Message | null, isLoading: boolean) => {
  const [accumulatedStatic, setAccumulatedStatic] = useState<StreamItem[]>([]);

  // Calculate total text length from stream items to use as dependency
  const currentTextLength = useMemo(() => {
    if (!pendingMessage?.streamItems) return 0;
    let length = 0;
    for (const item of pendingMessage.streamItems) {
      if (item.type === 'text' && item.text) {
        length += item.text.length;
      }
    }
    return length;
  }, [pendingMessage?.streamItems]);

  // Reset when message changes
  const [lastTimestamp, setLastTimestamp] = useState<number | undefined>(undefined);

  useEffect(() => {
    const currentTimestamp = pendingMessage?.timestamp;

    if (currentTimestamp !== lastTimestamp) {
      // Timestamp changed (new message started or message cleared)
      if (process.env.GALDR_VERBOSE === '1') {
        verboseLogger.log(`[useSplitStreamContent] Message change detected, clearing static. old=${lastTimestamp}, new=${currentTimestamp}`);
      }
      setAccumulatedStatic([]);
      setLastTimestamp(currentTimestamp);
    }
  }, [pendingMessage?.timestamp, lastTimestamp]);

  // Process all items to determine what should be static
  useEffect(() => {
    if (!pendingMessage || !pendingMessage.streamItems || pendingMessage.streamItems.length === 0) {
      return;
    }

    const streamItems = pendingMessage.streamItems;
    const newStatic: StreamItem[] = [];
    let accumulatedText = '';

    // Process ALL stream items to rebuild static content
    for (let i = 0; i < streamItems.length; i++) {
      const item = streamItems[i];

      if (item.type === 'text' && item.text) {
        accumulatedText += item.text;
      } else if (item.type === 'tool' || item.type === 'info') {
        // Non-text items: flush ALL accumulated text to static first
        if (accumulatedText) {
          newStatic.push({ type: 'text', text: accumulatedText });
          accumulatedText = '';
        }

        // Tools and info items are always complete, add to static
        newStatic.push(item);
      }
    }

    // Check accumulated text for completed lines
    if (accumulatedText) {
      const lines = accumulatedText.split('\n');

      if (lines.length > 1) {
        // We have completed lines
        const completedText = lines.slice(0, -1).join('\n') + '\n';
        newStatic.push({ type: 'text', text: completedText });
      } else if (accumulatedText.length > 1000) {
        // Single very long line - split it
        const completedPart = accumulatedText.slice(0, 1000);
        newStatic.push({ type: 'text', text: completedPart });
      }
    }

    // Update static items (replace completely)
    if (process.env.GALDR_VERBOSE === '1') {
      verboseLogger.log(`[useSplitStreamContent] Processing: newStatic=${newStatic.length}, accumulatedText=${accumulatedText.length} chars`);
      verboseLogger.log(`[useSplitStreamContent] currentTextLength=${currentTextLength}`);
    }
    setAccumulatedStatic(newStatic);
  }, [pendingMessage, currentTextLength]);

  // Calculate streaming items (what's not yet static)
  const streamingItems = useMemo(() => {
    if (!pendingMessage || !pendingMessage.streamItems || pendingMessage.streamItems.length === 0) {
      if (process.env.GALDR_VERBOSE === '1') {
        verboseLogger.log(`[useSplitStreamContent] streamingItems: EMPTY (no pending message)`);
      }
      return [];
    }

    const streamItems = pendingMessage.streamItems;
    const streaming: StreamItem[] = [];
    let accumulatedText = '';

    // Collect all text from stream items
    for (const item of streamItems) {
      if (item.type === 'text' && item.text) {
        accumulatedText += item.text;
      }
    }

    // Calculate how much text is already in static
    let staticTextLength = 0;
    for (const item of accumulatedStatic) {
      if (item.type === 'text' && item.text) {
        staticTextLength += item.text.length;
      }
    }

    // Get remaining text
    const remainingText = accumulatedText.slice(staticTextLength);
    if (remainingText) {
      streaming.push({ type: 'text', text: remainingText });
    }

    if (process.env.GALDR_VERBOSE === '1') {
      verboseLogger.log(`[useSplitStreamContent] streamingItems: totalText=${accumulatedText.length}, staticText=${staticTextLength}, remaining=${remainingText.length}`);
    }

    return streaming;
  }, [pendingMessage?.streamItems, accumulatedStatic]);

  // Convert static items to React elements
  const staticElements = useMemo(() => {
    if (accumulatedStatic.length === 0) {
      if (process.env.GALDR_VERBOSE === '1') {
        verboseLogger.log(`[useSplitStreamContent] staticElements: EMPTY`);
      }
      return [];
    }

    if (process.env.GALDR_VERBOSE === '1') {
      const textLength = accumulatedStatic
        .filter(item => item.type === 'text')
        .reduce((sum, item) => sum + (item.text?.length || 0), 0);
      verboseLogger.log(`[useSplitStreamContent] staticElements: ${accumulatedStatic.length} items, ${textLength} chars`);
    }

    return [(
      <Box key={`static-${pendingMessage?.timestamp || 'unknown'}`} flexDirection="column">
        {displayManager.renderStreamItems(accumulatedStatic, `static-${pendingMessage?.timestamp || 0}`)}
      </Box>
    )];
  }, [accumulatedStatic, pendingMessage?.timestamp]);

  return {
    staticElements,
    streamingItems
  };
};

export const ContentArea: React.FC<ContentAreaProps> = React.memo(({
  currentProvider,
  switchMode,
  initialMessageCount,
  historyItems,
  notifications,
  pendingMessage = null,
  isLoading,
}) => {
  // Track terminal width and update DisplayManager
  const { stdout } = useStdout();

  useEffect(() => {
    if (stdout && stdout.columns) {
      displayManager.setTerminalWidth(stdout.columns);
    }
  }, [stdout?.columns]);

  // Debug logging
  if (process.env.GALDR_VERBOSE === '1') {
    verboseLogger.log(`[ContentArea] Render: historyItems=${historyItems.length}, pendingMessage=${!!pendingMessage}, isLoading=${isLoading}`);
  }

  // Split streaming content into static (completed lines) and dynamic (current line)
  const { staticElements, streamingItems } = useSplitStreamContent(pendingMessage, isLoading);

  // Get the streaming content (current incomplete line)
  const streamingContent = useMemo(() => {
    if (!pendingMessage || !streamingItems || streamingItems.length === 0) return null;

    // Reconstruct content from streaming items
    const streamingText = streamingItems
      .filter(item => item.type === 'text' && item.text)
      .map(item => item.text)
      .join('');

    // Create a message with just the streaming items
    return {
      ...pendingMessage,
      content: streamingText,
      streamItems: streamingItems
    };
  }, [pendingMessage, streamingItems]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Completed messages from history - truly static, never changes */}
      {historyItems.length > 0 && (
        <Static items={historyItems}>
          {(item: React.ReactElement) => item}
        </Static>
      )}

      {/* Static lines from current stream - rendered normally (not in Static component) */}
      {staticElements}

      {/* Dynamic content: current streaming line and notifications */}
      <Box overflow="hidden" flexDirection="column" width="100%">
        {/* Current streaming content (incomplete line) */}
        {streamingContent && (
          <OutputItem
            message={streamingContent}
            isStreaming={isLoading}
            currentProvider={currentProvider}
            switchMode={switchMode}
            initialMessageCount={initialMessageCount}
          />
        )}

        {/* Notifications */}
        {displayManager.renderNotifications(notifications)}
      </Box>
    </Box>
  );
});