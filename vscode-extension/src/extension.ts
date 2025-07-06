import * as vscode from 'vscode';
import axios from 'axios';
import * as MarkdownIt from 'markdown-it';
import * as diff from 'diff';
import * as path from 'path';
import * as fs from 'fs';

// Use dynamic import for chokidar to avoid type issues
let chokidar: any;

const md = new MarkdownIt();

// Chat message interface
interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    codeEdits?: any[];
}

interface CodeEdit {
    file: string;
    range: {
        start: { line: number; character: number; };
        end: { line: number; character: number; };
    };
    newText: string;
}

// Global chat history
let chatHistory: ChatMessage[] = [];
let chatWebviewPanel: vscode.WebviewPanel | undefined;
let fileWatcher: any | undefined;
let isIndexing = false;

async function makeApiCall(prompt: string, language: string, context: string) {
    return await axios.post('http://localhost:8000/generate', {
        prompt,
        language,
        context
    });
}

async function makeChatApiCall(prompt: string, language: string, context: string, chatHistory: ChatMessage[]) {
    return await axios.post('http://localhost:8000/chat', {
        prompt,
        language,
        context,
        history: chatHistory,
        includeCodeEdits: true // Request code edits from API
    });
}

async function makeBugFixApiCall(code: string, errorMessage: string, language: string) {
    return await axios.post('http://localhost:8000/fix-bug', {
        code,
        errorMessage,
        language
    });
}

