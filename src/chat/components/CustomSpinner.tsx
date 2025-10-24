import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

interface CustomSpinnerProps {
  type?: 'dots' | 'line';
}

const DOTS_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const LINE_FRAMES = ['|', '/', '-', '\\'];

export const CustomSpinner: React.FC<CustomSpinnerProps> = ({ type = 'dots' }) => {
  const [frame, setFrame] = useState(0);

  const frames = type === 'dots' ? DOTS_FRAMES : LINE_FRAMES;

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prevFrame) => (prevFrame + 1) % frames.length);
    }, 80);

    return () => clearInterval(interval);
  }, [frames.length]);

  return <Text>{frames[frame]}</Text>;
};
