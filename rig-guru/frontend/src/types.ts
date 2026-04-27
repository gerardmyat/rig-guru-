export type MessageRole = 'user' | 'model';

export interface GroundingChunk {
    web?: {
        uri?: string;
        url?: string;
        title?: string;
    };
}

export interface ChatMessage {
    id: string;
    role: MessageRole;
    text: string;
    timestamp: number;
    groundingLinks?: GroundingChunk[];
    /** Assistant bubble shown when the API request failed */
    isError?: boolean;
}

export interface Recommendation {
    type: 'pc' | 'laptop';
    budget: number;
    useCase: string;
    aesthetics: string;
    portability?: string;
}

/** One saved conversation (browser localStorage for now). */
export interface SavedChatSession {
    id: string;
    title: string;
    messages: ChatMessage[];
    updatedAt: number;
    /** Pinned chats sort to the top of the list */
    pinned?: boolean;
    /** If true, title is not auto-updated from the first user message */
    titleIsCustom?: boolean;
}