async function reindexProject() {
    if (isIndexing) {
        vscode.window.showInformationMessage('Indexing already in progress...');
        return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    isIndexing = true;
    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Cody is indexing your project...",
            cancellable: false
        }, async () => {
            await axios.post('http://localhost:8000/reindex', {
                projectPath: workspaceFolder.uri.fsPath
            });
        });
        vscode.window.showInformationMessage('Project reindexed successfully!');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to reindex project: ${error}`);
    } finally {
        isIndexing = false;
    }
}

class CodyChatProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codyChat';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {
        console.log("CodyChatProvider: Constructor called");
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        console.log("CodyChatProvider: Resolving webview view");
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            console.log("CodyChatProvider: Received message:", data);
            switch (data.type) {
                case 'ready':
                    console.log("CodyChatProvider: Webview is ready, initializing chat");
                    if (chatHistory.length > 0) {
                        this.updateChatView();
                    }
                    break;
                case 'sendMessage':
                    await this.handleChatMessage(data.value);
                    break;
                case 'clearChat':
                    this.clearChat();
                    break;
            }
        });
    }

    private async handleChatMessage(message: string) {
        console.log("CodyChatProvider: Handling chat message:", message);
        if (!message.trim()) return;

        try {
            // Add user message to history
            const userMessage: ChatMessage = {
                role: 'user',
                content: message,
                timestamp: new Date()
            };
            chatHistory.push(userMessage);

            this.updateChatView();

            // Get current editor context
            const editor = vscode.window.activeTextEditor;
            let context = '';
            let language = 'text';
            let currentFile = '';

            if (editor) {
                const selection = editor.selection;
                context = editor.document.getText(); // Get entire file content
                language = editor.document.languageId;
                currentFile = editor.document.uri.fsPath;
                console.log("Current file:", currentFile);
                console.log("Current language:", language);
            }

            console.log("CodyChatProvider: Making API call");
            // Make API call with code edit support
            const response = await axios.post('http://localhost:8000/chat', {
                prompt: message,
                language,
                context,
                history: chatHistory.map(msg => ({
                    role: msg.role,
                    content: msg.content,
                    timestamp: msg.timestamp.toISOString()
                })),
                includeCodeEdits: true,
                currentFile
            });

            console.log("CodyChatProvider: Received API response:", response.data);

            if (response.data.response) {
                // Add assistant response to history
                const assistantMessage: ChatMessage = {
                    role: 'assistant',
                    content: response.data.response,
                    timestamp: new Date()
                };
                chatHistory.push(assistantMessage);

                // Apply code edits if present
                if (response.data.codeEdits && response.data.codeEdits.length > 0) {
                    console.log("Applying code edits:", response.data.codeEdits);
                    await this.applyCodeEdits(response.data.codeEdits);
                    assistantMessage.content += '\n\nℹ️ Applied code changes to your files.';
                } else {
                    console.log("No code edits received");
                }

                this.updateChatView();
            }
        } catch (error: any) {
            console.error("CodyChatProvider: Error in handleChatMessage:", error);
            const errorMessage = error.message || 'Unknown error occurred';
            vscode.window.showErrorMessage(`Chat error: ${errorMessage}`);
            
            const errorResponse: ChatMessage = {
                role: 'assistant',
                content: `Error: Failed to get response. Please try again. (${errorMessage})`,
                timestamp: new Date()
            };
            chatHistory.push(errorResponse);
            
            this.updateChatView();
        }
    }

    private async applyCodeEdits(edits: any[]) {
        for (const edit of edits) {
            try {
                console.log("Applying edit to file:", edit.file);
                
                // Convert file path to URI
                const fileUri = vscode.Uri.file(edit.file);
                
                // Open the document and show it
                let document: vscode.TextDocument;
                try {
                    document = await vscode.workspace.openTextDocument(fileUri);
                } catch (error) {
                    console.log("File doesn't exist, creating new file");
                    // Create the file if it doesn't exist
                    await vscode.workspace.fs.writeFile(fileUri, Buffer.from('', 'utf8'));
                    document = await vscode.workspace.openTextDocument(fileUri);
                }
                
                const editor = await vscode.window.showTextDocument(document);

                // Get the entire document range
                const fullRange = new vscode.Range(
                    new vscode.Position(0, 0),
                    new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length)
                );

                // Apply the edit
                await editor.edit(editBuilder => {
                    editBuilder.replace(fullRange, edit.newText);
                });

                // Format the document if possible
                try {
                    await vscode.commands.executeCommand('editor.action.formatDocument');
                } catch (formatError) {
                    console.log('Format document failed:', formatError);
                }

                vscode.window.showInformationMessage(`Successfully updated ${edit.file}`);
            } catch (error) {
                console.error(`Failed to apply edit to ${edit.file}:`, error);
                vscode.window.showErrorMessage(`Failed to apply edit to ${edit.file}: ${error}`);
            }
        }
    }

    public clearChat() {
        console.log("CodyChatProvider: Clearing chat");
        chatHistory = [];
        this.updateChatView();
    }

    private updateChatView() {
        console.log("CodyChatProvider: Updating chat view with history:", chatHistory);
        if (this._view?.visible) {
            this._view.webview.postMessage({
                type: 'updateChat',
                messages: chatHistory
            });
        } else {
            console.log("CodyChatProvider: View is not visible, skipping update");
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        console.log("CodyChatProvider: Generating webview HTML");
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>Cody Chat</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            padding: 0;
            margin: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        #debug {
            display: none;
        }
        
        .chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            margin-bottom: 10px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            background-color: var(--vscode-editor-background);
        }
        
        .message {
            padding: 12px 16px;
            border-radius: 12px;
            max-width: 85%;
            line-height: 1.5;
            position: relative;
            word-wrap: break-word;
            white-space: pre-wrap;
        }
        
        .user-message {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            align-self: flex-end;
        }
        
        .assistant-message {
            background-color: var(--vscode-editor-selectionBackground);
            border-left: 3px solid var(--vscode-focusBorder);
            align-self: flex-start;
        }

        .message-content {
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 14px;
        }
        
        .timestamp {
            font-size: 11px;
            opacity: 0.7;
            margin-top: 6px;
            text-align: right;
        }
        
        .input-container {
            display: flex;
            gap: 8px;
            padding: 16px;
            background-color: var(--vscode-editor-background);
            border-top: 1px solid var(--vscode-panel-border);
            position: sticky;
            bottom: 0;
        }
        
        #messageInput {
            flex: 1;
            padding: 10px 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 8px;
            font-size: 14px;
            resize: none;
            min-height: 20px;
            max-height: 120px;
            outline: none;
            font-family: inherit;
        }
        
        button {
            padding: 8px 16px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 4px;
            min-width: 80px;
            justify-content: center;
            font-family: inherit;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .loading {
            display: none;
            padding: 12px;
            margin: 0 auto;
            align-self: flex-start;
        }

        .loading.active {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .dots {
            display: inline-flex;
            gap: 4px;
            align-items: center;
        }

        .dot {
            width: 8px;
            height: 8px;
            background-color: var(--vscode-button-background);
            border-radius: 50%;
            animation: pulse 1.5s infinite;
        }

        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes pulse {
            0%, 100% { transform: scale(0.8); opacity: 0.5; }
            50% { transform: scale(1.2); opacity: 1; }
        }

        pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 12px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 8px 0;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }
        
        code {
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            padding: 2px 4px;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 3px;
        }

        .clear-button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .clear-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .loading-text {
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
        }

        .edit-info {
            margin-top: 8px;
            font-size: 12px;
            color: var(--vscode-textLink-foreground);
            font-style: italic;
        }
    </style>
</head>
<body>
    <div id="debug"></div>
    <div class="chat-container" id="chatContainer"></div>
    
    <div class="input-container">
        <textarea id="messageInput" placeholder="Ask Cody anything..." rows="1"></textarea>
        <button id="sendButton" class="send-button">Send</button>
        <button id="clearButton" class="clear-button">Clear</button>
    </div>

    <script>
        (function() {
            const vscode = acquireVsCodeApi();
            const messageInput = document.getElementById('messageInput');
            const sendButton = document.getElementById('sendButton');
            const clearButton = document.getElementById('clearButton');
            const chatContainer = document.getElementById('chatContainer');
            const debugDiv = document.getElementById('debug');
            
            // Disable debug mode
            const DEBUG = false;
            
            function debug(...args) {
                if (DEBUG) {
                    const debugMsg = JSON.stringify(args, null, 2);
                    debugDiv.textContent = debugMsg + '\\n' + debugDiv.textContent;
                    console.log(...args);
                }
            }
            
            function sendMessage() {
                const message = messageInput.value.trim();
                if (message) {
                    debug('Sending message:', message);
                    
                    // Add user message immediately
                    addMessageToChat({
                        role: 'user',
                        content: message,
                        timestamp: new Date()
                    });
                    
                    // Add loading indicator
                    const loadingDiv = document.createElement('div');
                    loadingDiv.className = 'loading active';
                    loadingDiv.innerHTML = \`
                        <div class="dots">
                            <div class="dot"></div>
                            <div class="dot"></div>
                            <div class="dot"></div>
                        </div>
                        <span class="loading-text">Thinking...</span>
                    \`;
                    chatContainer.appendChild(loadingDiv);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                    
                    // Send message to extension
                    vscode.postMessage({
                        type: 'sendMessage',
                        value: message
                    });
                    
                    messageInput.value = '';
                    adjustTextareaHeight();
                }
            }
            
            function addMessageToChat(message) {
                const messageDiv = document.createElement('div');
                messageDiv.className = \`message \${message.role}-message\`;
                
                const contentDiv = document.createElement('div');
                contentDiv.className = 'message-content';
                contentDiv.textContent = message.content;
                
                // Add code edit indicators if present
                if (message.codeEdits && message.codeEdits.length > 0) {
                    const editInfo = document.createElement('div');
                    editInfo.className = 'edit-info';
                    editInfo.textContent = \`Applied \${message.codeEdits.length} code edit(s)\`;
                    contentDiv.appendChild(editInfo);
                }
                
                const timestampDiv = document.createElement('div');
                timestampDiv.className = 'timestamp';
                timestampDiv.textContent = new Date(message.timestamp).toLocaleTimeString();
                
                messageDiv.appendChild(contentDiv);
                messageDiv.appendChild(timestampDiv);
                chatContainer.appendChild(messageDiv);
                
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
            
            function clearChat() {
                debug('Clearing chat');
                vscode.postMessage({
                    type: 'clearChat'
                });
            }

            function adjustTextareaHeight() {
                messageInput.style.height = 'auto';
                messageInput.style.height = (messageInput.scrollHeight) + 'px';
            }
            
            messageInput.addEventListener('input', adjustTextareaHeight);
            
            messageInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });

            sendButton.addEventListener('click', function(e) {
                e.preventDefault();
                sendMessage();
            });

            clearButton.addEventListener('click', function(e) {
                e.preventDefault();
                clearChat();
            });
            
            window.addEventListener('message', event => {
                try {
                    const message = event.data;
                    debug('Received message from extension:', message);
                    
                    switch (message.type) {
                        case 'updateChat':
                            // Remove loading indicator if present
                            const loadingIndicator = chatContainer.querySelector('.loading');
                            if (loadingIndicator) {
                                loadingIndicator.remove();
                            }
                            
                            // Clear and update chat
                            chatContainer.innerHTML = '';
                            message.messages.forEach(msg => addMessageToChat(msg));
                            break;
                    }
                } catch (error) {
                    debug('Error handling message:', error);
                }
            });

            // Initial textarea height adjustment
            adjustTextareaHeight();
            
            // Signal that the webview is ready
            vscode.postMessage({ type: 'ready' });
            debug('Webview initialized');
        })();
    </script>
</body>
</html>`;
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log("Cody LOG: Activating extension...");

    // Register the chat provider
    const chatProvider = new CodyChatProvider(context.extensionUri);
    console.log("Cody LOG: Chat provider created.");
    
    // Register the webview view provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('codyChat', chatProvider)
    );
    console.log("Cody LOG: Chat provider registered.");

    // Start file watching for live project awareness
    startFileWatching().catch(console.error);

    // Helper function to register commands with error handling
    const registerCommand = (name: string, callback: (...args: any[]) => any) => {
        return vscode.commands.registerCommand(name, async (...args: any[]) => {
            try {
                await callback(...args);
            } catch (error) {
                vscode.window.showErrorMessage(`Cody Error: ${error}`);
            }
        });
    };

    // Creates and shows a webview panel for displaying explanations
    const createExplanationWebview = (title: string, content: string, extensionContext: vscode.ExtensionContext) => {
        const panel = vscode.window.createWebviewPanel(
            'codyExplanation',
            title,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true
            }
        );

        const htmlContent = md.render(content);
        panel.webview.html = getWebviewContent(title, htmlContent);

        panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'close':
                        panel.dispose();
                        return;
                }
            },
            undefined,
            extensionContext.subscriptions
        );
    };

    // Creates and shows a diff webview for bug fixes
    const createBugFixDiffWebview = (title: string, originalCode: string, fixedCode: string, extensionContext: vscode.ExtensionContext) => {
        const panel = vscode.window.createWebviewPanel(
            'codyBugFix',
            title,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true
            }
        );

        const diffResult = diff.createPatch('code', originalCode, fixedCode, 'Original', 'Fixed');
        panel.webview.html = getBugFixWebviewContent(title, originalCode, fixedCode, diffResult);

        panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'applyFix':
                        applyBugFix(originalCode, fixedCode);
                        panel.dispose();
                        return;
                    case 'close':
                        panel.dispose();
                        return;
                }
            },
            undefined,
            extensionContext.subscriptions
        );
    };

    // Apply the bug fix to the editor
    const applyBugFix = (originalCode: string, fixedCode: string) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        if (selectedText === originalCode) {
            editor.edit(editBuilder => {
                editBuilder.replace(selection, fixedCode);
            });
            vscode.window.showInformationMessage('Bug fix applied successfully!');
        } else {
            vscode.window.showWarningMessage('Selected code has changed. Please reselect and try again.');
        }
    };

    // File watching for live project awareness
    async function startFileWatching() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        try {
            // Dynamic import for chokidar
            chokidar = await import('chokidar');
            
            const watchPath = workspaceFolder.uri.fsPath;
            
            fileWatcher = chokidar.watch(watchPath, {
                ignored: [
                    '**/node_modules/**',
                    '**/.git/**',
                    '**/dist/**',
                    '**/build/**',
                    '**/*.log',
                    '**/cody_chroma_db/**'
                ],
                persistent: true,
                ignoreInitial: true
            });

            let reindexTimeout: NodeJS.Timeout;

            fileWatcher.on('all', (event: string, filePath: string) => {
                // Debounce reindexing to avoid too frequent updates
                clearTimeout(reindexTimeout);
                reindexTimeout = setTimeout(() => {
                    if (!isIndexing) {
                        reindexProject();
                    }
                }, 5000); // Wait 5 seconds after last change
            });

            console.log('File watching started for:', watchPath);
        } catch (error) {
            console.error('Failed to start file watching:', error);
        }
    }

    // COMMAND: Generate Code
    let generateCodeDisposable = registerCommand('cody.generateCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        if (selectedText) {
            const prompt = await vscode.window.showInputBox({
                prompt: "What do you want to do with this code?",
                placeHolder: "e.g., refactor, add comments, fix..."
            });
            if (!prompt) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Cody is thinking...",
                cancellable: false
            }, async () => {
                const response = await makeApiCall(prompt, editor.document.languageId, selectedText);
                if (response.data.code) {
                    editor.edit(editBuilder => {
                        editBuilder.replace(selection, response.data.code);
                    });
                    vscode.window.showInformationMessage('Cody has updated your code!');
                }
            });
        } else {
            vscode.window.showInformationMessage('Please select some code first.');
        }
    });

    // COMMAND: Explain Code
    let explainCodeDisposable = registerCommand('cody.explainCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        
        const selectedText = editor.document.getText(editor.selection);
        if (!selectedText) {
            vscode.window.showInformationMessage('Please select some code to explain.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Cody is explaining...",
            cancellable: false
        }, async () => {
            const explainPrompt = "Explain the following code in a clear, concise way. Describe its purpose, inputs, and outputs.";
            const response = await makeApiCall(explainPrompt, editor.document.languageId, selectedText);

            if (response.data.code) {
                createExplanationWebview("Cody's Explanation", response.data.code, context);
            }
        });
    });

    // COMMAND: Generate Tests
    let generateTestsDisposable = registerCommand('cody.generateTests', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            vscode.window.showInformationMessage('Please select code to generate tests for.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Cody is writing tests...",
            cancellable: false
        }, async () => {
            const testPrompt = "Write comprehensive unit tests for the following code. Use a popular testing framework for the language. Do not include the original code in the response.";
            const response = await makeApiCall(testPrompt, editor.document.languageId, selectedText);

            if (response.data.code) {
                const insertPosition = new vscode.Position(selection.end.line + 1, 0);
                editor.edit(editBuilder => {
                    editBuilder.insert(insertPosition, "\n" + response.data.code);
                });
                vscode.window.showInformationMessage('Cody has added unit tests!');
            }
        });
    });

    // COMMAND: Fix Bug
    let fixBugDisposable = registerCommand('cody.fixBug', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            vscode.window.showInformationMessage('Please select the buggy code first.');
            return;
        }

        const errorMessage = await vscode.window.showInputBox({
            prompt: "What's the error or issue you're experiencing?",
            placeHolder: "e.g., TypeError: Cannot read property 'length' of undefined"
        });
        
        if (!errorMessage) return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Cody is fixing the bug...",
            cancellable: false
        }, async () => {
            const response = await makeBugFixApiCall(selectedText, errorMessage, editor.document.languageId);

            if (response.data.fixedCode) {
                createBugFixDiffWebview(
                    "Cody's Bug Fix",
                    selectedText,
                    response.data.fixedCode,
                    context
                );
            }
        });
    });

    // COMMAND: Clear Chat
    let clearChatDisposable = registerCommand('cody.clearChat', async () => {
        console.log("Cody LOG: 'cody.clearChat' command executed.");
        if (chatProvider) {
            chatProvider.clearChat();
        }
    });

    // COMMAND: Re-index Project
    let reindexProjectDisposable = registerCommand('cody.reindexProject', async () => {
        await reindexProject();
    });

    // Register all commands
    context.subscriptions.push(
        generateCodeDisposable,
        explainCodeDisposable,
        generateTestsDisposable,
        fixBugDisposable,
        clearChatDisposable,
        reindexProjectDisposable
    );

    // Initial project indexing
    setTimeout(() => {
        reindexProject();
    }, 2000); // Wait 2 seconds after activation
}

