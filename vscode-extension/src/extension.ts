import * as vscode from 'vscode';
import axios from 'axios';
import * as MarkdownIt from 'markdown-it';
import * as diff from 'diff';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager, registerConfigurationListener } from './config';
import { ApiClient, ChatMessage, CodeEdit } from './apiClient';
import { CodyCompletionProvider } from './completionProvider';

// Use dynamic import for chokidar to avoid type issues
let chokidar: any;

const md = new MarkdownIt();

// Global state
interface ChatMessageInternal {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    codeEdits?: CodeEdit[];
}

let chatHistory: ChatMessageInternal[] = [];
let chatWebviewPanel: vscode.WebviewPanel | undefined;
let fileWatcher: any | undefined;
let isIndexing = false;
let apiClient: ApiClient;
let configManager: ConfigManager;

// Deprecated: Use ApiClient instead
async function makeApiCall(prompt: string, language: string, context: string) {
    console.warn('makeApiCall is deprecated, use ApiClient.generateCode instead');
    return await apiClient.generateCode(prompt, language, context);
}

async function makeChatApiCall(prompt: string, language: string, context: string, chatHistory: ChatMessage[]) {
    console.warn('makeChatApiCall is deprecated, use ApiClient.chat instead');
    return await apiClient.chat(prompt, language, context, chatHistory);
}

