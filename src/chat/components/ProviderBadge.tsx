import React from 'react';
import { Text } from 'ink';
import { Provider } from '../../types/index.js';

interface ProviderBadgeProps {
  provider: Provider;
}

export const ProviderBadge: React.FC<ProviderBadgeProps> = ({ provider }) => {
  const getBadgeStyle = (provider: Provider) => {
    switch (provider) {
      case 'claude':
        return { bg: 'magenta', label: 'CLAUDE' };
      case 'gemini':
        return { bg: 'blue', label: 'GEMINI' };
      case 'copilot':
        return { bg: 'cyan', label: 'COPILOT' };
      case 'deepseek':
        return { bg: 'yellow', label: 'DEEPSEEK' };
      case 'cursor':
        return { bg: 'magenta', label: 'CURSOR' };
    }
  };

  const style = getBadgeStyle(provider);

  return (
    <Text bold backgroundColor={style.bg} color="white">
      {` ${style.label} `}
    </Text>
  );
};

export const getProviderColor = (provider: Provider): string => {
  switch (provider) {
    case 'claude':
      return 'magenta';
    case 'gemini':
      return 'blue';
    case 'copilot':
      return 'cyan';
    case 'deepseek':
      return 'yellow';
    case 'cursor':
      return 'magenta';
  }
};
