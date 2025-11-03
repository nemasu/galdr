// Test setup file
import { jest } from '@jest/globals';

// Mock environment variables for testing
process.env.GALDR_VERBOSE = 'false';
process.env.DEBUG = 'false';

// Global test utilities
global.console = {
  ...console,
  // Mock console methods to reduce noise in test output
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Add a dummy test to satisfy Jest
describe('Test Setup', () => {
  it('should load test setup correctly', () => {
    expect(true).toBe(true);
  });
});