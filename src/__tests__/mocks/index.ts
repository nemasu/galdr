import { ProviderResult, Message } from '../../types/index.js';

// Mock responses for testing credit limit detection
export const mockCreditLimitResponses = {
  deepseek: [
    '{"error":{"message":"insufficient balance","type":"insufficient_funds"}}',
    '{"error":{"message":"credit limit exceeded","type":"credit_limit"}}',
    '{"error":{"message":"insufficient funds","type":"billing_error"}}',
    'HTTP 402 Payment Required',
    'Your account balance is insufficient',
  ],
  claude: [
    'Session limit reached',
    'Session limit reached ∙ resets 3:30pm',
    'Session limit reached ∙ resets in 3 hours',
    'Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."}}',
    'You have exceeded your usage limit',
    'Usage limit reached',
  ],
  gemini: [
    'Quota exceeded',
    'Rate limit exceeded',
    'Usage limits exceeded',
  ],
  copilot: [
    'Usage limit reached',
    'You have exceeded your free tier',
  ],
  cursor: [
    'Usage limit exceeded',
    'Free tier limit reached',
  ],
};

// Mock responses for successful operations
export const mockSuccessResponses = {
  deepseek: '{"choices":[{"message":{"content":"This is a test response from DeepSeek"}}]}',
  claude: 'This is a test response from Claude',
  gemini: 'This is a test response from Gemini',
  copilot: 'This is a test response from Copilot',
  cursor: 'This is a test response from Cursor',
};

// Mock error responses
export const mockErrorResponses = {
  deepseek: '{"error":{"message":"Internal server error","type":"internal_error"}}',
  claude: 'Command execution failed',
  gemini: 'API request failed',
  copilot: 'Process exited with code 1',
  cursor: 'Tool not found',
};

// Mock conversation messages
export const mockMessages: Message[] = [
  {
    role: 'user',
    content: 'Hello, can you help me with this code?',
    timestamp: Date.now() - 60000,
  },
  {
    role: 'assistant',
    content: 'Sure, I\'d be happy to help! What specific issue are you facing?',
    timestamp: Date.now() - 30000,
  },
];

// Mock provider results
export const mockProviderResults: Record<string, ProviderResult> = {
  success: {
    success: true,
    response: 'This is a successful response',
    usageLimitReached: false,
  },
  creditLimit: {
    success: false,
    error: 'Credit limit reached',
    usageLimitReached: true,
  },
  error: {
    success: false,
    error: 'Generic error occurred',
    usageLimitReached: false,
  },
};

export { MockInkWriter } from './ink-writer.js';

// Mock child process for testing
export const mockChildProcess = {
  pid: 12345,
  stdout: {
    on: jest.fn(),
  },
  stderr: {
    on: jest.fn(),
  },
  on: jest.fn(),
  kill: jest.fn(),
};

// Mock fetch response for API testing
export const createMockFetchResponse = (data: any, ok = true, status = 200) => {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: jest.fn().mockResolvedValue(data),
    text: jest.fn().mockResolvedValue(JSON.stringify(data)),
    body: {
      getReader: jest.fn().mockReturnValue({
        read: jest.fn().mockResolvedValue({ done: true, value: undefined }),
        cancel: jest.fn(),
      }),
    },
  };
};

// Add a dummy test to satisfy Jest
describe('Test Mocks', () => {
  it('should export mock data correctly', () => {
    expect(mockCreditLimitResponses).toBeDefined();
    expect(mockSuccessResponses).toBeDefined();
    expect(mockErrorResponses).toBeDefined();
  });
});