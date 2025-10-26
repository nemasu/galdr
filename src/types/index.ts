export type Provider = 'claude' | 'gemini' | 'copilot' | 'cursor';

export type SwitchMode = 'manual' | 'rollover' | 'round-robin';

export interface ToolInfo {
  id: string;
  name: string;
  parameters?: any;
  status: 'running' | 'success' | 'failed';
}

export interface StreamItem {
  type: 'text' | 'tool';
  text?: string;
  tool?: ToolInfo;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  provider?: Provider;
  tools?: ToolInfo[];
  streamItems?: StreamItem[];
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
