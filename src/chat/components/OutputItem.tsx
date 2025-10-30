import React from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import { Provider, ToolInfo, Message, StreamItem } from '../../types/index.js';
import { getProviderColor, ProviderBadge } from './ProviderBadge.js';

interface OutputItemProps {
  message: Message;
  isStreaming?: boolean;
  currentProvider?: Provider;
  switchMode?: string;
  initialMessageCount?: number;
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

export const OutputItem: React.FC<OutputItemProps> = React.memo(({ 
  message, 
  isStreaming = false,
  currentProvider = 'claude',
  switchMode = 'manual',
  initialMessageCount = 0
}) => {
  // Handle special startup message
  if (message.content === '__STARTUP_MESSAGE__') {
    return (
      <Box flexDirection="column" marginY={1} paddingX={1}>
        <Box borderStyle="bold" borderColor="magenta" paddingX={1}>
          <Gradient name="passion">
            <Text bold>GALDR</Text>
          </Gradient>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color="gray">Active Provider: </Text>
            <ProviderBadge provider={currentProvider} />
            <Text color="gray"> │ Switch Mode: </Text>
            <Text color="magenta">{switchMode}</Text>
            {process.env.GALDR_VERBOSE === '1' && (
              <>
                <Text color="gray"> │ </Text>
                <Text backgroundColor="magenta" color="white"> VERBOSE </Text>
              </>
            )}
          </Box>
          {initialMessageCount > 0 && (
            <Box marginTop={1}>
              <Text color="cyan">Context: {initialMessageCount} messages restored</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color="yellow">Type </Text>
            <Text color="yellowBright" bold>/help</Text>
            <Text color="yellow"> for command list</Text>
          </Box>
          <Box>
            <Text color="yellowBright">Ctrl+S</Text>
            <Text color="gray"> for session management</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">{'─'.repeat(80)}</Text>
        </Box>
      </Box>
    );
  }

  // Handle special help message
  if (message.content === '__HELP_MESSAGE__') {
    return (
      <Box flexDirection="column" marginY={1} paddingX={1}>
        <Box borderStyle="bold" borderColor="magenta" paddingX={1}>
          <Gradient name="passion">
            <Text bold>GALDR - Commands</Text>
          </Gradient>
        </Box>
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          <Text><Text color="cyan" bold>/exit</Text><Text color="gray">, </Text><Text color="cyan" bold>/quit</Text>        <Text color="white">Exit chat</Text></Text>
          <Text><Text color="cyan" bold>/switch</Text> <Text color="yellow">{'<provider>'}</Text>  <Text color="white">Switch provider (claude, gemini, copilot, deepseek, cursor)</Text></Text>
          <Text><Text color="cyan" bold>/mode</Text> <Text color="yellow">{'<mode>'}</Text>        <Text color="white">Set switch mode (manual, rollover, round-robin)</Text></Text>
          <Text><Text color="cyan" bold>/clear</Text>              <Text color="white">Clear chat history</Text></Text>
          <Text><Text color="cyan" bold>/compact</Text> <Text color="yellow">[keep]</Text>     <Text color="white">Compact history, keep N recent messages (default: 10)</Text></Text>
          <Text><Text color="cyan" bold>/history</Text>            <Text color="white">Show history statistics</Text></Text>
          <Text><Text color="cyan" bold>/status</Text>             <Text color="white">Show provider status</Text></Text>
          <Text><Text color="cyan" bold>/verbose</Text>            <Text color="white">Toggle verbose output mode</Text></Text>
          <Text><Text color="cyan" bold>/model</Text> <Text color="yellow">{'<p>'}</Text> <Text color="yellow">{'<model>'}</Text>  <Text color="white">Set model for provider (e.g., /model claude default)</Text></Text>
          <Text><Text color="cyan" bold>/sessions</Text>           <Text color="white">List all sessions</Text></Text>
          <Text><Text color="cyan" bold>/session-new</Text> <Text color="yellow">{'<name>'}</Text> <Text color="white">Create a new session</Text></Text>
          <Text><Text color="cyan" bold>/session-load</Text> <Text color="yellow">{'<name>'}</Text> <Text color="white">Load a session</Text></Text>
          <Text><Text color="cyan" bold>/session-delete</Text> <Text color="yellow">{'<n>'}</Text> <Text color="white">Delete a session</Text></Text>
          <Text><Text color="cyan" bold>/session-rename</Text>     <Text color="white">Rename a session</Text></Text>
          <Text><Text color="cyan" bold>/help</Text>               <Text color="white">Show this help</Text></Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">{'─'.repeat(80)}</Text>
        </Box>
      </Box>
    );
  }

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
