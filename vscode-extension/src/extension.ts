import * as vscode from 'vscode';
import axios from 'axios';

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
                // Show the explanation in a modal message.
                vscode.window.showInformationMessage("Cody's Explanation", { modal: true, detail: response.data.code });
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

export function deactivate() {} 