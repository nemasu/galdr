import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useKeypress, Key } from '../contexts/KeypressContext.js';

interface SessionInfo {
  name: string;
  messageCount: number;
  lastAccessed: number;
  description?: string;
}

interface SessionSelectorProps {
  sessions: SessionInfo[];
  currentSession: string;
  onSelect: (sessionName: string) => void;
  onNewSession: () => void;
  onClose: () => void;
  onDelete: (sessionName: string) => void;
  onEditDescription: (sessionName: string) => void;
  isActive: boolean;
}

export const SessionSelector: React.FC<SessionSelectorProps> = ({
  sessions,
  currentSession,
  onSelect,
  onNewSession,
  onClose,
  onDelete,
  onEditDescription,
  isActive,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const allItems = ['__NEW__', ...sessions.map(s => s.name)];

  // Set initial selected index to current session
  useEffect(() => {
    const currentIndex = sessions.findIndex(s => s.name === currentSession);
    if (currentIndex >= 0) {
      setSelectedIndex(currentIndex + 1); // +1 because "New..." is at index 0
    }
  }, [sessions, currentSession]);

  const handleKeypress = (key: Key) => {
    if (!isActive) return;

    if (key.name === 'escape') {
      onClose();
      return;
    }

    if (key.name === 'up' || (key.ctrl && key.name === 'p')) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.name === 'down' || (key.ctrl && key.name === 'n')) {
      setSelectedIndex((prev) => Math.min(allItems.length - 1, prev + 1));
    } else if (key.name === 'return') {
      if (selectedIndex === 0) {
        onNewSession();
      } else {
        const sessionName = allItems[selectedIndex];
        onSelect(sessionName);
      }
    } else if (key.name === 'd') {
      // Delete session
      if (selectedIndex > 0) { // Can't delete "New..." option
        const sessionName = allItems[selectedIndex];
        if (sessionName !== currentSession) {
          onDelete(sessionName);
        }
      }
    } else if (key.name === 'e') {
      // Edit description
      if (selectedIndex > 0) { // Can't edit "New..." option
        const sessionName = allItems[selectedIndex];
        onEditDescription(sessionName);
      }
    }
  };

  useKeypress(handleKeypress, { isActive });

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Sessions (↑↓ to navigate, Enter to select, e to edit, d to delete, Esc to cancel)
        </Text>
      </Box>

      {/* New session option */}
      <Box>
        <Text color={selectedIndex === 0 ? 'white' : 'gray'} backgroundColor={selectedIndex === 0 ? 'blue' : undefined}>
          {selectedIndex === 0 ? '▶ ' : '  '}
          <Text bold>+ New Session...</Text>
        </Text>
      </Box>

      {/* Separator */}
      <Box marginY={0}>
        <Text dimColor>────────────────────────────────────────</Text>
      </Box>

      {/* Session list */}
      {sessions.length === 0 ? (
        <Box>
          <Text dimColor italic>No sessions yet</Text>
        </Box>
      ) : (
        sessions.map((session, index) => {
          const isSelected = selectedIndex === index + 1;
          const isCurrent = session.name === currentSession;
          
          return (
            <Box key={session.name} flexDirection="column" marginBottom={0}>
              <Box>
                <Text
                  color={isSelected ? 'white' : isCurrent ? 'green' : 'gray'}
                  backgroundColor={isSelected ? 'blue' : undefined}
                >
                  {isSelected ? '▶ ' : '  '}
                  <Text bold>{session.name}</Text>
                  {isCurrent && <Text color="green"> (current)</Text>}
                  <Text dimColor> · {session.messageCount} msgs · {formatDate(session.lastAccessed)}</Text>
                </Text>
              </Box>
              {session.description && (
                <Box marginLeft={3}>
                  <Text dimColor italic>
                    {session.description}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })
      )}
    </Box>
  );
};