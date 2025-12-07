import { InputHistory } from '../../chat/utils/InputHistory';

describe('InputHistory - Session Loading', () => {
  test('should load user messages from session data', () => {
    const history = new InputHistory();
    const sessionMessages = [
      { role: 'user', content: 'Hello, how are you?' },
      { role: 'assistant', content: 'I\'m doing well, thank you!' },
      { role: 'user', content: 'What can you help me with?' },
      { role: 'assistant', content: 'I can help with various tasks.' },
      { role: 'user', content: 'Tell me a joke' },
    ];

    history.loadFromSession(sessionMessages);

    const allHistory = history.getAll();
    expect(allHistory).toHaveLength(3);
    expect(allHistory).toEqual([
      'Hello, how are you?',
      'What can you help me with?',
      'Tell me a joke'
    ]);
  });

  test('should filter out empty user messages', () => {
    const history = new InputHistory();
    const sessionMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'user', content: '   ' }, // Empty message
      { role: 'user', content: 'World' },
      { role: 'user', content: '' }, // Empty message
    ];

    history.loadFromSession(sessionMessages);

    const allHistory = history.getAll();
    expect(allHistory).toHaveLength(2);
    expect(allHistory).toEqual(['Hello', 'World']);
  });

  test('should avoid duplicates when loading from session', () => {
    const history = new InputHistory();
    const sessionMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'user', content: 'Hello' }, // Duplicate
      { role: 'user', content: 'World' },
      { role: 'user', content: 'World' }, // Duplicate
    ];

    history.loadFromSession(sessionMessages);

    const allHistory = history.getAll();
    expect(allHistory).toHaveLength(2);
    expect(allHistory).toEqual(['Hello', 'World']);
  });

  test('should respect max size when loading from session', () => {
    const history = new InputHistory(3); // Small max size for testing
    const sessionMessages = [
      { role: 'user', content: 'Message 1' },
      { role: 'user', content: 'Message 2' },
      { role: 'user', content: 'Message 3' },
      { role: 'user', content: 'Message 4' },
      { role: 'user', content: 'Message 5' },
    ];

    history.loadFromSession(sessionMessages);

    const allHistory = history.getAll();
    expect(allHistory).toHaveLength(3);
    expect(allHistory).toEqual(['Message 3', 'Message 4', 'Message 5']); // Should keep the most recent
  });

  test('should reset browsing position after loading from session', () => {
    const history = new InputHistory();
    
    // Add some initial history and navigate
    history.add('Initial message');
    history.getPrevious(); // Start browsing
    
    expect(history.getCurrentIndex()).toBe(0); // Should be browsing
    
    const sessionMessages = [
      { role: 'user', content: 'Session message' },
    ];
    
    history.loadFromSession(sessionMessages);
    
    expect(history.getCurrentIndex()).toBe(-1); // Should reset to current input
  });

  test('should handle empty session data', () => {
    const history = new InputHistory();
    
    history.loadFromSession([]);
    
    expect(history.getAll()).toHaveLength(0);
    expect(history.getCurrentIndex()).toBe(-1);
  });

  test('should handle session data with no user messages', () => {
    const history = new InputHistory();
    const sessionMessages = [
      { role: 'assistant', content: 'Assistant message 1' },
      { role: 'assistant', content: 'Assistant message 2' },
    ];

    history.loadFromSession(sessionMessages);

    expect(history.getAll()).toHaveLength(0);
  });
});