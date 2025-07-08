// Test setup and global configurations

// Mock axios globally
jest.mock('axios', () => ({
  default: {
    create: jest.fn(() => ({
      post: jest.fn(),
      get: jest.fn()
    })),
    post: jest.fn(),
    get: jest.fn()
  }
}));

// Mock markdown-it
jest.mock('markdown-it', () => {
  return jest.fn().mockImplementation(() => ({
    render: jest.fn((content: string) => `<p>${content}</p>`)
  }));
});

// Mock diff
jest.mock('diff', () => ({
  createPatch: jest.fn(() => 'mock diff output')
}));

// Mock chokidar dynamic import
jest.mock('chokidar', () => ({
  watch: jest.fn(() => ({
    on: jest.fn(),
    close: jest.fn()
  }))
}));

// Global test utilities
global.setTimeout = jest.fn((fn) => fn()) as any;
global.clearTimeout = jest.fn();

// Increase timeout for integration tests
jest.setTimeout(10000); 