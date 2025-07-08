import axios, { AxiosInstance, AxiosError } from 'axios';
import * as vscode from 'vscode';
import { ConfigManager } from './config';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

export interface CodeEdit {
    file: string;
    range: {
        start: { line: number; character: number; };
        end: { line: number; character: number; };
    };
    newText: string;
}

export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export class ApiClient {
    private static instance: ApiClient;
    private client: AxiosInstance;
    private configManager: ConfigManager;

    private constructor() {
        this.configManager = ConfigManager.getInstance();
        this.client = this.createAxiosInstance();
    }

    public static getInstance(): ApiClient {
        if (!ApiClient.instance) {
            ApiClient.instance = new ApiClient();
        }
        return ApiClient.instance;
    }

    private createAxiosInstance(): AxiosInstance {
        const config = this.configManager.getConfig();
        
        return axios.create({
            baseURL: config.backendUrl,
            timeout: config.requestTimeout,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    public updateConfiguration(): void {
        this.configManager.updateConfiguration();
        this.client = this.createAxiosInstance();
    }

    private async makeRequest<T>(
        requestFn: () => Promise<any>,
        operation: string
    ): Promise<ApiResponse<T>> {
        const config = this.configManager.getConfig();
        let lastError: any;

        // Check backend connection first
        const isConnected = await this.configManager.checkBackendConnection();
        if (!isConnected) {
            return {
                success: false,
                error: `Cannot connect to Cody backend at ${config.backendUrl}. Please ensure the backend is running.`
            };
        }

        // Retry logic
        for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
            try {
                const response = await requestFn();
                
                if (config.debugMode) {
                    console.log(`Cody API ${operation} - Attempt ${attempt} successful:`, response.data);
                }

                return {
                    success: true,
                    data: response.data
                };
            } catch (error: any) {
                lastError = error;
                
                if (config.debugMode) {
                    console.error(`Cody API ${operation} - Attempt ${attempt} failed:`, error);
                }

                // Don't retry on certain errors
                if (this.isNonRetryableError(error)) {
                    break;
                }

                // Wait before retrying (exponential backoff)
                if (attempt < config.maxRetries) {
                    await this.sleep(Math.pow(2, attempt) * 1000);
                }
            }
        }

        // All retries failed
        const errorMessage = this.extractErrorMessage(lastError, operation);
        return {
            success: false,
            error: errorMessage
        };
    }

    private isNonRetryableError(error: any): boolean {
        if (error.response) {
            const status = error.response.status;
            // Don't retry on client errors (400-499) except 429 (rate limit)
            return status >= 400 && status < 500 && status !== 429;
        }
        return false;
    }

    private extractErrorMessage(error: any, operation: string): string {
        if (error.response) {
            // Server responded with error status
            if (error.response.data?.error) {
                return `${operation} failed: ${error.response.data.error}`;
            }
            return `${operation} failed: HTTP ${error.response.status} - ${error.response.statusText}`;
        } else if (error.request) {
            // Request was made but no response received
            return `${operation} failed: No response from server. Check if backend is running.`;
        } else {
            // Something else happened
            return `${operation} failed: ${error.message || 'Unknown error'}`;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // API Methods
    public async generateCode(
        prompt: string,
        language: string,
        context: string
    ): Promise<ApiResponse<{ code: string }>> {
        return this.makeRequest(
            () => this.client.post('/generate', { prompt, language, context }),
            'Generate Code'
        );
    }

    public async chat(
        prompt: string,
        language: string,
        context: string,
        history: ChatMessage[],
        currentFile?: string
    ): Promise<ApiResponse<{ response: string; codeEdits?: CodeEdit[] }>> {
        return this.makeRequest(
            () => this.client.post('/chat', {
                prompt,
                language,
                context,
                history,
                includeCodeEdits: true,
                currentFile
            }),
            'Chat'
        );
    }

    public async fixBug(
        code: string,
        errorMessage: string,
        language: string
    ): Promise<ApiResponse<{ fixedCode: string }>> {
        return this.makeRequest(
            () => this.client.post('/fix-bug', { code, errorMessage, language }),
            'Fix Bug'
        );
    }

    public async reindexProject(
        projectPath: string
    ): Promise<ApiResponse<{ message: string; output: string }>> {
        return this.makeRequest(
            () => this.client.post('/reindex', { projectPath }),
            'Reindex Project'
        );
    }

    public async checkHealth(): Promise<ApiResponse<{ status: string }>> {
        return this.makeRequest(
            () => this.client.get('/'),
            'Health Check'
        );
    }
} 