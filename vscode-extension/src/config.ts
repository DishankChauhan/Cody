import * as vscode from 'vscode';

export interface CodyConfiguration {
    backendUrl: string;
    maxRetries: number;
    requestTimeout: number;
    debugMode: boolean;
}

export class ConfigManager {
    private static instance: ConfigManager;
    private config: CodyConfiguration;

    private constructor() {
        this.config = this.loadConfiguration();
    }

    public static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    private loadConfiguration(): CodyConfiguration {
        const config = vscode.workspace.getConfiguration('cody');
        
        return {
            backendUrl: config.get<string>('backendUrl') || 'http://localhost:8000',
            maxRetries: config.get<number>('maxRetries') || 3,
            requestTimeout: config.get<number>('requestTimeout') || 30000, // 30 seconds
            debugMode: config.get<boolean>('debugMode') || false
        };
    }

    public getConfig(): CodyConfiguration {
        return this.config;
    }

    public updateConfiguration(): void {
        this.config = this.loadConfiguration();
    }

    public async checkBackendConnection(): Promise<boolean> {
        try {
            const axios = await import('axios');
            const response = await axios.default.get(`${this.config.backendUrl}/`, {
                timeout: 5000
            });
            return response.status === 200;
        } catch (error) {
            return false;
        }
    }
}

// Configuration change listener
export function registerConfigurationListener(context: vscode.ExtensionContext): void {
    const configManager = ConfigManager.getInstance();
    
    const disposable = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('cody')) {
            configManager.updateConfiguration();
            vscode.window.showInformationMessage('Cody configuration updated');
        }
    });
    
    context.subscriptions.push(disposable);
} 