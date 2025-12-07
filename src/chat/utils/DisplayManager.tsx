import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import { Provider, Message, StreamItem, ToolInfo } from '../../types/index.js';
import { ProviderBadge, getProviderColor } from '../components/ProviderBadge.js';

/**
 * Special message content identifiers
 */
export enum SpecialMessageType {
  STARTUP = '__STARTUP_MESSAGE__',
  HELP = '__HELP_MESSAGE__'
}

/**
 * Notification type for user feedback messages
 */
export interface Notification {
  type: 'info' | 'error' | 'success' | 'provider-switch';
  message: string;
  from?: Provider;
  to?: Provider;
}

/**
 * DisplayManager - Centralized class for all screen output rendering
 * All messages, notifications, help text, errors, and tool output funnel through here
 */
export class DisplayManager {
  private static instance: DisplayManager;
  private terminalWidth: number = 80; // Default width
  private keyCounter: number = 0; // Global key counter to avoid collisions

  private constructor() {}

  public static getInstance(): DisplayManager {
    if (!DisplayManager.instance) {
      DisplayManager.instance = new DisplayManager();
    }
    return DisplayManager.instance;
  }

  /**
   * Set terminal width for responsive rendering
   */
  public setTerminalWidth(width: number): void {
    this.terminalWidth = width > 0 ? width : 80;
  }

  /**
   * Get terminal width
   */
  public getTerminalWidth(): number {
    return this.terminalWidth;
  }

  /**
   * Generate unique key to avoid React key collisions
   */
  private generateUniqueKey(prefix: string): string {
    return `${prefix}-${this.keyCounter++}`;
  }

  /**
   * Create a separator line based on terminal width
   * Subtracts 2 to account for terminal padding/margins
   */
  private renderSeparator(): React.ReactNode {
    const width = Math.max(1, this.terminalWidth - 2);
    return (
      <Text color="gray" dimColor>
        {'─'.repeat(width)}
      </Text>
    );
  }

  /**
   * Render a notification message
   */
  public renderNotification(notification: Notification, key: string): React.ReactNode {
    switch (notification.type) {
      case 'info':
        return (
          <Box key={key} marginY={1} paddingX={1}>
            <Text color="cyan">ℹ </Text>
            <Text color="white">{notification.message}</Text>
          </Box>
        );

      case 'error':
        return (
          <Box key={key} marginY={1} paddingX={1}>
            <Text color="red">✗ Error: </Text>
            <Text color="white">{notification.message}</Text>
          </Box>
        );

      case 'success':
        return (
          <Box key={key} marginY={1} paddingX={1}>
            <Text color="cyan">✓ </Text>
            <Text color="white">{notification.message}</Text>
          </Box>
        );

      case 'provider-switch':
        if (notification.from && notification.to) {
          return (
            <Box key={key} flexDirection="column" marginY={1} paddingX={1}>
              <Text color="magenta">⚠ {notification.message}</Text>
              <Box>
                <Text color="gray">  Switching from </Text>
                <ProviderBadge provider={notification.from} />
                <Text color="gray"> to </Text>
                <ProviderBadge provider={notification.to} />
              </Box>
            </Box>
          );
        }
        return null;

      default:
        return null;
    }
  }

  /**
   * Render multiple notifications
   */
  public renderNotifications(notifications: Notification[]): React.ReactNode[] {
    return notifications.map((notif) => this.renderNotification(notif, this.generateUniqueKey('notif')));
  }

