import React, { useMemo } from 'react';
import { Box, Text, Static } from 'ink';
import { Provider, Message, StreamItem } from '../../types/index.js';
import { OutputItem } from './OutputItem.js';
import { ProviderBadge } from './ProviderBadge.js';

interface Notification {
  type: 'info' | 'error' | 'success' | 'provider-switch';
  message: string;
  from?: Provider;
  to?: Provider;
}

interface ContentAreaProps {
  currentProvider: Provider;
  switchMode: string;
  initialMessageCount: number;
  historyItems: React.ReactElement[];
  notifications: Notification[];
  pendingMessage?: Message | null;
  isLoading: boolean;
}

export const ContentArea: React.FC<ContentAreaProps> = React.memo(({
  currentProvider,
  switchMode,
  initialMessageCount,
  historyItems,
  notifications,
  pendingMessage = null,
  isLoading,
}) => {
  // Static content: completed messages
  const staticItems = useMemo(() => {
    return historyItems;
  }, [historyItems]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Static content: completed messages (never re-renders during streaming) */}
      <Static key={staticItems.length} items={staticItems}>
        {(item) => item}
      </Static>

      {/* Dynamic content: pending message and notifications */}
      <Box overflow="hidden" flexDirection="column" width="100%">
        {/* Pending message (streaming or loading) */}
        {pendingMessage && (
          <OutputItem
            message={pendingMessage}
            isStreaming={isLoading}
            currentProvider={currentProvider}
            switchMode={switchMode}
            initialMessageCount={initialMessageCount}
          />
        )}

        {/* Notifications */}
        {notifications.map((notif, idx) => {
          if (notif.type === 'info') {
            return (
              <Box key={`notif-${idx}`} marginY={1} paddingX={1}>
                <Text color="cyan">ℹ </Text>
                <Text color="white">{notif.message}</Text>
              </Box>
            );
          } else if (notif.type === 'error') {
            return (
              <Box key={`notif-${idx}`} marginY={1} paddingX={1}>
                <Text color="red">✗ Error: </Text>
                <Text color="white">{notif.message}</Text>
              </Box>
            );
          } else if (notif.type === 'success') {
            return (
              <Box key={`notif-${idx}`} marginY={1} paddingX={1}>
                <Text color="cyan">✓ </Text>
                <Text color="white">{notif.message}</Text>
              </Box>
            );
          } else if (notif.type === 'provider-switch' && notif.from && notif.to) {
            return (
              <Box key={`notif-${idx}`} flexDirection="column" marginY={1} paddingX={1}>
                <Text color="magenta">⚠ {notif.message}</Text>
                <Box>
                  <Text color="gray">  Switching from </Text>
                  <ProviderBadge provider={notif.from} />
                  <Text color="gray"> to </Text>
                  <ProviderBadge provider={notif.to} />
                </Box>
              </Box>
            );
          }
          return null;
        })}
      </Box>
    </Box>
  );
});