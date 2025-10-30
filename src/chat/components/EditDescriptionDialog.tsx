import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useKeypress, Key } from '../contexts/KeypressContext.js';

interface EditDescriptionDialogProps {
  sessionName: string;
  currentDescription?: string;
  onConfirm: (description: string) => void;
  onCancel: () => void;
  isActive: boolean;
}

export const EditDescriptionDialog: React.FC<EditDescriptionDialogProps> = ({
  sessionName,
  currentDescription,
  onConfirm,
  onCancel,
  isActive,
}) => {
  const [description, setDescription] = useState(currentDescription || '');

  const handleKeypress = (key: Key) => {
    if (!isActive) return;

    if (key.name === 'escape') {
      onCancel();
      return;
    }
  };

  useKeypress(handleKeypress, { isActive });

  const handleSubmit = (value: string) => {
    onConfirm(value.trim());
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">
          Edit Session Description
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>Session: {sessionName}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>Description: </Text>
        <TextInput
          value={description}
          onChange={setDescription}
          onSubmit={handleSubmit}
          placeholder="Brief description of this session"
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press Enter to save, Esc to cancel</Text>
      </Box>
    </Box>
  );
};