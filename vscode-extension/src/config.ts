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
        
        const backendUrl = config.get<string>('backendUrl') || 'http://localhost:8000';
        const maxRetries = Math.max(1, Math.min(5, config.get<number>('maxRetries') || 3));
        const requestTimeout = Math.max(5000, Math.min(60000, config.get<number>('requestTimeout') || 30000));
        const debugMode = config.get<boolean>('debugMode') || false;

        // Log configuration in debug mode
        if (debugMode) {
            console.log('Cody configuration loaded:', {
                backendUrl,
                maxRetries,
                requestTimeout,
                debugMode
            });
        }

        return {
            backendUrl: backendUrl.replace(/\/$/, ''), // Remove trailing slash
            maxRetries,
            requestTimeout,
            debugMode
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
            const response = await axios.default.get(`${this.config.backendUrl}/health`, {
                timeout: 5000
            });
            
            if (this.config.debugMode) {
                console.log('Backend health check response:', response.data);
            }

            return response.status === 200 && response.data?.status === 'healthy';
        } catch (error) {
            if (this.config.debugMode) {
                console.error('Backend health check failed:', error);
            }
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