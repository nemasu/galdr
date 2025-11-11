import { tokenizer } from '../../utils/tokenizer';

describe('Tokenizer with DeepSeek Tokenizer', () => {
  test('should estimate tokens for simple text', async () => {
    const text = 'Hello, how are you?';
    const count = await tokenizer.estimateTokenCount(text);
    
    // Should return a reasonable token count
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(text.length); // Tokens should be fewer than or equal to characters (fallback)
  });

  test('should estimate tokens for messages array', async () => {
    const messages = [
      { role: 'user', content: 'Hello, how are you?' },
      { role: 'assistant', content: 'I\'m doing well, thank you!' }
    ];
    
    const count = await tokenizer.estimateMessagesTokenCount(messages);
    
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

  test('should handle quick estimation fallback', () => {
    const text = 'Hello, how are you?';
    const count = tokenizer.quickEstimate(text);
    
    // Character-based estimation should be roughly text.length / 4
    expect(count).toBe(Math.ceil(text.length / 4));
  });

  test('should handle complex messages with tool calls', async () => {
    const messages = [
      { role: 'user', content: 'What\'s the weather in Tokyo?' },
      { 
        role: 'assistant', 
        content: '',
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: JSON.stringify({ location: 'Tokyo' })
            }
          }
        ]
      },
      {
        role: 'tool',
        content: JSON.stringify({ temperature: 22, condition: 'sunny' }),
        tool_call_id: 'call_123'
      }
    ];
    
    const count = await tokenizer.estimateMessagesTokenCount(messages);
    
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
});