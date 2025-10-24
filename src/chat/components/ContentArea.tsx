import React from 'react';
import { Box, Text, Static } from 'ink';
import { Provider } from '../../types/index.js';
import { MessageDisplay } from './MessageDisplay.js';
import { WelcomeScreen } from './WelcomeScreen.js';
import { ProviderBadge, getProviderColor } from './ProviderBadge.js';
import { ToolDisplay } from './ToolDisplay.js';
import type { Message } from '../../types/index.js';

interface Notification {
  type: 'info' | 'error' | 'success' | 'provider-switch';
  message: string;
  from?: Provider;
  to?: Provider;
}

interface ToolInfo {
  id: string;
  name: string;
  parameters?: any;
  status: 'running' | 'success' | 'failed';
}

interface ContentAreaProps {
  showWelcome: boolean;
  currentProvider: Provider;
  switchMode: string;
  initialMessageCount: number;
  historyItems: React.ReactElement[];
  notifications: Notification[];
  streamingContent?: string;
  tools?: ToolInfo[];
}

export const ContentArea: React.FC<ContentAreaProps> = React.memo(({
  showWelcome,
  currentProvider,
  switchMode,
  initialMessageCount,
  historyItems,
  notifications,
  streamingContent = '',
  tools = [],
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

      {/* Display streaming content if any */}
      {streamingContent && (
        <Box flexDirection="column" marginY={1} paddingX={1}>
          <Text bold color={getProviderColor(currentProvider)}>
            {currentProvider.charAt(0).toUpperCase() + currentProvider.slice(1)}:
          </Text>
          <Text color="white">{streamingContent}</Text>
        </Box>
      )}

      {/* Display tool usage */}
      {tools.map((tool) => (
        <ToolDisplay key={tool.id} name={tool.name} parameters={tool.parameters} status={tool.status} />
      ))}

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
