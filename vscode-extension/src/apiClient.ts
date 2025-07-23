import axios, { AxiosInstance, AxiosError } from 'axios';
import * as vscode from 'vscode';
import { ConfigManager } from './config';
import { CompletionSuggestion, ApiResponse } from './types';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

export interface CodeEdit {
    file: string;
    newText: string;
}

export interface ChatApiResponse {
    success: boolean;
    data?: {
        response: string;
        codeEdits?: CodeEdit[];
    };
    error?: string;
}

// Cache management
interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
}

class ApiCache {
    private cache = new Map<string, CacheEntry<any>>();
    private readonly maxSize = 100;
    private readonly defaultTTL = 30 * 60 * 1000; // 30 minutes

    get<T>(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    set<T>(key: string, data: T, ttl: number = this.defaultTTL): void {
        // Implement LRU eviction if cache is full
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
    }

    clear(): void {
        this.cache.clear();
    }

    getStats(): { size: number; maxSize: number } {
        return {
            size: this.cache.size,
            maxSize: this.maxSize
        };
    }
}

export class ApiClient {
    private static instance: ApiClient;
    private client: AxiosInstance;
    private configManager: ConfigManager;
    private cache = new ApiCache();
    private requestQueue = new Map<string, Promise<any>>();

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
            },
            // Connection optimization
            maxRedirects: 3,
            maxContentLength: 50 * 1024 * 1024, // 50MB
            maxBodyLength: 50 * 1024 * 1024, // 50MB
        });
    }

    public updateConfiguration(): void {
        this.configManager.updateConfiguration();
        this.client = this.createAxiosInstance();
        this.cache.clear(); // Clear cache when config changes
    }

    private generateCacheKey(...args: any[]): string {
        return JSON.stringify(args);
    }

    private async makeRequest<T>(
        requestFn: () => Promise<any>,
        operation: string,
        cacheKey?: string,
        cacheTTL?: number
    ): Promise<ApiResponse<T>> {
        const config = this.configManager.getConfig();

        // Check cache first
        if (cacheKey) {
            const cachedResult = this.cache.get<ApiResponse<T>>(cacheKey);
            if (cachedResult) {
                if (config.debugMode) {
                    console.log(`Cache hit for ${operation}`);
                }
                return cachedResult;
            }
        }

        // Check if request is already in progress (deduplication)
        const requestKey = `${operation}-${cacheKey || 'no-cache'}`;
        if (this.requestQueue.has(requestKey)) {
            if (config.debugMode) {
                console.log(`Request deduplication for ${operation}`);
            }
            return await this.requestQueue.get(requestKey)!;
        }

        // Check backend connection first
        const isConnected = await this.configManager.checkBackendConnection();
        if (!isConnected) {
            return {
                success: false,
                error: `Cannot connect to Cody backend at ${config.backendUrl}. Please ensure the backend is running.`
            };
        }

        // Create request promise
        const requestPromise = this.executeRequest<T>(requestFn, operation, config);
        this.requestQueue.set(requestKey, requestPromise);

        try {
            const result = await requestPromise;
            
            // Cache successful results
            if (result.success && cacheKey) {
                this.cache.set(cacheKey, result, cacheTTL);
            }
            
            return result;
        } finally {
            this.requestQueue.delete(requestKey);
        }
    }

    private async executeRequest<T>(
        requestFn: () => Promise<any>,
        operation: string,
        config: any
    ): Promise<ApiResponse<T>> {
        let lastError: any;

        // Retry logic
        for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
            try {
                const response = await requestFn();
                
                if (config.debugMode) {
                    console.log(`Cody API ${operation} - Attempt ${attempt} successful:`, response.data);
                }

                // If the backend returns { success: true, data: {...} }, extract the data
                // Otherwise, return the response data as-is
                const backendResponse = response.data;
                if (backendResponse && typeof backendResponse === 'object' && 'success' in backendResponse) {
                    if (backendResponse.success) {
                        return {
                            success: true,
                            data: backendResponse.data
                        };
                    } else {
                        return {
                            success: false,
                            error: backendResponse.error || 'Backend request failed'
                        };
                    }
                } else {
                    return {
                        success: true,
                        data: backendResponse
                    };
                }
            } catch (error: any) {
                lastError = error;
                
                console.error(`Cody API ${operation} - Attempt ${attempt} failed:`, {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    error: error.message
                });

                // Don't retry on certain errors
                if (this.isNonRetryableError(error)) {
                    break;
                }

                // Wait before retrying (exponential backoff)
                if (attempt < config.maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        return {
            success: false,
            error: this.getErrorMessage(lastError)
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

    private getErrorMessage(error: any): string {
        if (error.response) {
            return `HTTP ${error.response.status}: ${error.response.data?.detail || error.response.statusText}`;
        } else if (error.request) {
            return 'Network error: No response received from server';
        } else {
            return `Request error: ${error.message}`;
        }
    }

    public async generateCode(
        prompt: string,
        language: string,
        context: string
    ): Promise<ApiResponse<{ code: string }>> {
        const cacheKey = this.generateCacheKey(prompt, language, context, 'generate');
        return this.makeRequest(
            () => this.client.post('/generate', { prompt, language, context }),
            'Generate Code',
            cacheKey,
            15 * 60 * 1000 // 15 minute cache
        );
    }

    public async chat(
        prompt: string,
        language: string,
        context: string,
        history: ChatMessage[],
        currentFile?: string
    ): Promise<ApiResponse<{ response: string; codeEdits?: CodeEdit[] }>> {
        const payload = {
            prompt,
            language,
            context,
            history,
            includeCodeEdits: true,
            currentFile
        };
        console.log("Chat Request Payload:", JSON.stringify(payload, null, 2));
        
        // Don't cache chat requests with code edits
        return this.makeRequest(
            () => this.client.post('/chat', payload),
            'Chat'
        );
    }

    public async fixBug(
        code: string,
        errorMessage: string,
        language: string
    ): Promise<ApiResponse<{ fixedCode: string }>> {
        const cacheKey = this.generateCacheKey(code, errorMessage, language, 'fix-bug');
        return this.makeRequest(
            () => this.client.post('/fix-bug', { code, errorMessage, language }),
            'Fix Bug',
            cacheKey,
            30 * 60 * 1000 // 30 minute cache
        );
    }

    public async reindexProject(
        projectPath: string
    ): Promise<ApiResponse<{ message: string; output: string }>> {
        // Don't cache reindex requests
        return this.makeRequest(
            () => this.client.post('/reindex', { projectPath }),
            'Reindex Project'
        );
    }

    public async checkHealth(): Promise<ApiResponse<{ status: string }>> {
        // Cache health checks for 1 minute
        const cacheKey = this.generateCacheKey('health');
        return this.makeRequest(
            () => this.client.get('/'),
            'Health Check',
            cacheKey,
            60 * 1000 // 1 minute cache
        );
    }

    public async getCompletions(
        context: string,
        languageId: string,
        linePrefix: string
    ): Promise<CompletionSuggestion[] | undefined> {
        const cacheKey = this.generateCacheKey(context, languageId, linePrefix, 'completions');
        const response = await this.makeRequest<{ data: CompletionSuggestion[] }>(
            () => this.client.post('/completions', {
                context,
                language: languageId,
                prefix: linePrefix
            }),
            'Get Completions',
            cacheKey,
            5 * 60 * 1000 // 5 minute cache
        );

        if (response.success && response.data?.data) {
            return response.data.data;
        }

        if (response.error) {
            console.error('Completion error:', response.error);
        }

        return undefined;
    }

    public getCacheStats(): { size: number; maxSize: number } {
        return this.cache.getStats();
    }

    public clearCache(): void {
        this.cache.clear();
    }
}
