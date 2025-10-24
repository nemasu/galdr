export type Provider = 'claude' | 'gemini' | 'copilot' | 'cursor';

export type SwitchMode = 'manual' | 'rollover' | 'round-robin';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  provider?: Provider;
}

export interface ConversationContext {
  messages: Message[];
  currentProvider: Provider;
  switchMode: SwitchMode;
  providerUsage: {
    claude: number;
    gemini: number;
    copilot: number;
    cursor: number;
  };
}

export interface GaldrConfig {
  defaultProvider: Provider;
  switchMode: SwitchMode;
  tokenLimit?: number;
}

export interface ProviderResult {
  success: boolean;
  response?: string;
  error?: string;
  tokenLimitReached?: boolean;
}
