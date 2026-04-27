import type { ChatMessage, SavedChatSession } from '@/types';

const STORAGE_KEY = 'rigguru-sessions-v1';

export type PersistedChatState = {
    version: 1;
    activeSessionId: string;
    sessions: SavedChatSession[];
};

export const WELCOME_MESSAGE: ChatMessage = {
    id: 'welcome',
    role: 'model',
    text: "Welcome to RigGuru Industrial Strategy. \n\nI specialize in technical hardware procurement for Workstations, Enterprise Laptops, and Industrial Mobile Fleets. \n\nTo provide an accurate technical profile, I need to understand your requirements better. For instance:\n1. What is the **primary technical workload** (e.g., Data Science, CAD, Field Documentation, or Office Productivity)?\n2. What is your **deployment environment** (Office, Manufacturing Floor, or Remote Field Sites)?\n3. What is your **approximate scale and budget** per unit?\n\nWhether you need an 8-GPU training server or a fleet of ruggedized smartphones for field engineers, I am ready to assist. What are we looking to procure today?",
    timestamp: Date.now(),
};

function newId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function deriveChatTitle(messages: ChatMessage[]): string {
    const firstUser = messages.find((m) => m.role === 'user');
    if (!firstUser?.text?.trim()) return 'New chat';
    const t = firstUser.text.trim().replace(/\s+/g, ' ');
    return t.length > 48 ? `${t.slice(0, 45)}…` : t;
}

export function createNewSession(): SavedChatSession {
    const now = Date.now();
    return {
        id: newId(),
        title: 'New chat',
        messages: [{ ...WELCOME_MESSAGE, timestamp: now }],
        updatedAt: now,
        pinned: false,
        titleIsCustom: false,
    };
}

/** Plain-text export for Share / clipboard */
export function formatChatForShare(session: SavedChatSession): string {
    const lines: string[] = [`Rig Guru — ${session.title}\n${'='.repeat(40)}\n`];
    for (const m of session.messages) {
        const who = m.role === 'user' ? 'You' : 'RigGuru';
        lines.push(`\n[${who}]\n${m.text}\n`);
    }
    return lines.join('');
}

function normalizeSession(raw: SavedChatSession): SavedChatSession {
    return {
        ...raw,
        pinned: raw.pinned ?? false,
        titleIsCustom: raw.titleIsCustom ?? false,
    };
}

export function loadPersistedState(): PersistedChatState | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw) as PersistedChatState;
        if (data?.version !== 1 || !Array.isArray(data.sessions) || !data.activeSessionId) {
            return null;
        }
        return {
            ...data,
            sessions: data.sessions.map((s) => normalizeSession(s as SavedChatSession)),
        };
    } catch {
        return null;
    }
}

export function savePersistedState(state: PersistedChatState): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        /* quota or private mode */
    }
}

const COLLAPSE_KEY = 'rigguru-sidebar-collapsed';

export function loadSidebarCollapsed(): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(COLLAPSE_KEY) === '1';
}

export function saveSidebarCollapsed(collapsed: boolean): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
}
