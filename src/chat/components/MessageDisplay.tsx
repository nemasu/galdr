import React from 'react';
import { Box, Text } from 'ink';
import { Provider } from '../../types/index.js';
import { getProviderColor } from './ProviderBadge.js';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  provider?: Provider;
}

interface MessageDisplayProps {
  message: Message;
}

export const MessageDisplay: React.FC<MessageDisplayProps> = React.memo(({ message }) => {
  if (message.role === 'user') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold color="cyan">
          You:
        </Text>
        <Text color="white">{message.content}</Text>
      </Box>
    );
  }

  // Assistant message
  const color = message.provider ? getProviderColor(message.provider) : 'magenta';

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color={color}>
        {message.provider ? message.provider.charAt(0).toUpperCase() + message.provider.slice(1) : 'Assistant'}:
      </Text>
      <Text color="white">{message.content}</Text>
      <Text color="gray" dimColor>{'─'.repeat(80)}</Text>
    </Box>
  );
});
