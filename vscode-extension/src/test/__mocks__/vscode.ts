// Mock implementation of VS Code API for testing

const mockGet = jest.fn((key: string) => {
  const defaults: Record<string, any> = {
    'backendUrl': 'http://localhost:8000',
    'maxRetries': 3,
    'requestTimeout': 30000,
    'debugMode': false
  };
  return defaults[key];
});

export const workspace = {
  getConfiguration: jest.fn(() => ({
    get: mockGet
  })),
  workspaceFolders: [
    {
      uri: { fsPath: '/mock/workspace' },
      name: 'test-workspace',
      index: 0
    }
  ],
  onDidChangeConfiguration: jest.fn(),
  openTextDocument: jest.fn(),
  fs: {
    writeFile: jest.fn(),
    readFile: jest.fn()
  }
};

export const window = {
  showInformationMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showInputBox: jest.fn(),
  showTextDocument: jest.fn(),
  createWebviewPanel: jest.fn(),
  activeTextEditor: null as any,
  withProgress: jest.fn((options: any, task: any) => task()),
  registerWebviewViewProvider: jest.fn()
};

export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn()
};

export const Uri = {
  file: jest.fn((path: string) => ({ fsPath: path })),
  parse: jest.fn()
};

export class Range {
  constructor(public start: any, public end: any) {}
}

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Selection {
  constructor(public start: any, public end: any) {}
  get isEmpty() { return false; }
}

export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
  Three: 3
};

export const ProgressLocation = {
  Notification: 15,
  Window: 10
};

export const TextDocument = {
  getText: jest.fn(),
  languageId: 'javascript',
  uri: { fsPath: '/mock/document.js' },
  lineCount: 10,
  lineAt: jest.fn(() => ({ text: 'mock line' }))
};

export const TextEditor = {
  document: TextDocument,
  selection: new Selection(new Position(0, 0), new Position(0, 10)),
  edit: jest.fn((callback: any) => {
    const editBuilder = {
      replace: jest.fn(),
      insert: jest.fn(),
      delete: jest.fn()
    };
    callback(editBuilder);
    return Promise.resolve(true);
  })
};

// Set active editor
window.activeTextEditor = TextEditor;

export const ExtensionContext = {
  subscriptions: [],
  extensionUri: Uri.file('/mock/extension'),
  globalState: {
    get: jest.fn(),
    update: jest.fn()
  },
  workspaceState: {
    get: jest.fn(),
    update: jest.fn()
  }
};

// Additional mocks for webview functionality
export const Webview = {
  html: '',
  options: {},
  onDidReceiveMessage: jest.fn(),
  postMessage: jest.fn()
};

export const WebviewView = {
  webview: Webview,
  visible: true,
  show: jest.fn()
};

export const WebviewViewProvider = {
  resolveWebviewView: jest.fn()
}; 