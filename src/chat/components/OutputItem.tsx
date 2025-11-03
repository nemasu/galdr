import React from 'react';
import { Provider, Message } from '../../types/index.js';
import { verboseLogger } from '../../utils/logger.js';
import { displayManager } from '../utils/DisplayManager.js';

interface OutputItemProps {
  message: Message;
  isStreaming?: boolean;
  currentProvider?: Provider;
  switchMode?: string;
  initialMessageCount?: number;
}

export const OutputItem: React.FC<OutputItemProps> = React.memo(({
  message,
  isStreaming = false,
  currentProvider = 'claude',
  switchMode = 'manual',
  initialMessageCount = 0
}) => {
  // Debug: Log rendering details in verbose mode
  if (process.env.GALDR_VERBOSE === '1' && message.role === 'assistant' && !isStreaming) {
    const hasStreamItems = message.streamItems && message.streamItems.length > 0;
    verboseLogger.log(`[OutputItem] Rendering completed assistant message:`);
    verboseLogger.log(`  Timestamp: ${message.timestamp}`);
    verboseLogger.log(`  Content length: ${message.content?.length || 0}`);
    verboseLogger.log(`  Has streamItems: ${hasStreamItems}`);
    verboseLogger.log(`  StreamItems count: ${message.streamItems?.length || 0}`);
    verboseLogger.log(`  Tools count: ${message.tools?.length || 0}`);
  }

  // Use DisplayManager to render all message types
  return <>{displayManager.renderMessage(message, isStreaming, currentProvider, switchMode, initialMessageCount)}</>;
});
