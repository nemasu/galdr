import React from 'react';
import { Box, Text } from 'ink';

interface ToolDisplayProps {
  name: string;
  parameters?: any;
  status?: 'running' | 'success' | 'failed';
}

export const ToolDisplay: React.FC<ToolDisplayProps> = ({ name, parameters, status = 'running' }) => {
  const params = parameters ? JSON.stringify(parameters, null, 0) : '';
  const shouldShowParams = params && params.length < 100;

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color="magenta">🔧 Using tool: {name}</Text>
        {shouldShowParams && <Text dimColor> {params}</Text>}
      </Box>
      {status === 'success' && (
        <Box paddingLeft={2}>
          <Text dimColor>✓ Complete</Text>
        </Box>
      )}
      {status === 'failed' && (
        <Box paddingLeft={2}>
          <Text color="red">✗ Failed</Text>
        </Box>
      )}
    </Box>
  );
};
