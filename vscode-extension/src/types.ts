export interface CompletionSuggestion {
    text: string;
    explanation?: string;
    replaceRange?: {
        start: number;
        end: number;
    };
}

export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
} 