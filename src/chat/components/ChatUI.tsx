import React, { useState, useEffect } from 'react';
import { Box, useInput, useApp, Text } from 'ink';
import { Provider } from '../../types';
import { StatusBar } from './StatusBar';
import { MessageDisplay } from './MessageDisplay';
import { WelcomeScreen } from './WelcomeScreen';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  provider?: Provider;
  timestamp: number;
}

interface ChatUIProps {
  currentProvider: Provider;
  switchMode: string;
  messages: Message[];
  isLoading: boolean;
  onInput: (input: string) => void;
  onExit: () => void;
  onCancel: () => void;
  initialMessageCount?: number;
}

export const ChatUI: React.FC<ChatUIProps> = ({
  currentProvider,
  switchMode,
  messages,
  isLoading,
  onInput,
  onExit,
  onCancel,
  initialMessageCount = 0
}) => {
  const [input, setInput] = useState('');
  const [showWelcome, setShowWelcome] = useState(true);
  const { exit } = useApp();

  useEffect(() => {
    if (messages.length > 0) {
      setShowWelcome(false);
    }
  }, [messages]);

  useInput((inputChar, key) => {
    // Handle Ctrl+C and Escape for cancellation
    if (key.ctrl && inputChar === 'c') {
      onCancel();
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    // Handle Enter key
    if (key.return) {
      if (input.trim()) {
        onInput(input.trim());
        setInput('');
      }
      return;
    }

    // Handle backspace
    if (key.backspace || key.delete) {
      setInput(input.slice(0, -1));
      return;
    }

    // Add character to input
    if (!key.ctrl && !key.meta && inputChar) {
      setInput(input + inputChar);
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      {/* Main content area */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {showWelcome && (
          <WelcomeScreen
            provider={currentProvider}
            switchMode={switchMode}
            messageCount={initialMessageCount}
          />
        )}

        {messages.map((msg, idx) => (
          <MessageDisplay key={idx} message={msg} />
        ))}
      </Box>

      {/* Fixed status bar at bottom */}
      <StatusBar provider={currentProvider} isLoading={isLoading} />

      {/* Input prompt */}
      <Box paddingX={1}>
        <Text color="cyan" bold>You&gt; </Text>
        <Text>{input}</Text>
        <Text inverse> </Text>
      </Box>
    </Box>
  );
};
