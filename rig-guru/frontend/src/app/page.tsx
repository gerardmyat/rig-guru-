'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, X, Loader2, PanelLeft, Plus, FileText } from 'lucide-react';
import Sidebar from '@/components/chat/Sidebar';
import ChatMessage from '@/components/chat/ChatMessage';
import { apiFetch } from '@/lib/apiClient';
import { cn } from '@/lib/utils';
import { clearAuth, setSessionUser } from '@/lib/authStorage';
import { formatChatForShare, loadSidebarCollapsed, saveSidebarCollapsed, WELCOME_MESSAGE } from '@/lib/chatStorage';
import { applyTheme, loadTheme, saveTheme, type AppTheme } from '@/lib/theme';
import type { ChatMessage as ChatMessageType, GroundingChunk, SavedChatSession } from '@/types';

type ChatApiResponse = {
    text?: string;
    groundingChunks?: GroundingChunk[];
};

type ApiConversation = {
    conversation_id: number;
    title: string;
    pinned: boolean;
    title_is_custom: boolean;
    updated_at: string;
};

type ApiMessage = {
    id: string;
    role: string;
    text: string;
    timestamp: number;
};

const MAX_ATTACHMENTS = 6;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS_PER_FILE = 2200;
const GUEST_MODE_KEY = 'rigguru-guest-mode';

function fileKey(file: File): string {
    return `${file.name}__${file.size}__${file.lastModified}`;
}

function isLikelyTextFile(file: File): boolean {
    const name = file.name.toLowerCase();
    if (file.type.startsWith('text/')) return true;
    if (file.type.includes('json') || file.type.includes('xml')) return true;
    return /\.(txt|md|csv|json|xml|yaml|yml|log|ini|cfg|py|js|ts|tsx|jsx|html|css|sql)$/i.test(name);
}

function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
        reader.readAsText(file);
    });
}

async function buildAttachmentContext(files: File[]): Promise<string> {
    const lines: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        lines.push(`Attachment ${i + 1}: ${file.name} (${Math.ceil(file.size / 1024)} KB)`);
        if (!isLikelyTextFile(file)) {
            lines.push('Preview: non-text/binary file attached. Use filename metadata only.');
            lines.push('');
            continue;
        }
        try {
            const raw = await readFileAsText(file);
            const cleaned = raw.replace(/\u0000/g, '').trim();
            const preview =
                cleaned.length > MAX_TEXT_CHARS_PER_FILE
                    ? `${cleaned.slice(0, MAX_TEXT_CHARS_PER_FILE)}\n...[truncated]`
                    : cleaned;
            lines.push('Preview:');
            lines.push(preview || '[empty file]');
        } catch {
            lines.push('Preview: [read failed]');
        }
        lines.push('');
    }
    return lines.join('\n').trim();
}

async function parseApiError(response: Response): Promise<string> {
    try {
        const j = (await response.json()) as { detail?: unknown };
        if (typeof j.detail === 'string') return j.detail;
        if (Array.isArray(j.detail)) {
            return j.detail
                .map((d: { msg?: string }) => d?.msg)
                .filter(Boolean)
                .join('; ');
        }
    } catch {
        /* ignore */
    }
    return response.statusText || `HTTP ${response.status}`;
}

function convToSession(c: ApiConversation): SavedChatSession {
    return {
        id: String(c.conversation_id),
        title: c.title,
        pinned: c.pinned,
        titleIsCustom: c.title_is_custom,
        updatedAt: Date.parse(c.updated_at) || Date.now(),
        messages: [],
    };
}

function mapApiMessages(rows: ApiMessage[]): ChatMessageType[] {
    return rows.map((m) => ({
        id: m.id,
        role: m.role === 'user' ? 'user' : 'model',
        text: m.text,
        timestamp: m.timestamp,
    }));
}

function loadGuestMode(): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(GUEST_MODE_KEY) === '1';
}

function saveGuestMode(enabled: boolean): void {
    if (typeof window === 'undefined') return;
    if (enabled) window.localStorage.setItem(GUEST_MODE_KEY, '1');
    else window.localStorage.removeItem(GUEST_MODE_KEY);
}

