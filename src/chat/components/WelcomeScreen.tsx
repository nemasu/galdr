import React from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import { Provider } from '../../types/index.js';
import { ProviderBadge } from './ProviderBadge.js';

interface WelcomeScreenProps {
  provider: Provider;
  switchMode: string;
  messageCount?: number;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  provider,
  switchMode,
  messageCount = 0
}) => {
  return (
    <Box flexDirection="column">
      <Box borderStyle="bold" borderColor="magenta" paddingX={1}>
        <Gradient name="passion">
          <Text bold>GALDR</Text>
        </Gradient>
      </Box>

      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Box>
          <Text color="gray">Active Provider: </Text>
          <ProviderBadge provider={provider} />
          <Text color="gray"> │ Switch Mode: </Text>
          <Text color="magenta">{switchMode}</Text>
          {process.env.GALDR_VERBOSE === '1' && (
            <>
              <Text color="gray"> │ </Text>
              <Text backgroundColor="magenta" color="white"> VERBOSE </Text>
            </>
          )}
        </Box>

        {messageCount > 0 && (
          <Box marginTop={1}>
            <Text color="gray">Context: </Text>
            <Text color="cyan">{messageCount} messages restored</Text>
          </Box>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text bold color="magenta">Commands:</Text>
        <Box>
          <Text color="gray">  /exit, /quit       </Text>
          <Text color="white">Exit chat</Text>
        </Box>
        <Box>
          <Text color="gray">  /switch &lt;provider&gt; </Text>
          <Text color="white">Switch provider (claude, gemini, copilot)</Text>
        </Box>
        <Box>
          <Text color="gray">  /mode &lt;mode&gt;       </Text>
          <Text color="white">Set switch mode (manual, rollover, round-robin)</Text>
        </Box>
        <Box>
          <Text color="gray">  /clear             </Text>
          <Text color="white">Clear chat history</Text>
        </Box>
        <Box>
          <Text color="gray">  /compact [keep]    </Text>
          <Text color="white">Compact history, keep N recent messages (default: 10)</Text>
        </Box>
        <Box>
          <Text color="gray">  /history           </Text>
          <Text color="white">Show history statistics</Text>
        </Box>
        <Box>
          <Text color="gray">  /status            </Text>
          <Text color="white">Show provider status</Text>
        </Box>
        <Box>
          <Text color="gray">  /verbose           </Text>
          <Text color="white">Toggle verbose output mode</Text>
        </Box>
        <Box>
          <Text color="gray">  /help              </Text>
          <Text color="white">Show this help</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>{'─'.repeat(80)}</Text>
      </Box>
    </Box>
  );
};
