import React from 'react';
import { Box, Text, Static } from 'ink';
import { Provider, ToolInfo, Message, StreamItem } from '../../types/index.js';
import { OutputItem } from './OutputItem.js';
import { WelcomeScreen } from './WelcomeScreen.js';
import { ProviderBadge } from './ProviderBadge.js';

interface Notification {
  type: 'info' | 'error' | 'success' | 'provider-switch';
  message: string;
  from?: Provider;
  to?: Provider;
}

interface ContentAreaProps {
  showWelcome: boolean;
  currentProvider: Provider;
  switchMode: string;
  initialMessageCount: number;
  historyItems: React.ReactElement[];
  notifications: Notification[];
  streamingItems?: StreamItem[];
}

export const ContentArea: React.FC<ContentAreaProps> = React.memo(({
  showWelcome,
  currentProvider,
  switchMode,
  initialMessageCount,
  historyItems,
  notifications,
  streamingItems = [],
}) => {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {showWelcome && (
        <WelcomeScreen provider={currentProvider} switchMode={switchMode} messageCount={initialMessageCount} />
      )}

      {/* Display completed messages using Static (immutable) */}
      {historyItems.length > 0 && (
        <Static key="history-static" items={historyItems}>
          {(item) => item}
        </Static>
      )}

      {/* Display streaming content with tools (unified and interleaved) */}
      {streamingItems.length > 0 && (
        <OutputItem
          message={{
            role: 'assistant',
            content: '', // Content is in streamItems
            timestamp: Date.now(),
            provider: currentProvider,
            streamItems: streamingItems,
          }}
          isStreaming={true}
        />
      )}

      {/* Display notifications */}
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
  );
});
