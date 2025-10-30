import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useKeypress, Key } from '../contexts/KeypressContext.js';

interface NewSessionDialogProps {
  onConfirm: (name: string, description?: string) => void;
  onCancel: () => void;
  isActive: boolean;
  existingSessions: string[];
}

export const NewSessionDialog: React.FC<NewSessionDialogProps> = ({
  onConfirm,
  onCancel,
  isActive,
  existingSessions,
}) => {
  const [step, setStep] = useState<'name' | 'description'>('name');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleKeypress = (key: Key) => {
    if (!isActive) return;

    if (key.name === 'escape') {
      onCancel();
      return;
    }
  };

  useKeypress(handleKeypress, { isActive });

  const handleNameSubmit = (value: string) => {
    const trimmedName = value.trim();
    
    if (!trimmedName) {
      setError('Session name cannot be empty');
      return;
    }

    if (existingSessions.includes(trimmedName)) {
      setError(`Session "${trimmedName}" already exists`);
      return;
    }

    // Valid name, move to description step
    setName(trimmedName);
    setError(null);
    setStep('description');
  };

  const handleDescriptionSubmit = (value: string) => {
    const trimmedDesc = value.trim();
    onConfirm(name, trimmedDesc || undefined);
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="green">
          Create New Session
        </Text>
      </Box>

      {step === 'name' ? (
        <>
          <Box marginBottom={1}>
            <Text>Session name: </Text>
            <TextInput
              value={name}
              onChange={setName}
              onSubmit={handleNameSubmit}
              placeholder="e.g., project-todo, meeting-notes"
            />
          </Box>
          {error && (
            <Box>
              <Text color="red">{error}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press Enter to continue, Esc to cancel</Text>
          </Box>
        </>
      ) : (
        <>
          <Box marginBottom={1}>
            <Text dimColor>Session: {name}</Text>
          </Box>
          <Box marginBottom={1}>
            <Text>Description (optional): </Text>
            <TextInput
              value={description}
              onChange={setDescription}
              onSubmit={handleDescriptionSubmit}
              placeholder="Brief description of this session"
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Enter to create, Esc to cancel</Text>
          </Box>
        </>
      )}
    </Box>
  );
};