import { tokenizer } from '../../utils/tokenizer';

describe('Tokenizer', () => {
  test('should estimate token count for simple text', async () => {
    const text = 'Hello, world! This is a test.';
    const count = await tokenizer.estimateTokenCount(text);
    
    // Should be a positive number
    expect(count).toBeGreaterThan(0);
    // Should be less than or equal to the character count (fallback estimation)
    expect(count).toBeLessThanOrEqual(text.length);
  });

  test('should provide quick estimate for simple text', () => {
    const text = 'Hello, world! This is a test.';
    const count = tokenizer.quickEstimate(text);
    
    // Should be a positive number
    expect(count).toBeGreaterThan(0);
    // Quick estimate should be roughly text.length / 4
    expect(count).toBe(Math.ceil(text.length / 4));
  });

  test('should estimate token count for messages array', async () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello, how are you?' }
    ];
    
    const count = await tokenizer.estimateMessagesTokenCount(messages);
    
    // Should be a positive number
    expect(count).toBeGreaterThan(0);
    // Should be less than or equal to total character count
    const totalChars = messages.reduce((sum, msg) => {
      if (typeof msg.content === 'string') {
        return sum + msg.content.length + msg.role.length;
      }
      return sum + msg.role.length;
    }, 0);
    expect(count).toBeLessThanOrEqual(totalChars);
  });

  test('should provide quick estimate for messages array', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello, how are you?' }
    ];
    
    const count = tokenizer.quickEstimateMessages(messages);
    
    // Should be a positive number
    expect(count).toBeGreaterThan(0);
  });

  test('should handle messages with tool calls', async () => {
    const messages = [
      { 
        role: 'assistant', 
        content: '',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'search_web',
              arguments: '{"query": "test"}'
            }
          }
        ]
      },
      {
        role: 'tool',
        content: 'Search result: test data',
        tool_call_id: 'call_123'
      }
    ];
    
    const count = await tokenizer.estimateMessagesTokenCount(messages);
    
    // Should be a positive number
    expect(count).toBeGreaterThan(0);
    // Should be less than or equal to total character count
    const totalChars = messages.reduce((sum, msg) => {
      let charCount = msg.role.length;
      if (typeof msg.content === 'string') {
        charCount += msg.content.length;
      }
      if (msg.tool_calls) {
        charCount += JSON.stringify(msg.tool_calls).length;
      }
      if (msg.tool_call_id) {
        charCount += msg.tool_call_id.length;
      }
      return sum + charCount;
    }, 0);
    expect(count).toBeLessThanOrEqual(totalChars);
  });

  test('should handle complex message content', async () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image', url: 'test.jpg' }
        ]
      }
    ];
    
    const count = await tokenizer.estimateMessagesTokenCount(messages);
    
    // Should be a positive number
    expect(count).toBeGreaterThan(0);
    // Should be less than or equal to total character count
    const totalChars = messages.reduce((sum, msg) => {
      let charCount = msg.role.length;
      if (Array.isArray(msg.content)) {
        charCount += msg.content.reduce((contentSum, item) => {
          return contentSum + JSON.stringify(item).length;
        }, 0);
      }
      return sum + charCount;
    }, 0);
    expect(count).toBeLessThanOrEqual(totalChars);
  });
});