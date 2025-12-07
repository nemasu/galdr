import { InputHistory } from '../../chat/utils/InputHistory';

describe('InputHistory', () => {
  let history: InputHistory;

  beforeEach(() => {
    history = new InputHistory(5); // Small size for testing
  });

  test('should add inputs to history', () => {
    history.add('first input');
    history.add('second input');
    
    expect(history.getSize()).toBe(2);
  });

  test('should not add empty inputs', () => {
    history.add('');
    history.add('   ');
    
    expect(history.getSize()).toBe(0);
  });

  test('should not add duplicate consecutive inputs', () => {
    history.add('same input');
    history.add('same input');
    
    expect(history.getSize()).toBe(1);
  });

  test('should navigate through history with up/down arrows', () => {
    history.add('first');
    history.add('second');
    history.add('third');

    // Start browsing from current input
    expect(history.getPrevious()).toBe('third');
    expect(history.getPrevious()).toBe('second');
    expect(history.getPrevious()).toBe('first');
    expect(history.getPrevious()).toBe('first'); // Stays at first

    // Navigate back down
    expect(history.getNext()).toBe('second');
    expect(history.getNext()).toBe('third');
    expect(history.getNext()).toBe(''); // Back to current input
    expect(history.getNext()).toBeNull(); // Already at current input
  });

  test('should respect max size', () => {
    history.add('1');
    history.add('2');
    history.add('3');
    history.add('4');
    history.add('5');
    history.add('6'); // Should remove '1'

    expect(history.getSize()).toBe(5);
    expect(history.getAll()).toEqual(['2', '3', '4', '5', '6']);
  });

  test('should reset browsing when adding new input', () => {
    history.add('first');
    history.add('second');

    // Start browsing
    expect(history.getPrevious()).toBe('second');
    expect(history.getCurrentIndex()).toBe(1);

    // Add new input should reset browsing
    history.add('third');
    expect(history.getCurrentIndex()).toBe(-1);
    expect(history.getPrevious()).toBe('third');
  });

  test('should clear history', () => {
    history.add('first');
    history.add('second');
    
    history.clear();
    
    expect(history.getSize()).toBe(0);
    expect(history.getCurrentIndex()).toBe(-1);
  });

  test('should handle empty history gracefully', () => {
    expect(history.getPrevious()).toBeNull();
    expect(history.getNext()).toBeNull();
    expect(history.getSize()).toBe(0);
  });
});