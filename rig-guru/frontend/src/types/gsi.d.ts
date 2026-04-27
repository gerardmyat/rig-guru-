export {};

declare global {
    interface Window {
        google?: {
            accounts: {
                id: {
                    initialize: (config: {
                        client_id: string;
                        callback: (resp: { credential: string }) => void;
                    }) => void;
                    renderButton: (parent: HTMLElement, config: Record<string, unknown>) => void;
                    prompt: () => void;
                };
            };
        };
    }
}
