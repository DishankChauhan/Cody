import * as vscode from 'vscode';
import { ApiClient } from './apiClient';
import { CompletionSuggestion } from './types';

export class CodyCompletionProvider implements vscode.CompletionItemProvider {
    private apiClient: ApiClient;
    private context: vscode.ExtensionContext;
    public readonly triggerCharacters = ['.', '(', '{', '[', '"', "'", ' ', '\n', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];
    private minCharsBeforeSuggesting = 1;
    private lastRequestTime = 0;
    private debounceMs = 50;  // Reduced debounce time

    constructor(context: vscode.ExtensionContext) {
        this.apiClient = ApiClient.getInstance();
        this.context = context;
    }

    public async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[] | undefined> {
        try {
            // Debounce requests
            const now = Date.now();
            if (now - this.lastRequestTime < this.debounceMs) {
                return undefined;
            }
            this.lastRequestTime = now;

            // Get current line and prefix
            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            if (linePrefix.trim().length < this.minCharsBeforeSuggesting) {
                return undefined;
            }

            // Get context (previous lines for better suggestions)
            const startLine = Math.max(0, position.line - 10);
            const context = document.getText(new vscode.Range(
                new vscode.Position(startLine, 0),
                position
            ));

            const suggestions = await this.apiClient.getCompletions(
                context,
                document.languageId,
                linePrefix
            );

            if (!suggestions) {
                return undefined;
            }

            return suggestions.map(suggestion => {
                const item = new vscode.CompletionItem(suggestion.text, vscode.CompletionItemKind.Text);
                item.detail = "Cody AI";
                item.documentation = suggestion.explanation;
                item.insertText = suggestion.text;
                item.range = suggestion.replaceRange ? new vscode.Range(
                    position.translate(0, -suggestion.replaceRange.start),
                    position.translate(0, -suggestion.replaceRange.end)
                ) : undefined;
                item.sortText = '0'; // Higher priority
                item.preselect = true; // Show completion immediately
                return item;
            });
        } catch (error) {
            console.error('Error in completion provider:', error);
            return undefined;
        }
    }
} 