// Mock VS Code API before importing anything else
jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn((key: string) => {
        const defaults: Record<string, any> = {
          'backendUrl': 'http://localhost:8000',
          'maxRetries': 3,
          'requestTimeout': 30000,
          'debugMode': false
        };
        return defaults[key];
      })
    }))
  },
  window: {
    showInformationMessage: jest.fn()
  }
}), { virtual: true });

// Import after mocking
import { ConfigManager } from '../config';

describe('ConfigManager', () => {
  beforeEach(() => {
    // Reset singleton instance
    (ConfigManager as any).instance = undefined;
    jest.clearAllMocks();
  });

  describe('getInstance', () => {
    it('should return the same instance (singleton)', () => {
      const instance1 = ConfigManager.getInstance();
      const instance2 = ConfigManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getConfig', () => {
    it('should return default configuration values', () => {
      const configManager = ConfigManager.getInstance();
      const config = configManager.getConfig();
      
      expect(config.backendUrl).toBe('http://localhost:8000');
      expect(config.maxRetries).toBe(3);
      expect(config.requestTimeout).toBe(30000);
      expect(config.debugMode).toBe(false);
    });
  });

  describe('updateConfiguration', () => {
    it('should reload configuration when called', () => {
      const configManager = ConfigManager.getInstance();
      
      // This test just ensures the method doesn't throw
      expect(() => {
        configManager.updateConfiguration();
      }).not.toThrow();
    });
  });

  describe('checkBackendConnection', () => {
    it('should handle connection check', async () => {
      const configManager = ConfigManager.getInstance();
      
      // Mock axios
      jest.doMock('axios', () => ({
        default: {
          get: jest.fn().mockResolvedValue({ status: 200 })
        }
      }));
      
      // This test just ensures the method exists and returns a boolean
      const result = await configManager.checkBackendConnection();
      expect(typeof result).toBe('boolean');
    });
  });
}); 