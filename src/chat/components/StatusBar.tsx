import React from 'react';
import { Box, Text } from 'ink';
import { Provider } from '../../types/index.js';
import { ProviderBadge, getProviderColor } from './ProviderBadge.js';
import { CustomSpinner } from './CustomSpinner.js';

interface StatusBarProps {
  provider: Provider;
  isLoading?: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = React.memo(({ provider, isLoading = false }) => {
  const color = getProviderColor(provider);

  return (
    <Box paddingX={1} marginBottom={1}>
      <Box>
        {isLoading ? (
          <>
            <CustomSpinner />
            <Text> </Text>
          </>
        ) : (
          <Text color={color}>●</Text>
        )}
        <Text> </Text>
        <ProviderBadge provider={provider} />
      </Box>
    </Box>
  );
});
