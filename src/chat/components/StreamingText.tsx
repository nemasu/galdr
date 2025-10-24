import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';

interface StreamingTextProps {
  onChunk?: (chunk: string) => void;
  onComplete?: () => void;
}

export const StreamingText: React.FC<StreamingTextProps> = ({ onChunk, onComplete }) => {
  const [content, setContent] = useState('');
  const isCompleteRef = useRef(false);

  useEffect(() => {
    // This component receives chunks via the appendChunk method
    // which is called from outside the component
    return () => {
      if (!isCompleteRef.current && onComplete) {
        onComplete();
      }
    };
  }, [onComplete]);

  // This is a public method that will be called from outside
  // We'll expose it via a ref mechanism
  const appendChunk = (chunk: string) => {
    setContent((prev) => prev + chunk);
    if (onChunk) {
      onChunk(chunk);
    }
  };

  const complete = () => {
    isCompleteRef.current = true;
    if (onComplete) {
      onComplete();
    }
  };

  return (
    <Box flexDirection="column">
      <Text color="white">{content}</Text>
    </Box>
  );
};

// Export a hook that provides methods to control streaming
export interface StreamingTextController {
  appendChunk: (chunk: string) => void;
  complete: () => void;
  getContent: () => string;
}

export const useStreamingText = (): [string, StreamingTextController] => {
  const [content, setContent] = useState('');

  const controller: StreamingTextController = {
    appendChunk: (chunk: string) => {
      setContent((prev) => prev + chunk);
    },
    complete: () => {
      // Mark as complete if needed
    },
    getContent: () => content,
  };

  return [content, controller];
};