  /**
   * Render the startup/welcome message
   */
  public renderStartupMessage(
    currentProvider: Provider,
    switchMode: string,
    initialMessageCount: number
  ): React.ReactNode {
    return (
      <Box flexDirection="column" marginY={1} paddingX={1}>
        <Box borderStyle="bold" borderColor="magenta" paddingX={1}>
          <Gradient name="passion">
            <Text bold>GALDR</Text>
          </Gradient>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color="gray">Active Provider: </Text>
            <ProviderBadge provider={currentProvider} />
            <Text color="gray"> │ Switch Mode: </Text>
            <Text color="magenta">{switchMode}</Text>
            {process.env.GALDR_VERBOSE === '1' && (
              <>
                <Text color="gray"> │ </Text>
                <Text backgroundColor="magenta" color="white"> VERBOSE </Text>
              </>
            )}
          </Box>
          {initialMessageCount > 0 && (
            <Box marginTop={1}>
              <Text color="cyan">Context: {initialMessageCount} messages restored</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color="yellow">Type </Text>
            <Text color="yellowBright" bold>/help</Text>
            <Text color="yellow"> for command list</Text>
          </Box>
          <Box>
            <Text color="yellowBright">Ctrl+S</Text>
            <Text color="gray"> for session management</Text>
          </Box>
        </Box>
        <Box marginTop={1} marginBottom={1}>
          {this.renderSeparator()}
        </Box>
      </Box>
    );
  }

  /**
   * Render the help message with all commands
   */
  public renderHelpMessage(): React.ReactNode {
    // Structured command definitions for better maintainability
    const commands = [
      { command: '/exit, /quit', args: '', description: 'Exit chat' },
      { command: '/switch', args: '<provider>', description: 'Switch provider (claude, gemini, copilot, deepseek, cursor)' },
      { command: '/mode', args: '<mode>', description: 'Set switch mode (manual, rollover, round-robin)' },
      { command: '/clear', args: '', description: 'Clear chat history' },
      { command: '/compact', args: '[keep]', description: 'Compact history, keep N recent messages (default: 10)' },
      { command: '/history', args: '', description: 'Show history statistics' },
      { command: '/status', args: '', description: 'Show provider status' },
      { command: '/verbose', args: '', description: 'Toggle verbose output mode' },
      { command: '/model', args: '<p> <model>', description: 'Set model for provider (e.g., /model claude default)' },
      { command: '/sessions', args: '', description: 'List all sessions' },
      { command: '/session-new', args: '<name>', description: 'Create a new session' },
      { command: '/session-load', args: '<name>', description: 'Load a session' },
      { command: '/session-delete', args: '<n>', description: 'Delete a session' },
      { command: '/session-rename', args: '', description: 'Rename a session' },
      { command: '/help', args: '', description: 'Show this help' },
    ];

    return (
      <Box flexDirection="column" marginY={1} paddingX={1}>
        <Box borderStyle="bold" borderColor="magenta" paddingX={1}>
          <Gradient name="passion">
            <Text bold>GALDR - Commands</Text>
          </Gradient>
        </Box>
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {commands.map((cmd, idx) => (
            <Box key={`help-cmd-${idx}`}>
              <Text color="cyan" bold>{cmd.command}</Text>
              {cmd.args && (
                <>
                  <Text> </Text>
                  <Text color="yellow">{cmd.args}</Text>
                </>
              )}
              <Text>  </Text>
              <Text color="white">{cmd.description}</Text>
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          {this.renderSeparator()}
        </Box>
      </Box>
    );
  }

  /**
   * Render a tool information display
   */
  public renderToolInfo(tool: ToolInfo, key: string): React.ReactNode {
    const formatParameters = (params: any): string => {
      if (!params) return '';

      // For Edit tool, show key parameters in a readable format
      if (tool.name === 'Edit') {
        const { file_path, old_string, new_string, replace_all } = params;
        const parts = [];

        if (file_path) {
          const fileName = file_path.split(/[\\/]/).pop();
          parts.push(`file: ${fileName}`);
        }

        if (old_string && new_string) {
          parts.push(`"${old_string}" → "${new_string}"`);
        }

        if (replace_all !== undefined) {
          parts.push(replace_all ? 'replace all' : 'replace first');
        }

        // Don't print the entire string if it's too long
        return parts.join(', ').substring(0, 80);
      }

      // For other tools, use a compact JSON format
      try {
        const json = JSON.stringify(params);
        // If the JSON is too long, truncate it
        if (json.length > 80) {
          return json.substring(0, 77) + '...';
        }
        return json;
      } catch {
        return '[Complex parameters]';
      }
    };

    const paramsDisplay = formatParameters(tool.parameters);
    const shouldShowParams = paramsDisplay && paramsDisplay.length > 0;

    return (
      <Box key={key} flexDirection="column" marginTop={1} paddingLeft={2}>
        <Box>
          <Text color="magenta">🔧 Using tool: {tool.name}</Text>
          {shouldShowParams && <Text dimColor> {paramsDisplay}</Text>}
        </Box>
        {tool.status === 'success' && (
          <Box paddingLeft={2}>
            <Text dimColor>✓ Complete</Text>
          </Box>
        )}
        {tool.status === 'failed' && (
          <Box paddingLeft={2}>
            <Text color="red">✗ Failed</Text>
          </Box>
        )}
      </Box>
    );
  }

  /**
   * Render stream items (text, tools, info messages) in order
   * Note: This method generates new keys each time it's called, which is intentional
   * for streaming content. For static/memoized content, use MemoizedStreamItems component.
   */
  public renderStreamItems(streamItems: StreamItem[], keyPrefix: string = 'stream'): React.ReactNode[] {
    const elements: React.ReactNode[] = [];
    let textBuffer: string[] = [];
    let textKey = 0;

    const flushTextBuffer = () => {
      if (textBuffer.length > 0) {
        elements.push(
          <Text key={`${keyPrefix}-text-${textKey++}`} color="white">
            {textBuffer.join('')}
          </Text>
        );
        textBuffer = [];
      }
    };

    streamItems.forEach((item, idx) => {
      if (item.type === 'text' && item.text) {
        textBuffer.push(item.text);
      } else if (item.type === 'tool' && item.tool) {
        flushTextBuffer();
        elements.push(this.renderToolInfo(item.tool, `${keyPrefix}-tool-${idx}`));
      } else if (item.type === 'info' && item.info) {
        flushTextBuffer();
        elements.push(
          <Box key={`${keyPrefix}-info-${idx}`} marginTop={1} paddingLeft={2}>
            <Text color="cyan" dimColor>ℹ {item.info}</Text>
          </Box>
        );
      }
    });

    flushTextBuffer();
    return elements;
  }

  /**
   * Render a user message
   */
  public renderUserMessage(content: string): React.ReactNode {
    return (
      <Box flexDirection="column" marginY={1} paddingX={1}>
        <Text bold color="cyan">You:</Text>
        <Text color="white">{content}</Text>
      </Box>
    );
  }

  /**
   * Render an assistant message
   */
  public renderAssistantMessage(
    message: Message,
    isStreaming: boolean = false,
    currentProvider?: Provider
  ): React.ReactNode {
    const effectiveProvider = message.provider || currentProvider;
    const color = effectiveProvider ? getProviderColor(effectiveProvider) : 'magenta';
    const providerName = effectiveProvider
      ? effectiveProvider.charAt(0).toUpperCase() + effectiveProvider.slice(1)
      : 'Assistant';

    const hasStreamItems = message.streamItems && message.streamItems.length > 0;
    const isContinuation = message.isContinuation || false;

    return (
      <Box flexDirection="column" marginY={isContinuation ? 0 : 1} paddingX={1}>
        {/* Only show provider header for non-continuation messages */}
        {!isContinuation && (
          <Text bold color={color}>
            {providerName}:
          </Text>
        )}

        {/* Render stream items in order (text and tools interleaved) */}
        {hasStreamItems ? (
          <Box flexDirection="column">
            {this.renderStreamItems(message.streamItems!, `msg-${message.timestamp}`)}
          </Box>
        ) : (
          <>
            {/* Fallback: render content first, then tools */}
            <Text color="white">{message.content}</Text>

            {/* Display tools if any */}
            {message.tools && message.tools.length > 0 && (
              <Box flexDirection="column">
                {message.tools.map((tool) => this.renderToolInfo(tool, this.generateUniqueKey('msg-tool')))}
              </Box>
            )}
          </>
        )}

        {/* Separator line (only for non-streaming, non-continuation completed messages) */}
        {!isStreaming && !isContinuation && (
          <Box marginTop={1}>
            {this.renderSeparator()}
          </Box>
        )}
      </Box>
    );
  }

  /**
   * Render any message based on its type and content
   */
  public renderMessage(
    message: Message,
    isStreaming: boolean = false,
    currentProvider?: Provider,
    switchMode?: string,
    initialMessageCount?: number
  ): React.ReactNode {
    // Handle special startup message
    if (message.content === SpecialMessageType.STARTUP) {
      return this.renderStartupMessage(
        currentProvider || 'claude',
        switchMode || 'manual',
        initialMessageCount || 0
      );
    }

    // Handle special help message
    if (message.content === SpecialMessageType.HELP) {
      return this.renderHelpMessage();
    }

    // Handle user message
    if (message.role === 'user') {
      return this.renderUserMessage(message.content);
    }

    // Handle assistant message
    return this.renderAssistantMessage(message, isStreaming, currentProvider);
  }
}

// Export singleton instance
export const displayManager = DisplayManager.getInstance();
