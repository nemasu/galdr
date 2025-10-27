import React from 'react';
import { Box, Text } from 'ink';
import { Provider, ToolInfo, Message, StreamItem } from '../../types/index.js';
import { getProviderColor } from './ProviderBadge.js';

interface OutputItemProps {
  message: Message;
  isStreaming?: boolean;
}

const ToolInfoDisplay: React.FC<{ tool: ToolInfo }> = ({ tool }) => {
  const params = tool.parameters ? JSON.stringify(tool.parameters, null, 0) : '';
  const shouldShowParams = params && params.length < 100;

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2}>
      <Box>
        <Text color="magenta">🔧 Using tool: {tool.name}</Text>
        {shouldShowParams && <Text dimColor> {params}</Text>}
      </Box>
      {tool.status === 'success' && (
        <Box paddingLeft={2}>
          <Text dimColor>✓ Complete</Text>
        </Box>
      )}
      {tool.status === 'failed' && (
        <Box paddingLeft={2}>
          <Text color="red">✗ Failed</Text>
        </Box>
      )}
    </Box>
  );
};

export const OutputItem: React.FC<OutputItemProps> = React.memo(({ message, isStreaming = false }) => {
  if (message.role === 'user') {
    return (
      <Box flexDirection="column" marginY={1} paddingX={1}>
        <Text bold color="cyan">
          You:
        </Text>
        <Text color="white">{message.content}</Text>
      </Box>
    );
  }

  // Assistant message
  const color = message.provider ? getProviderColor(message.provider) : 'magenta';
  const providerName = message.provider
    ? message.provider.charAt(0).toUpperCase() + message.provider.slice(1)
    : 'Assistant';

  // Use streamItems if available (interleaved), otherwise fall back to content + tools
  const hasStreamItems = message.streamItems && message.streamItems.length > 0;

  return (
    <Box flexDirection="column" marginY={1} paddingX={1}>
      <Text bold color={color}>
        {providerName}:
      </Text>

      {/* Render stream items in order (text and tools interleaved) */}
      {hasStreamItems ? (
        <Box flexDirection="column">
          {(() => {
            const elements: React.ReactNode[] = [];
            let textBuffer: string[] = [];
            let textKey = 0;

            const flushTextBuffer = () => {
              if (textBuffer.length > 0) {
                elements.push(
                  <Text key={`text-${textKey++}`} color="white">
                    {textBuffer.join('')}
                  </Text>
                );
                textBuffer = [];
              }
            };

            message.streamItems!.forEach((item, idx) => {
              if (item.type === 'text' && item.text) {
                textBuffer.push(item.text);
              } else if (item.type === 'tool' && item.tool) {
                flushTextBuffer();
                elements.push(<ToolInfoDisplay key={`stream-${idx}`} tool={item.tool} />);
              } else if (item.type === 'info' && item.info) {
                flushTextBuffer();
                elements.push(
                  <Box key={`info-${idx}`} marginTop={1} paddingLeft={2}>
                    <Text color="cyan" dimColor>ℹ {item.info}</Text>
                  </Box>
                );
              }
            });

            flushTextBuffer();
            return elements;
          })()}
        </Box>
      ) : (
        <>
          {/* Fallback: render content first, then tools */}
          <Text color="white">{message.content}</Text>

          {/* Display tools if any */}
          {message.tools && message.tools.length > 0 && (
            <Box flexDirection="column">
              {message.tools.map((tool) => (
                <ToolInfoDisplay key={tool.id} tool={tool} />
              ))}
            </Box>
          )}
        </>
      )}

      {/* Separator line (only for non-streaming completed messages) */}
      {!isStreaming && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            {'─'.repeat(80)}
          </Text>
        </Box>
      )}
    </Box>
  );
});