// HTML content for explanation webview
function getWebviewContent(title: string, content: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            overflow-y: auto;
            line-height: 1.6;
        }
        h1, h2, h3, h4, h5, h6 {
            font-weight: bold;
        }
        code {
            font-family: var(--vscode-editor-font-family);
            background-color: var(--vscode-editor-selectionBackground);
            padding: 2px 4px;
            border-radius: 4px;
        }
        pre {
            background-color: var(--vscode-editor-selectionBackground);
            padding: 10px;
            border-radius: 4px;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .close-button {
            position: fixed;
            top: 15px;
            right: 15px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
        }
        .close-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <button class="close-button" onclick="closePanel()">✕</button>
    <h1>${title}</h1>
    <div>${content}</div>
    <script>
        const vscode = acquireVsCodeApi();
        function closePanel() {
            vscode.postMessage({ command: 'close' });
        }
    </script>
</body>
</html>`;
}

// HTML content for bug fix diff webview
function getBugFixWebviewContent(title: string, originalCode: string, fixedCode: string, diffResult: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            overflow-y: auto;
            line-height: 1.6;
        }
        
        .button-container {
            margin: 20px 0;
            display: flex;
            gap: 10px;
        }
        
        button {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        
        .apply-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .apply-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .close-button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .close-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .code-section {
            margin: 20px 0;
        }
        
        .code-section h3 {
            margin-bottom: 10px;
            color: var(--vscode-textLink-foreground);
        }
        
        pre {
            background-color: var(--vscode-editor-selectionBackground);
            padding: 15px;
            border-radius: 4px;
            white-space: pre-wrap;
            word-wrap: break-word;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            overflow-x: auto;
        }
        
        .diff-section {
            margin: 20px 0;
        }
        
        .diff-section pre {
            background-color: var(--vscode-textCodeBlock-background);
            border-left: 4px solid var(--vscode-focusBorder);
        }
        
        .diff-added {
            background-color: rgba(0, 255, 0, 0.1);
        }
        
        .diff-removed {
            background-color: rgba(255, 0, 0, 0.1);
        }
    </style>
</head>
<body>
    <h1>${title}</h1>
    
    <div class="button-container">
        <button class="apply-button" onclick="applyFix()">Apply Fix</button>
        <button class="close-button" onclick="closePanel()">Close</button>
    </div>
    
    <div class="code-section">
        <h3>Original Code:</h3>
        <pre>${originalCode}</pre>
    </div>
    
    <div class="code-section">
        <h3>Fixed Code:</h3>
        <pre>${fixedCode}</pre>
    </div>
    
    <div class="diff-section">
        <h3>Diff:</h3>
        <pre>${diffResult}</pre>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function applyFix() {
            vscode.postMessage({ command: 'applyFix' });
        }
        
        function closePanel() {
            vscode.postMessage({ command: 'close' });
        }
    </script>
</body>
</html>`;
}

export function deactivate() {
    if (fileWatcher) {
        fileWatcher.close();
    }
} 