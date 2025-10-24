import React, { useState, useEffect } from 'react';
import { render, Box, Text, Static } from 'ink';
import { Provider, Message } from '../types';
import { StatusBar } from './components/StatusBar';
import { MessageDisplay } from './components/MessageDisplay';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ProviderBadge } from './components/ProviderBadge';

interface AppState {
  currentProvider: Provider;
  switchMode: string;
  messages: Message[];
  isLoading: boolean;
  input: string;
  initialMessageCount: number;
  showWelcome: boolean;
  notifications: Array<{ type: 'info' | 'error' | 'success' | 'provider-switch'; message: string; from?: Provider; to?: Provider }>;
}

interface ChatAppProps {
  state: AppState;
  onInput: (input: string) => void;
  onCancel: () => void;
}

const ChatApp: React.FC<ChatAppProps> = ({ state, onInput, onCancel }) => {
  const [input, setInput] = useState('');

  // Simple input handling - we'll rely on readline in ChatSession for actual input
  // This is just for display purposes
  useEffect(() => {
    setInput(state.input);
  }, [state.input]);

  return (
    <Box flexDirection="column" minHeight={process.stdout.rows || 24}>
      {/* Main content area */}
      <Box flexDirection="column" flexGrow={1}>
        {state.showWelcome && (
          <WelcomeScreen
            provider={state.currentProvider}
            switchMode={state.switchMode}
            messageCount={state.initialMessageCount}
          />
        )}

        {/* Display messages using Static to prevent flickering */}
        {state.messages.length > 0 && (
          <Static items={state.messages}>
            {(msg, idx) => <MessageDisplay key={idx} message={msg} />}
          </Static>
        )}

        {/* Display notifications */}
        {state.notifications.map((notif, idx) => {
          if (notif.type === 'info') {
            return (
              <Box key={`notif-${idx}`} marginY={1} paddingX={1}>
                <Text color="blue">ℹ </Text>
                <Text color="white">{notif.message}</Text>
              </Box>
            );
          } else if (notif.type === 'error') {
            return (
              <Box key={`notif-${idx}`} marginY={1} paddingX={1}>
                <Text color="red">✗ Error: </Text>
                <Text color="white">{notif.message}</Text>
              </Box>
            );
          } else if (notif.type === 'success') {
            return (
              <Box key={`notif-${idx}`} marginY={1} paddingX={1}>
                <Text color="green">✓ </Text>
                <Text color="white">{notif.message}</Text>
              </Box>
            );
          } else if (notif.type === 'provider-switch' && notif.from && notif.to) {
            return (
              <Box key={`notif-${idx}`} flexDirection="column" marginY={1} paddingX={1}>
                <Text color="yellow">⚠ {notif.message}</Text>
                <Box>
                  <Text color="yellow">  Switching from </Text>
                  <ProviderBadge provider={notif.from} />
                  <Text color="yellow"> to </Text>
                  <ProviderBadge provider={notif.to} />
                </Box>
              </Box>
            );
          }
          return null;
        })}
      </Box>

      {/* Fixed status bar at bottom */}
      <StatusBar provider={state.currentProvider} isLoading={state.isLoading} />
    </Box>
  );
};

export class ChatUIInk {
  private state: AppState;
  private renderInstance: any;
  private onInputCallback?: (input: string) => void;
  private onCancelCallback?: () => void;

  constructor() {
    this.state = {
      currentProvider: 'claude',
      switchMode: 'manual',
      messages: [],
      isLoading: false,
      input: '',
      initialMessageCount: 0,
      showWelcome: true,
      notifications: []
    };
  }

  public start(
    provider: Provider,
    switchMode: string,
    messageCount: number,
    onInput: (input: string) => void,
    onCancel: () => void
  ): void {
    this.state.currentProvider = provider;
    this.state.switchMode = switchMode;
    this.state.initialMessageCount = messageCount;
    this.state.showWelcome = true;
    this.onInputCallback = onInput;
    this.onCancelCallback = onCancel;

    this.renderInstance = render(
      <ChatApp
        state={this.state}
        onInput={onInput}
        onCancel={onCancel}
      />
    );
  }

  public updateInput(input: string): void {
    this.state.input = input;
    this.rerender();
  }

  public addMessage(role: 'user' | 'assistant', content: string, provider?: Provider): void {
    this.state.messages.push({
      role,
      content,
      timestamp: Date.now(),
      provider
    });
    this.state.showWelcome = false;
    this.state.notifications = []; // Clear notifications when new message arrives
    this.rerender();
  }

  public setLoading(isLoading: boolean): void {
    this.state.isLoading = isLoading;
    this.rerender();
  }

  public setProvider(provider: Provider): void {
    this.state.currentProvider = provider;
    this.rerender();
  }

  public showInfo(message: string): void {
    this.state.notifications = [{ type: 'info', message }];
    this.rerender();
  }

  public showError(message: string): void {
    this.state.notifications = [{ type: 'error', message }];
    this.rerender();
  }

  public showSuccess(message: string): void {
    this.state.notifications = [{ type: 'success', message }];
    this.rerender();
  }

  public showProviderSwitch(from: Provider, to: Provider, reason: string): void {
    this.state.currentProvider = to;
    this.state.notifications = [{ type: 'provider-switch', message: reason, from, to }];
    this.rerender();
  }

  public clearMessages(): void {
    this.state.messages = [];
    this.state.showWelcome = true;
    this.state.notifications = [];
    this.rerender();
  }

  public showWelcome(): void {
    this.state.showWelcome = true;
    this.state.notifications = [];
    this.rerender();
  }

  private rerender(): void {
    if (this.renderInstance && this.onInputCallback && this.onCancelCallback) {
      this.renderInstance.rerender(
        <ChatApp
          state={this.state}
          onInput={this.onInputCallback}
          onCancel={this.onCancelCallback}
        />
      );
    }
  }

  public cleanup(): void {
    if (this.renderInstance) {
      this.renderInstance.unmount();
      this.renderInstance = null;
    }
  }
}
