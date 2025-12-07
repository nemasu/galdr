import React, { useMemo, useEffect } from 'react';
import { Box, useStdout, Static } from 'ink';
import { Provider, Message } from '../../types/index.js';
import { OutputItem } from './OutputItem.js';
import { verboseLogger } from '../../utils/logger.js';
import { displayManager, Notification } from '../utils/DisplayManager.js';

interface ContentAreaProps {
  currentProvider: Provider;
  switchMode: string;
  initialMessageCount: number;
  messages: Message[];
  notifications: Notification[];
  pendingMessage?: Message | null;
  isLoading: boolean;
}


// Simplified streaming - just render all stream items without trying to split them
const useStreamContent = (pendingMessage: Message | null) => {
  // Just return all stream items as-is
  const streamingItems = useMemo(() => {
    if (!pendingMessage?.streamItems) return [];
    return pendingMessage.streamItems;
  }, [pendingMessage?.streamItems]);

  return streamingItems;
};

export const ContentArea: React.FC<ContentAreaProps> = React.memo(({
  currentProvider,
  switchMode,
  initialMessageCount,
  messages,
  notifications,
  pendingMessage = null,
  isLoading,
}) => {
  // Track terminal dimensions and update DisplayManager
  const { stdout } = useStdout();

  useEffect(() => {
    if (stdout && stdout.columns) {
      displayManager.setTerminalWidth(stdout.columns);
    }
  }, [stdout?.columns]);

  // Debug logging
  if (process.env.GALDR_VERBOSE === '1') {
    verboseLogger.log(`[ContentArea] ===== RENDER =====`);
    verboseLogger.log(`[ContentArea] messages.length=${messages.length}`);
    verboseLogger.log(`[ContentArea] pendingMessage=${!!pendingMessage}`);
    verboseLogger.log(`[ContentArea] isLoading=${isLoading}`);

    if (messages.length > 0) {
      verboseLogger.log(`[ContentArea] Visible items in RED box:`);
      messages.slice(-5).forEach((item, idx) => {
        verboseLogger.log(`  [last-${idx}] timestamp=${item.timestamp}`);
      });
    } else {
      verboseLogger.log(`[ContentArea] RED box is EMPTY`);
    }

    if (pendingMessage) {
      verboseLogger.log(`[ContentArea] BLUE box has streaming content: ${pendingMessage.content?.substring(0, 100)}...`);
    } else {
      verboseLogger.log(`[ContentArea] BLUE box is EMPTY (no streaming content)`);
    }
    verboseLogger.log(`[ContentArea] ===================`);
  }

  // Get streaming items
  const streamingItems = useStreamContent(pendingMessage);

  // Create streaming message content - no truncation needed since content
  // is progressively moved to static area during streaming
  const streamingContent = useMemo(() => {
    if (!pendingMessage || !streamingItems || streamingItems.length === 0) return null;
    return pendingMessage;
  }, [pendingMessage, streamingItems]);

  const isVerbose = process.env.GALDR_VERBOSE === '1';

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* All completed content - Static prevents re-rendering */}
      {messages.length > 0 && (
        <Static items={messages}>
          {(msg: Message, index: number) => {
            const item = (
              <OutputItem
                key={msg.timestamp}
                message={msg}
                currentProvider={currentProvider}
                switchMode={switchMode}
                initialMessageCount={initialMessageCount}
              />
            );

            if (isVerbose) {
              return (
                <Box key={msg.timestamp} borderStyle="single" borderColor="red">
                  {item}
                </Box>
              );
            }

            return item;
          }}
        </Static>
      )}

      {/* Dynamic content: current streaming content and notifications */}
      <Box
        flexDirection="column"
        borderStyle={isVerbose ? 'single' : undefined}
        borderColor={isVerbose ? 'blue' : undefined}
      >
        {/* Current streaming content */}
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
        {isVerbose && notifications.length > 0 && (
          <Box borderStyle="single" borderColor="yellow">
            {displayManager.renderNotifications(notifications)}
          </Box>
        )}
        {!isVerbose && displayManager.renderNotifications(notifications)}
      </Box>
    </Box>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if meaningful props change
  // Don't re-render on notifications array reference changes if content is same
  const notificationsChanged =
    prevProps.notifications.length !== nextProps.notifications.length ||
    prevProps.notifications.some((n, i) => n !== nextProps.notifications[i]);

  return (
    prevProps.currentProvider === nextProps.currentProvider &&
    prevProps.switchMode === nextProps.switchMode &&
    prevProps.initialMessageCount === nextProps.initialMessageCount &&
    prevProps.messages === nextProps.messages &&
    !notificationsChanged &&
    prevProps.pendingMessage === nextProps.pendingMessage &&
    prevProps.isLoading === nextProps.isLoading
  );
});