export default function Home() {
    const router = useRouter();
    const [authUser, setAuthUser] = useState<{ user_id: number; email: string; username: string } | null>(null);
    const [sessions, setSessions] = useState<SavedChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState('');
    const [bootstrapped, setBootstrapped] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [theme, setTheme] = useState<AppTheme>('white');
    const [toast, setToast] = useState<string | null>(null);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);

    const chatContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const lastFailedUserTextRef = useRef<string | null>(null);
    const activeSessionIdRef = useRef('');
    activeSessionIdRef.current = activeSessionId;

    const messages = useMemo(() => {
        const s = sessions.find((x) => x.id === activeSessionId);
        if (s?.messages?.length) return s.messages;
        return [{ ...WELCOME_MESSAGE, timestamp: Date.now() }];
    }, [sessions, activeSessionId]);
    const isGuest = authUser?.user_id === 0;

    const reloadMessages = useCallback(async (convId: string) => {
        const r = await apiFetch(`/api/conversations/${convId}/messages`);
        if (!r.ok) return;
        const rows = (await r.json()) as ApiMessage[];
        const mapped = mapApiMessages(rows);
        setSessions((prev) =>
            prev.map((s) => (s.id === convId ? { ...s, messages: mapped } : s))
        );
    }, []);

    const refreshConversationList = useCallback(async () => {
        const r = await apiFetch('/api/conversations');
        if (!r.ok) return;
        const list = (await r.json()) as ApiConversation[];
        setSessions((prev) => {
            const msgById = new Map(prev.map((s) => [s.id, s.messages]));
            return list.map((c) => {
                const id = String(c.conversation_id);
                const old = prev.find((p) => p.id === id);
                return {
                    ...convToSession(c),
                    messages: old?.messages ?? msgById.get(id) ?? [],
                };
            });
        });
    }, []);

    useEffect(() => {
        const stored = loadTheme();
        setTheme(stored);
        applyTheme(stored);
    }, []);

    useEffect(() => {
        applyTheme(theme);
        saveTheme(theme);
    }, [theme]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const me = await apiFetch('/api/auth/me');
            if (!me.ok) {
                if (loadGuestMode()) {
                    if (cancelled) return;
                    setAuthUser({
                        user_id: 0,
                        email: '',
                        username: 'Guest user',
                    });
                    const guestSession: SavedChatSession = {
                        id: 'guest-1',
                        title: 'Guest chat',
                        pinned: false,
                        titleIsCustom: true,
                        updatedAt: Date.now(),
                        messages: [],
                    };
                    setSessions([guestSession]);
                    setActiveSessionId(guestSession.id);
                    setSidebarCollapsed(loadSidebarCollapsed());
                    setBootstrapped(true);
                    return;
                }
                router.replace('/login');
                return;
            }
            const u = (await me.json()) as { user_id: number; email: string; username: string };
            if (cancelled) return;
            saveGuestMode(false);
            setAuthUser(u);

            let convRes = await apiFetch('/api/conversations');
            if (!convRes.ok) {
                setBootstrapped(true);
                return;
            }
            let list = (await convRes.json()) as ApiConversation[];
            if (list.length === 0) {
                const create = await apiFetch('/api/conversations', {
                    method: 'POST',
                    body: JSON.stringify({ title: 'New chat' }),
                });
                if (create.ok) {
                    list = [await create.json()];
                }
            }
            if (cancelled) return;
            const mapped = list.map(convToSession);
            setSessions(mapped);
            if (mapped.length) {
                setActiveSessionId(mapped[0].id);
                await reloadMessages(mapped[0].id);
            }
            setSidebarCollapsed(loadSidebarCollapsed());
            setBootstrapped(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [router, reloadMessages]);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTo({
                top: chatContainerRef.current.scrollHeight,
                behavior: 'smooth',
            });
        }
    }, [messages, isLoading]);

    const adjustTextareaHeight = useCallback(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }, []);

    useEffect(() => {
        adjustTextareaHeight();
    }, [inputValue, adjustTextareaHeight]);

    const sendChat = useCallback(
        async (textToSend: string, filesForMessage: File[] = []) => {
            const trimmed = textToSend.trim();
            const hasFiles = filesForMessage.length > 0;
            if ((!trimmed && !hasFiles) || isLoading || !activeSessionIdRef.current) return;
            const currentConvId = activeSessionIdRef.current;
            const sentAt = Date.now();
            const displayUserMessage =
                trimmed ||
                `Attached ${filesForMessage.length} file${filesForMessage.length > 1 ? 's' : ''}: ${filesForMessage
                    .map((f) => f.name)
                    .join(', ')}`;

            let composedMessage = trimmed || 'Please review the attached files.';

            setInputValue('');
            if (hasFiles) setPendingFiles([]);
            setIsLoading(true);
            lastFailedUserTextRef.current = composedMessage;
            setSessions((prev) =>
                prev.map((s) =>
                    s.id === currentConvId
                        ? {
                              ...s,
                              messages: [
                                  ...s.messages,
                                  {
                                      id: `tmp-user-${sentAt}`,
                                      role: 'user',
                                      text: displayUserMessage,
                                      timestamp: sentAt,
                                  },
                              ],
                          }
                        : s
                )
            );

            if (hasFiles) {
                const attachmentCtx = await buildAttachmentContext(filesForMessage);
                composedMessage = `${composedMessage}\n\nAttached files:\n${filesForMessage
                    .map((f) => `- ${f.name}`)
                    .join('\n')}`;
                if (attachmentCtx) {
                    composedMessage = `${composedMessage}\n\nAttachment previews:\n${attachmentCtx}`;
                }
            }
            lastFailedUserTextRef.current = composedMessage;

            try {
                let response: Response;
                if (isGuest) {
                    const s = sessions.find((x) => x.id === currentConvId);
                    const guestContext = (s?.messages || [])
                        .slice(-12)
                        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
                        .join('\n');
                    response = await apiFetch('/api/chat/guest', {
                        method: 'POST',
                        body: JSON.stringify({
                            message: composedMessage,
                            conversation_context: guestContext,
                        }),
                    });
                } else {
                    response = await apiFetch('/api/chat', {
                        method: 'POST',
                        body: JSON.stringify({
                            message: composedMessage,
                            conversation_id: parseInt(currentConvId, 10),
                        }),
                    });
                }

                if (!response.ok) {
                    const detail = await parseApiError(response);
                    throw new Error(detail);
                }

                const data = (await response.json()) as ChatApiResponse;
                lastFailedUserTextRef.current = null;

                if (data.groundingChunks) {
                    /* reserved */
                }

                if (isGuest) {
                    const modelMsg: ChatMessageType = {
                        id: `guest-model-${Date.now()}`,
                        role: 'model',
                        text: data.text || '',
                        timestamp: Date.now(),
                    };
                    setSessions((prev) =>
                        prev.map((s) =>
                            s.id === currentConvId
                                ? {
                                      ...s,
                                      updatedAt: Date.now(),
                                      messages: [...s.messages, modelMsg],
                                  }
                                : s
                        )
                    );
                } else {
                    await reloadMessages(currentConvId);
                    await refreshConversationList();
                }
            } catch (err) {
                console.error(err);
                const message =
                    err instanceof Error ? err.message : 'Request failed. Is the backend running on port 8000?';
                const errorMsg: ChatMessageType = {
                    id: `err-${Date.now()}`,
                    role: 'model',
                    text: `${message}\n\nTip: ensure you are logged in and the API is running.`,
                    timestamp: Date.now(),
                    isError: true,
                };
                setSessions((prev) =>
                    prev.map((s) =>
                        s.id === currentConvId
                            ? { ...s, messages: [...s.messages, errorMsg] }
                            : s
                    )
                );
            } finally {
                setIsLoading(false);
            }
        },
        [isLoading, isGuest, reloadMessages, refreshConversationList, sessions]
    );

    const handleRetry = useCallback(() => {
        const t = lastFailedUserTextRef.current;
        if (!t) return;
        setSessions((prev) =>
            prev.map((s) => {
                if (s.id !== activeSessionIdRef.current) return s;
                const m = s.messages;
                if (m.length && m[m.length - 1]?.isError) {
                    return { ...s, messages: m.slice(0, -1) };
                }
                return s;
            })
        );
        void sendChat(t, []);
    }, [sendChat]);

    const handlePickFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (!selected.length) return;

        const current = pendingFiles;
        const seen = new Set(current.map((f) => fileKey(f)));
        const next: File[] = [...current];
        let skipped = 0;

        for (const file of selected) {
            if (next.length >= MAX_ATTACHMENTS) {
                skipped += 1;
                continue;
            }
            if (file.size > MAX_FILE_SIZE_BYTES) {
                skipped += 1;
                continue;
            }
            const key = fileKey(file);
            if (seen.has(key)) {
                skipped += 1;
                continue;
            }
            seen.add(key);
            next.push(file);
        }

        setPendingFiles(next);
        if (skipped > 0) {
            setToast(`Some files were skipped (limit: ${MAX_ATTACHMENTS}, max size: 2MB each).`);
            window.setTimeout(() => setToast(null), 2800);
        }
    }, [pendingFiles]);

    const removePendingFile = useCallback((key: string) => {
        setPendingFiles((prev) => prev.filter((f) => fileKey(f) !== key));
    }, []);

    const newChat = useCallback(async () => {
        if (isGuest) {
            const s: SavedChatSession = {
                id: `guest-${Date.now()}`,
                title: 'Guest chat',
                pinned: false,
                titleIsCustom: true,
                updatedAt: Date.now(),
                messages: [],
            };
            setSessions((prev) => [s, ...prev]);
            setActiveSessionId(s.id);
            lastFailedUserTextRef.current = null;
            return;
        }
        const r = await apiFetch('/api/conversations', {
            method: 'POST',
            body: JSON.stringify({ title: 'New chat' }),
        });
        if (!r.ok) return;
        const c = (await r.json()) as ApiConversation;
        const s = convToSession(c);
        setSessions((prev) => [s, ...prev]);
        setActiveSessionId(s.id);
        lastFailedUserTextRef.current = null;
    }, [isGuest]);

    const selectSession = useCallback(
        async (id: string) => {
            if (id === activeSessionId) {
                setMobileMenuOpen(false);
                return;
            }
            setActiveSessionId(id);
            lastFailedUserTextRef.current = null;
            setMobileMenuOpen(false);
            if (!isGuest) {
                await reloadMessages(id);
            }
        },
        [activeSessionId, isGuest, reloadMessages]
    );

    const deleteSession = useCallback(
        async (id: string) => {
            if (isGuest) {
                setSessions((prev) => {
                    const next = prev.filter((s) => s.id !== id);
                    if (next.length === 0) {
                        return [
                            {
                                id: `guest-${Date.now()}`,
                                title: 'Guest chat',
                                pinned: false,
                                titleIsCustom: true,
                                updatedAt: Date.now(),
                                messages: [],
                            },
                        ];
                    }
                    return next;
                });
                if (activeSessionIdRef.current === id) {
                    setActiveSessionId((prev) => {
                        if (prev !== id) return prev;
                        const fallback = sessions.find((s) => s.id !== id)?.id;
                        return fallback || `guest-${Date.now()}`;
                    });
                }
                return;
            }
            const r = await apiFetch(`/api/conversations/${id}`, { method: 'DELETE' });
            if (!r.ok) return;
            const wasActive = activeSessionIdRef.current === id;
            const listRes = await apiFetch('/api/conversations');
            if (!listRes.ok) return;
            const list = (await listRes.json()) as ApiConversation[];
            setSessions((prev) => {
                const msgById = new Map(prev.map((s) => [s.id, s.messages]));
                return list.map((c) => {
                    const cid = String(c.conversation_id);
                    const old = prev.find((p) => p.id === cid);
                    return {
                        ...convToSession(c),
                        messages: old?.messages ?? msgById.get(cid) ?? [],
                    };
                });
            });
            if (wasActive && list.length) {
                const firstId = String(list[0].conversation_id);
                setActiveSessionId(firstId);
                void reloadMessages(firstId);
            }
        },
        [isGuest, reloadMessages, sessions]
    );

    const renameSession = useCallback(async (id: string, title: string) => {
        const t = title.trim() || 'New chat';
        if (isGuest) {
            setSessions((prev) =>
                prev.map((s) =>
                    s.id === id ? { ...s, title: t, titleIsCustom: true, updatedAt: Date.now() } : s
                )
            );
            return;
        }
        const r = await apiFetch(`/api/conversations/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ title: t, title_is_custom: true }),
        });
        if (r.ok) await refreshConversationList();
    }, [isGuest, refreshConversationList]);

    const togglePinSession = useCallback(
        async (id: string) => {
            const s = sessions.find((x) => x.id === id);
            if (!s) return;
            if (isGuest) {
                setSessions((prev) =>
                    prev.map((row) =>
                        row.id === id ? { ...row, pinned: !row.pinned, updatedAt: Date.now() } : row
                    )
                );
                return;
            }
            const r = await apiFetch(`/api/conversations/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ pinned: !s.pinned }),
            });
            if (r.ok) await refreshConversationList();
        },
        [isGuest, sessions, refreshConversationList]
    );

    const handleShareSession = useCallback(
        async (id: string) => {
            const s = sessions.find((x) => x.id === id);
            if (!s) return;
            const sessionForShare: SavedChatSession = {
                ...s,
                messages: s.messages.length ? s.messages : [{ ...WELCOME_MESSAGE, timestamp: Date.now() }],
            };
            try {
                await navigator.clipboard.writeText(formatChatForShare(sessionForShare));
                setToast('Chat copied to clipboard');
            } catch {
                setToast('Could not copy — check browser permissions');
            }
            window.setTimeout(() => setToast(null), 2800);
        },
        [sessions]
    );

    const toggleSidebarCollapse = useCallback(() => {
        setSidebarCollapsed((c) => {
            const next = !c;
            saveSidebarCollapsed(next);
            return next;
        });
    }, []);

    const handleLogout = useCallback(async () => {
        if (isGuest) {
            saveGuestMode(false);
            clearAuth();
            router.replace('/login');
            return;
        }
        await apiFetch('/api/auth/logout', { method: 'POST' });
        clearAuth();
        router.replace('/login');
    }, [isGuest, router]);

    const handleThemeChange = useCallback((nextTheme: AppTheme) => {
        setTheme(nextTheme);
    }, []);

    const handleUpdateProfile = useCallback(
        async (payload: { username: string }) => {
            if (isGuest) {
                throw new Error('Guest mode cannot update profile. Please log in first.');
            }
            const nextUsername = payload.username.trim();
            if (nextUsername.length < 2) {
                throw new Error('Username must be at least 2 characters');
            }
            const response = await apiFetch('/api/auth/me', {
                method: 'PATCH',
                body: JSON.stringify({ username: nextUsername }),
            });
            if (!response.ok) {
                throw new Error(await parseApiError(response));
            }
            const data = (await response.json()) as {
                user_id: number;
                email: string;
                username: string;
            };
            setAuthUser(data);
            setSessionUser({
                userId: data.user_id,
                email: data.email,
                username: data.username,
            });
            setToast('Profile updated');
            window.setTimeout(() => setToast(null), 2200);
            return { username: data.username };
        },
        [isGuest]
    );

    const handleLoginRequired = useCallback(() => {
        saveGuestMode(false);
        clearAuth();
        router.replace('/login');
    }, [router]);

    const lastMessage = messages[messages.length - 1];
    const showRetry =
        lastMessage?.isError && !isLoading && lastFailedUserTextRef.current !== null;

    if (!bootstrapped || !authUser) {
        return (
            <div className="flex h-screen items-center justify-center bg-[var(--rg-bg)] text-[var(--rg-muted)]">
                <Loader2 className="h-8 w-8 animate-spin" aria-label="Loading" />
            </div>
        );
    }

    return (
        <div className="flex h-screen flex-col bg-[var(--rg-bg)] font-sans text-[var(--rg-text)] selection:bg-indigo-500/30 lg:flex-row">
            {toast && (
                <div
                    className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-1)] px-4 py-2 text-sm text-[var(--rg-text)] shadow-xl"
                    role="status"
                >
                    {toast}
                </div>
            )}
            <Sidebar
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelectSession={(id) => void selectSession(id)}
                onNewChat={() => void newChat()}
                onRenameSession={renameSession}
                onTogglePinSession={(id) => void togglePinSession(id)}
                onShareSession={(id) => void handleShareSession(id)}
                onDeleteSession={(id) => void deleteSession(id)}
                collapsed={sidebarCollapsed}
                onToggleCollapse={toggleSidebarCollapse}
                mobileOpen={mobileMenuOpen}
                onMobileClose={() => setMobileMenuOpen(false)}
                profileEmail={authUser.email}
                profileUsername={authUser.username}
                theme={theme}
                onThemeChange={handleThemeChange}
                onUpdateProfile={handleUpdateProfile}
                isGuest={isGuest}
                onLoginRequired={handleLoginRequired}
                onLogout={handleLogout}
            />

            <main className="relative flex flex-1 flex-col overflow-hidden">
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--rg-border)] bg-[var(--rg-surface-1)]/80 px-4 py-3 md:px-8">
                    <div className="flex min-w-0 items-center gap-2">
                        {sidebarCollapsed && (
                            <button
                                type="button"
                                onClick={toggleSidebarCollapse}
                                className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-2)] text-[var(--rg-text)] lg:flex"
                                title="Show chats"
                                aria-label="Show chat history"
                            >
                                <PanelLeft className="h-5 w-5" />
                            </button>
                        )}
                        <button
                            type="button"
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-2)] text-[var(--rg-text)] lg:hidden"
                            onClick={() => setMobileMenuOpen((o) => !o)}
                            aria-expanded={mobileMenuOpen}
                            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
                        >
                            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                        </button>
                        <div className="truncate text-sm font-semibold text-[var(--rg-text)]">RigGuru Chat</div>
                    </div>
                    <div />
                </header>

                <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 md:p-10">
                    <div className="mx-auto max-w-5xl space-y-6 pb-24">
                        {messages.map((msg, idx) => (
                            <div key={msg.id}>
                                <ChatMessage message={msg} />
                                {msg.isError &&
                                    idx === messages.length - 1 &&
                                    showRetry &&
                                    lastFailedUserTextRef.current && (
                                        <div className="-mt-2 mb-6 flex justify-start pl-1">
                                            <button
                                                type="button"
                                                onClick={handleRetry}
                                                className="rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-2)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--rg-text)] transition-colors hover:border-indigo-500 hover:bg-[var(--rg-surface-3)]"
                                            >
                                                Retry last message
                                            </button>
                                        </div>
                                    )}
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="flex items-center gap-4 rounded-xl border border-[var(--rg-border)] bg-[var(--rg-surface-1)] p-4">
                                    <div className="flex space-x-1">
                                        <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500" />
                                        <div
                                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500"
                                            style={{ animationDelay: '0.15s' }}
                                        />
                                        <div
                                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500"
                                            style={{ animationDelay: '0.3s' }}
                                        />
                                    </div>
                                    <span className="text-xs font-mono uppercase tracking-wide text-[var(--rg-muted)]">
                                        Guru is loading...
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="border-t border-[var(--rg-border)] bg-[var(--rg-surface-1)]/70 p-4 backdrop-blur-sm md:p-8">
                    <div className="mx-auto max-w-5xl">
                        <div className="group relative">
                            <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-indigo-500/20 to-blue-500/20 opacity-30 blur transition duration-500 group-focus-within:opacity-100" />
                            <div className="rg-composer relative flex flex-col gap-2 rounded-2xl border border-[var(--rg-border)] bg-[var(--rg-surface-1)] shadow-2xl focus-within:border-indigo-500">
                                <textarea
                                    ref={textareaRef}
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            if (!isLoading && (inputValue.trim() || pendingFiles.length > 0)) {
                                                void sendChat(inputValue, pendingFiles);
                                            }
                                        }
                                    }}
                                    placeholder="Ask about workstations, laptops, or mobile fleets… (Shift+Enter for new line)"
                                    rows={1}
                                    className="max-h-[200px] min-h-[52px] w-full resize-none rounded-xl bg-transparent px-4 py-3 pr-4 text-sm text-[var(--rg-text)] placeholder:text-[var(--rg-muted)] focus:outline-none md:px-6 md:py-4"
                                    disabled={isLoading}
                                />
                                {pendingFiles.length > 0 && (
                                    <div className="flex flex-wrap gap-2 px-3 pb-0 pt-2 md:px-6">
                                        {pendingFiles.map((f) => (
                                            <span
                                                key={fileKey(f)}
                                                className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--rg-border)] bg-[var(--rg-surface-2)] px-2.5 py-1 text-xs text-[var(--rg-text)]"
                                            >
                                                <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--rg-muted)]" />
                                                <span className="max-w-[12rem] truncate">{f.name}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => removePendingFile(fileKey(f))}
                                                    className="rounded p-0.5 text-[var(--rg-muted)] hover:bg-[var(--rg-surface-3)] hover:text-[var(--rg-text)]"
                                                    aria-label={`Remove ${f.name}`}
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div className="flex items-center justify-between px-3 pb-2 pt-1">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        multiple
                                        onChange={handlePickFiles}
                                        className="hidden"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isLoading}
                                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-2)] px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--rg-text)] transition-colors hover:bg-[var(--rg-surface-3)] disabled:cursor-not-allowed disabled:opacity-60"
                                        title="Add files"
                                        aria-label="Add files"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Files
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void sendChat(inputValue, pendingFiles)}
                                        disabled={isLoading || (!inputValue.trim() && pendingFiles.length === 0)}
                                        className={cn(
                                            'rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all',
                                            isLoading || (!inputValue.trim() && pendingFiles.length === 0)
                                                ? 'cursor-not-allowed bg-[var(--rg-surface-3)] text-[var(--rg-muted)]'
                                                : 'bg-indigo-600 text-white hover:bg-indigo-500'
                                        )}
                                    >
                                        Send
                                    </button>
                                </div>
                            </div>
                        </div>
                        <p className="mt-3 text-center text-[10px] text-[var(--rg-muted)] md:text-left">
                            Chats are saved in your account on the server. Rig Guru uses your backend + Gemini; RAG on
                            hardware-style questions.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}
