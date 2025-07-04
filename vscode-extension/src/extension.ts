import * as vscode from 'vscode';
import axios from 'axios';
import * as MarkdownIt from 'markdown-it';

const md = new MarkdownIt();

async function makeApiCall(prompt: string, language: string, context: string) {
    return await axios.post('http://localhost:8000/generate', {
        prompt,
        language,
        context
    });
}

export function activate(context: vscode.ExtensionContext) {

    /**
     * A helper function to register commands and wrap them in a try-catch block
     * for consistent error handling.
     * @param name The name of the command to register.
     * @param callback The function to execute when the command is called.
     */
    const registerCommand = (name: string, callback: (...args: any[]) => any) => {
        return vscode.commands.registerCommand(name, async (...args: any[]) => {
            try {
                await callback(...args);
            } catch (error) {
                vscode.window.showErrorMessage(`Cody Error: ${error}`);
            }
        });
    };

    /**
     * Creates and shows a new webview panel for displaying explanations.
     * @param title The title of the panel.
     * @param content The markdown content to display.
     * @param extensionContext The extension context.
     */
    const createExplanationWebview = (title: string, content: string, extensionContext: vscode.ExtensionContext) => {
        const panel = vscode.window.createWebviewPanel(
            'codyExplanation', // Identifies the type of the webview. Used internally
            title, // Title of the panel displayed to the user
            vscode.ViewColumn.Beside, // Editor column to show the new webview panel in.
            {
                // Enable javascript in the webview
                enableScripts: true
            }
        );

        const htmlContent = md.render(content);
        panel.webview.html = getWebviewContent(title, htmlContent);

        // Handle messages from the webview
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

    // Command to generate, refactor, or modify code based on a prompt.
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

    // Command to explain a selected piece of code.
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
                // Show the explanation in a new webview panel.
                createExplanationWebview("Cody's Explanation", response.data.code, context);
            }
        });
    });

    // Command to generate unit tests for a selected piece of code.
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
                // Insert the generated tests on the line below the selection.
                editor.edit(editBuilder => {
                    editBuilder.insert(insertPosition, "\n" + response.data.code);
                });
                vscode.window.showInformationMessage('Cody has added unit tests!');
            }
        });
    });


    context.subscriptions.push(generateCodeDisposable, explainCodeDisposable, generateTestsDisposable);
}

/**
 * Generates the HTML content for the explanation webview.
 * @param title The title of the explanation.
 * @param content The HTML content of the explanation.
 */
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
            right: 25px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 12px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
        }
        .close-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <button class="close-button" id="close-button">Close</button>
    <h1>${title}</h1>
    ${content}

    <script>
        const vscode = acquireVsCodeApi();
        document.getElementById('close-button').addEventListener('click', () => {
            vscode.postMessage({
                command: 'close'
            });
        });
    </script>
</body>
</html>`;
}

export function deactivate() {} 