async function makeBugFixApiCall(code: string, errorMessage: string, language: string) {
    console.warn('makeBugFixApiCall is deprecated, use ApiClient.fixBug instead');
    return await apiClient.fixBug(code, errorMessage, language);
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
            cancellable: true
        }, async (progress, token) => {
            // Report initial progress
            progress.report({ increment: 0, message: "Starting indexing..." });
            
            // Check if operation was cancelled
            if (token.isCancellationRequested) {
                throw new Error('Indexing cancelled by user');
            }

            progress.report({ increment: 50, message: "Processing files..." });
            
            const response = await apiClient.reindexProject(workspaceFolder.uri.fsPath);
            
            if (!response.success) {
                throw new Error(response.error || 'Unknown error during reindexing');
            }
            
            progress.report({ increment: 100, message: "Indexing complete!" });
            return response;
        });
        
        vscode.window.showInformationMessage('Project reindexed successfully!');
    } catch (error: any) {
        const errorMsg = error?.message || String(error);
        console.error('Reindex failed:', error);
        
        if (errorMsg.includes('cancelled')) {
            vscode.window.showInformationMessage('Indexing cancelled');
        } else {
            vscode.window.showErrorMessage(`Failed to reindex project: ${errorMsg}`);
        }
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

        // Add loading state immediately
        this.setLoadingState(true);

        try {
            // Add user message to history
            const userMessage: ChatMessageInternal = {
                role: 'user',
                content: message,
                timestamp: new Date()
            };
            chatHistory.push(userMessage);

            this.updateChatView();

            // Get current editor context with better error handling
            const { context, language, currentFile } = await this.getCurrentEditorContext();

            console.log("CodyChatProvider: Making API call");
            
            // Make API call with better error handling and timeout
            const response = await Promise.race([
                apiClient.chat(
                    message,
                    language,
                    context,
                    chatHistory.map(msg => ({
                        role: msg.role,
                        content: msg.content,
                        timestamp: msg.timestamp.toISOString()
                    })),
                    currentFile
                ),
                new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('Request timeout after 60 seconds')), 60000)
                )
            ]);

            console.log("CodyChatProvider: Received API response:", response);

            if (response.success && response.data?.response) {
                // Add assistant response to history
                const assistantMessage: ChatMessageInternal = {
                    role: 'assistant',
                    content: response.data.response,
                    timestamp: new Date(),
                    codeEdits: response.data.codeEdits
                };
                chatHistory.push(assistantMessage);

                // Apply code edits if present
                if (response.data.codeEdits && response.data.codeEdits.length > 0) {
                    console.log("Applying code edits:", response.data.codeEdits);
                    try {
                        await this.applyCodeEdits(response.data.codeEdits);
                        assistantMessage.content += '\n\n✅ Applied code changes to your files.';
                    } catch (editError: any) {
                        console.error("Failed to apply code edits:", editError);
                        assistantMessage.content += `\n\n⚠️ Failed to apply some code changes: ${editError.message}`;
                    }
                } else {
                    console.log("No code edits received");
                }

                this.updateChatView();
            } else {
                throw new Error(response.error || 'Failed to get response from API');
            }
        } catch (error: any) {
            console.error("CodyChatProvider: Error in handleChatMessage:", error);
            
            let errorMessage = 'Unknown error occurred';
            if (error.code === 'ECONNREFUSED') {
                errorMessage = 'Cannot connect to Cody backend. Please ensure the backend is running.';
            } else if (error.message?.includes('timeout')) {
                errorMessage = 'Request timed out. Please try a shorter message or check your connection.';
            } else if (error.response?.status === 429) {
                errorMessage = 'Rate limit exceeded. Please wait a moment before trying again.';
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            vscode.window.showErrorMessage(`Chat error: ${errorMessage}`);
            
            const errorResponse: ChatMessageInternal = {
                role: 'assistant',
                content: `❌ Error: ${errorMessage}\n\nPlease try again or check the Cody backend status.`,
                timestamp: new Date()
            };
            chatHistory.push(errorResponse);
            
            this.updateChatView();
        } finally {
            this.setLoadingState(false);
        }
    }

    private async getCurrentEditorContext(): Promise<{context: string, language: string, currentFile: string}> {
        const editor = vscode.window.activeTextEditor;
        let context = '';
        let language = 'text';
        let currentFile = '';

        if (editor) {
            try {
                const selection = editor.selection;
                
                // Get selected text first, then visible ranges if no selection
                if (!selection.isEmpty) {
                    context = editor.document.getText(selection);
                } else {
                    const visibleRanges = editor.visibleRanges;
                    if (visibleRanges.length > 0) {
                        context = editor.document.getText(visibleRanges[0]);
                    } else {
                        context = editor.document.getText();
                    }
                }
                
                // Limit context size with better truncation
                if (context.length > 9000) {
                    const truncateAt = context.lastIndexOf('\n', 9000);
                    context = context.substring(0, truncateAt > 0 ? truncateAt : 9000) + '\n... (truncated for length)';
                }
                
                language = editor.document.languageId;
                currentFile = editor.document.uri.fsPath;
                console.log("Current file:", currentFile);
                console.log("Current language:", language);
            } catch (error: any) {
                console.warn("Failed to get editor context:", error);
                // Continue with empty context rather than failing
            }
        }

        return { context, language, currentFile };
    }

    private setLoadingState(isLoading: boolean) {
        if (this._view?.visible) {
            this._view.webview.postMessage({
                type: 'setLoading',
                isLoading
            });
        }
    }

    private async applyCodeEdits(edits: any[]) {
        const results: Array<{file: string, success: boolean, error?: string}> = [];
        
        for (const edit of edits) {
            try {
                console.log("Applying edit to file:", edit.file);
                
                if (!edit.file || !edit.newText) {
                    throw new Error('Invalid edit: missing file path or content');
                }

                // Convert file path to URI with better path handling
                let fileUri: vscode.Uri;
                try {
                    fileUri = path.isAbsolute(edit.file) 
                        ? vscode.Uri.file(edit.file)
                        : vscode.Uri.file(path.resolve(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', edit.file));
                } catch (pathError) {
                    throw new Error(`Invalid file path: ${edit.file}`);
                }
                
                // Open or create the document
                let document: vscode.TextDocument;
                try {
                    document = await vscode.workspace.openTextDocument(fileUri);
                } catch (error) {
                    console.log("File doesn't exist, creating new file");
                    
                    // Ensure directory exists
                    const dirPath = path.dirname(fileUri.fsPath);
                    try {
                        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
                    } catch (dirError) {
                        // Directory might already exist, that's OK
                    }
                    
                    // Create the file
                    await vscode.workspace.fs.writeFile(fileUri, Buffer.from('', 'utf8'));
                    document = await vscode.workspace.openTextDocument(fileUri);
                }
                
                // Show the document
                const editor = await vscode.window.showTextDocument(document, {
                    preserveFocus: false,
                    preview: false
                });

                // Apply the edit with proper range handling
                const success = await editor.edit(editBuilder => {
                    const fullRange = new vscode.Range(
                        new vscode.Position(0, 0),
                        new vscode.Position(
                            Math.max(0, document.lineCount - 1), 
                            document.lineAt(Math.max(0, document.lineCount - 1)).text.length
                        )
                    );
                    editBuilder.replace(fullRange, edit.newText);
                }, {
                    undoStopBefore: true,
                    undoStopAfter: true
                });

                if (!success) {
                    throw new Error('Failed to apply edit to document');
                }

                // Format the document if possible
                try {
                    await vscode.commands.executeCommand('editor.action.formatDocument');
                } catch (formatError) {
                    console.log('Format document failed (this is OK):', formatError);
                }

                // Save the document
                await document.save();

                results.push({ file: edit.file, success: true });
                vscode.window.showInformationMessage(`✅ Updated ${path.basename(edit.file)}`);
                
            } catch (error: any) {
                const errorMsg = error?.message || String(error);
                console.error(`Failed to apply edit to ${edit.file}:`, error);
                results.push({ file: edit.file, success: false, error: errorMsg });
                vscode.window.showErrorMessage(`❌ Failed to update ${edit.file}: ${errorMsg}`);
            }
        }

        // Show summary if multiple files
        if (results.length > 1) {
            const successful = results.filter(r => r.success).length;
            const failed = results.length - successful;
            
            if (failed === 0) {
                vscode.window.showInformationMessage(`✅ Successfully updated all ${successful} files`);
            } else {
                vscode.window.showWarningMessage(`⚠️ Updated ${successful} files, failed to update ${failed} files`);
            }
        }

        return results;
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
                        case 'setLoading':
                            if (message.isLoading) {
                                // Add loading indicator if not already present
                                if (!chatContainer.querySelector('.loading')) {
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
                                }
                            } else {
                                // Remove loading indicator
                                const loadingIndicator = chatContainer.querySelector('.loading');
                                if (loadingIndicator) {
                                    loadingIndicator.remove();
                                }
                            }
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

    // Initialize configuration and API client
    configManager = ConfigManager.getInstance();
    apiClient = ApiClient.getInstance();

    // Register configuration listener
    registerConfigurationListener(context);

    // Register the chat provider
    const chatProvider = new CodyChatProvider(context.extensionUri);
    console.log("Cody LOG: Chat provider created.");
    
    // Register the webview view provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('codyChat', chatProvider)
    );
    console.log("Cody LOG: Chat provider registered.");

    // Register completion provider
    const completionProvider = new CodyCompletionProvider(context);
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            ['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'cpp', 'c', 'csharp'],
            completionProvider,
            ...completionProvider.triggerCharacters
        )
    );
    console.log("Cody LOG: Completion provider registered.");

    // Start file watching for live project awareness
    startFileWatching().catch(console.error);

    // Check backend connection on startup
    checkBackendConnection();

    // Helper function to register commands with error handling
    const registerCommand = (name: string, callback: (...args: any[]) => any) => {
        return vscode.commands.registerCommand(name, async (...args: any[]) => {
            try {
                await callback(...args);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Cody Error: ${errorMsg}`);
                console.error(`Command ${name} failed:`, error);
            }
        });
    };

    // Check backend connection with retry logic
    async function checkBackendConnection() {
        const config = configManager.getConfig();
        const maxRetries = 3;
        let attempt = 0;
        
        if (config.debugMode) {
            console.log("Checking backend connection...");
        }

        while (attempt < maxRetries) {
            try {
                const healthResponse = await apiClient.checkHealth();
                
                if (healthResponse.success) {
                    if (config.debugMode) {
                        console.log("Backend connection successful");
                    }
                    return; // Success, exit function
                } else {
                    throw new Error(healthResponse.error || 'Health check failed');
                }
            } catch (error: any) {
                attempt++;
                const isLastAttempt = attempt >= maxRetries;
                
                if (config.debugMode) {
                    console.log(`Backend connection attempt ${attempt}/${maxRetries} failed:`, error);
                }
                
                if (isLastAttempt) {
                    // Final attempt failed, show error to user
                    const errorMsg = error.code === 'ECONNREFUSED' 
                        ? 'Cannot connect to Cody backend. Please start the backend server.'
                        : error.message || 'Unknown connection error';
                        
                    vscode.window.showErrorMessage(
                        `Failed to connect to Cody backend: ${errorMsg}`,
                        'Open Settings', 'Retry', 'Help'
                    ).then(selection => {
                        if (selection === 'Open Settings') {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'cody');
                        } else if (selection === 'Retry') {
                            checkBackendConnection();
                        } else if (selection === 'Help') {
                            vscode.env.openExternal(vscode.Uri.parse('https://github.com/your-repo/cody#setup'));
                        }
                    });
                } else {
                    // Wait before retrying (exponential backoff)
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                }
            }
        }
    }

    // COMMAND: Generate Code with improved async handling
    let generateCodeDisposable = registerCommand('cody.generateCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('Please open a file first.');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        if (!selectedText) {
            vscode.window.showInformationMessage('Please select some code first.');
            return;
        }

        const prompt = await vscode.window.showInputBox({
            prompt: "What do you want to do with this code?",
            placeHolder: "e.g., refactor, add comments, optimize...",
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Please enter a prompt';
                }
                if (value.length > 500) {
                    return 'Prompt is too long (max 500 characters)';
                }
                return null;
            }
        });
        
        if (!prompt) return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Cody is thinking...",
            cancellable: true
        }, async (progress, token) => {
            try {
                // Report progress steps
                progress.report({ increment: 0, message: "Analyzing code..." });
                
                if (token.isCancellationRequested) {
                    throw new Error('Operation cancelled by user');
                }

                progress.report({ increment: 30, message: "Generating solution..." });

                const response = await Promise.race([
                    apiClient.generateCode(prompt, editor.document.languageId, selectedText),
                    new Promise<never>((_, reject) => 
                        setTimeout(() => reject(new Error('Request timeout')), 30000)
                    )
                ]);

                if (token.isCancellationRequested) {
                    throw new Error('Operation cancelled by user');
                }

                progress.report({ increment: 70, message: "Applying changes..." });

                if (response.success && response.data?.code) {
                    await editor.edit(editBuilder => {
                        editBuilder.replace(selection, response.data!.code);
                    });
                    
                    progress.report({ increment: 100, message: "Complete!" });
                    vscode.window.showInformationMessage('✅ Cody has updated your code!');
                } else {
                    throw new Error(response.error || 'Failed to generate code');
                }
            } catch (error: any) {
                if (error.message?.includes('cancelled')) {
                    vscode.window.showInformationMessage('Code generation cancelled');
                } else {
                    throw error; // Re-throw for registerCommand error handling
                }
            }
        });
    });

    // COMMAND: Explain Code with improved async handling
    let explainCodeDisposable = registerCommand('cody.explainCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('Please open a file first.');
            return;
        }
        
        const selectedText = editor.document.getText(editor.selection);
        if (!selectedText) {
            vscode.window.showInformationMessage('Please select some code to explain.');
            return;
        }

        // Validate selection size
        if (selectedText.length > 10000) {
            const proceed = await vscode.window.showWarningMessage(
                'Selected code is quite long. This may take longer to process.',
                'Continue', 'Cancel'
            );
            if (proceed !== 'Continue') return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Cody is explaining...",
            cancellable: true
        }, async (progress, token) => {
            try {
                progress.report({ increment: 0, message: "Analyzing code structure..." });

                const explainPrompt = "Explain the following code in a clear, concise way. Describe its purpose, inputs, and outputs.";
                
                if (token.isCancellationRequested) {
                    throw new Error('Operation cancelled by user');
                }

                progress.report({ increment: 50, message: "Generating explanation..." });

                const response = await Promise.race([
                    apiClient.generateCode(explainPrompt, editor.document.languageId, selectedText),
                    new Promise<never>((_, reject) => 
                        setTimeout(() => reject(new Error('Request timeout')), 45000)
                    )
                ]);

                if (token.isCancellationRequested) {
                    throw new Error('Operation cancelled by user');
                }

                progress.report({ increment: 90, message: "Preparing explanation..." });

                if (response.success && response.data?.code) {
                    createExplanationWebview("Cody's Explanation", response.data.code, context);
                    progress.report({ increment: 100, message: "Complete!" });
                } else {
                    throw new Error(response.error || 'Failed to explain code');
                }
            } catch (error: any) {
                if (error.message?.includes('cancelled')) {
                    vscode.window.showInformationMessage('Code explanation cancelled');
                } else {
                    throw error; // Re-throw for registerCommand error handling
                }
            }
        });
    });

    // COMMAND: Generate Tests with improved async handling
    let generateTestsDisposable = registerCommand('cody.generateTests', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('Please open a file first.');
            return;
        }
        
        const selectedText = editor.document.getText(editor.selection);
        if (!selectedText) {
            vscode.window.showInformationMessage('Please select some code to generate tests for.');
            return;
        }

        // Validate selection
        if (selectedText.length > 15000) {
            const proceed = await vscode.window.showWarningMessage(
                'Selected code is very long. Consider selecting a smaller function or class.',
                'Continue Anyway', 'Cancel'
            );
            if (proceed !== 'Continue Anyway') return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Cody is generating tests...",
            cancellable: true
        }, async (progress, token) => {
            try {
                progress.report({ increment: 0, message: "Analyzing code structure..." });

                const testPrompt = "Generate comprehensive unit tests for the following code. Include edge cases and proper assertions.";
                
                if (token.isCancellationRequested) {
                    throw new Error('Operation cancelled by user');
                }

                progress.report({ increment: 30, message: "Designing test cases..." });

                const response = await Promise.race([
                    apiClient.generateCode(testPrompt, editor.document.languageId, selectedText),
                    new Promise<never>((_, reject) => 
                        setTimeout(() => reject(new Error('Request timeout')), 60000)
                    )
                ]);

                if (token.isCancellationRequested) {
                    throw new Error('Operation cancelled by user');
                }

                progress.report({ increment: 70, message: "Creating test file..." });

                if (response.success && response.data?.code) {
                    // Generate appropriate test file name
                    const fileExt = path.extname(editor.document.fileName);
                    const baseName = path.basename(editor.document.fileName, fileExt);
                    
                    let testFileName: string;
                    switch (editor.document.languageId) {
                        case 'javascript':
                        case 'typescript':
                            testFileName = `${baseName}.test${fileExt}`;
                            break;
                        case 'python':
                            testFileName = `test_${baseName}${fileExt}`;
                            break;
                        default:
                            testFileName = `${baseName}_test${fileExt}`;
                    }
                    
                    const testFileUri = vscode.Uri.file(path.join(path.dirname(editor.document.fileName), testFileName));
                    
                    // Check if test file already exists
                    try {
                        await vscode.workspace.fs.stat(testFileUri);
                        const overwrite = await vscode.window.showWarningMessage(
                            `Test file ${testFileName} already exists. Overwrite?`,
                            'Overwrite', 'Cancel'
                        );
                        if (overwrite !== 'Overwrite') return;
                    } catch {
                        // File doesn't exist, continue
                    }
                    
                    await vscode.workspace.fs.writeFile(testFileUri, Buffer.from(response.data.code, 'utf8'));
                    const testDocument = await vscode.workspace.openTextDocument(testFileUri);
                    await vscode.window.showTextDocument(testDocument);
                    
                    progress.report({ increment: 100, message: "Complete!" });
                    vscode.window.showInformationMessage(`✅ Test file created: ${testFileName}`);
                } else {
                    throw new Error(response.error || 'Failed to generate tests');
                }
            } catch (error: any) {
                if (error.message?.includes('cancelled')) {
                    vscode.window.showInformationMessage('Test generation cancelled');
                } else {
                    throw error; // Re-throw for registerCommand error handling
                }
            }
        });
    });

    // COMMAND: Fix Bug with improved async handling
    let fixBugDisposable = registerCommand('cody.fixBug', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('Please open a file first.');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            vscode.window.showInformationMessage('Please select the buggy code first.');
            return;
        }

        const errorMessage = await vscode.window.showInputBox({
            prompt: "What's the error or issue you're experiencing?",
            placeHolder: "e.g., TypeError: Cannot read property 'length' of undefined",
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Please describe the error or issue';
                }
                if (value.length > 1000) {
                    return 'Error description is too long (max 1000 characters)';
                }
                return null;
            }
        });
        
        if (!errorMessage) return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Cody is fixing the bug...",
            cancellable: true
        }, async (progress, token) => {
            try {
                progress.report({ increment: 0, message: "Analyzing the bug..." });

                if (token.isCancellationRequested) {
                    throw new Error('Operation cancelled by user');
                }

                progress.report({ increment: 30, message: "Finding solution..." });

                const response = await Promise.race([
                    apiClient.fixBug(selectedText, errorMessage, editor.document.languageId),
                    new Promise<never>((_, reject) => 
                        setTimeout(() => reject(new Error('Request timeout')), 45000)
                    )
                ]);

                if (token.isCancellationRequested) {
                    throw new Error('Operation cancelled by user');
                }

                progress.report({ increment: 80, message: "Preparing fix..." });

                if (response.success && response.data?.fixedCode) {
                    createBugFixDiffWebview(
                        "Cody's Bug Fix",
                        selectedText,
                        response.data.fixedCode,
                        context
                    );
                    progress.report({ increment: 100, message: "Complete!" });
                } else {
                    throw new Error(response.error || 'Failed to fix bug');
                }
            } catch (error: any) {
                if (error.message?.includes('cancelled')) {
                    vscode.window.showInformationMessage('Bug fix cancelled');
                } else {
                    throw error; // Re-throw for registerCommand error handling
                }
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

    console.log("Cody LOG: Extension activation complete.");
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

// File watching for live project awareness with improved error handling
async function startFileWatching() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        console.log('No workspace folder found, skipping file watching');
        return;
    }

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
                '**/cody_chroma_db/**',
                '**/coverage/**',
                '**/.vscode/**',
                '**/__pycache__/**'
            ],
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 1000,
                pollInterval: 100
            },
            depth: 10 // Limit recursion depth
        });

        let reindexTimeout: NodeJS.Timeout;
        let changeCount = 0;
        const maxChangesBeforeReindex = 5;

        fileWatcher.on('all', (event: string, filePath: string) => {
            try {
                // Only reindex for meaningful file changes
                const isCodeFile = /\.(js|ts|py|java|cpp|c|h|go|rs|php|rb|swift|kt)$/i.test(filePath);
                if (!isCodeFile) return;

                changeCount++;
                console.log(`File ${event}: ${path.relative(watchPath, filePath)} (${changeCount} changes)`);

                // Debounce reindexing to avoid too frequent updates
                clearTimeout(reindexTimeout);
                reindexTimeout = setTimeout(() => {
                    if (!isIndexing && changeCount >= maxChangesBeforeReindex) {
                        console.log(`Triggering reindex after ${changeCount} changes`);
                        reindexProject().catch(error => {
                            console.error('Auto-reindex failed:', error);
                        });
                        changeCount = 0;
                    }
                }, 5000); // Wait 5 seconds after last change
            } catch (error) {
                console.error('Error handling file change:', error);
            }
        });

        fileWatcher.on('error', (error: any) => {
            console.error('File watcher error:', error);
            vscode.window.showWarningMessage('File watching encountered an error. Auto-indexing may not work properly.');
        });

        fileWatcher.on('ready', () => {
            console.log('File watching started for:', watchPath);
            const config = configManager.getConfig();
            if (config.debugMode) {
                vscode.window.showInformationMessage('Cody file watching started');
            }
        });

    } catch (error: any) {
        console.error('Failed to start file watching:', error);
        vscode.window.showWarningMessage(
            'Failed to start file watching. Auto-indexing will not be available.',
            'Install Dependencies'
        ).then(selection => {
            if (selection === 'Install Dependencies') {
                vscode.window.showInformationMessage('Please run: npm install chokidar in the extension directory');
            }
        });
    }
}

// Helper functions
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