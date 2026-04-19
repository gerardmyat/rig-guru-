import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    MessageSquare,
    PanelLeftClose,
    Plus,
    MoreHorizontal,
    Pencil,
    Pin,
    PinOff,
    Share2,
    Trash2,
} from 'lucide-react';
import type { SavedChatSession } from '@/types';
import { cn } from '@/lib/utils';
import ProfileSection from '@/components/chat/ProfileSection';
import type { AppTheme } from '@/lib/theme';

interface SidebarProps {
    sessions: SavedChatSession[];
    activeSessionId: string;
    onSelectSession: (id: string) => void;
    onNewChat: () => void;
    onRenameSession: (id: string, title: string) => void;
    onTogglePinSession: (id: string) => void;
    onShareSession: (id: string) => void;
    onDeleteSession: (id: string) => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
    mobileOpen: boolean;
    onMobileClose: () => void;
    profileEmail: string;
    profileUsername: string;
    theme: AppTheme;
    onThemeChange: (theme: AppTheme) => void;
    onUpdateProfile: (payload: { username: string }) => Promise<{ username: string }>;
    isGuest: boolean;
    onLoginRequired: () => void;
    onLogout: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
    sessions,
    activeSessionId,
    onSelectSession,
    onNewChat,
    onRenameSession,
    onTogglePinSession,
    onShareSession,
    onDeleteSession,
    collapsed,
    onToggleCollapse,
    mobileOpen,
    onMobileClose,
    profileEmail,
    profileUsername,
    theme,
    onThemeChange,
    onUpdateProfile,
    isGuest,
    onLoginRequired,
    onLogout,
}) => {
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState('');
    const [logoLoadFailed, setLogoLoadFailed] = useState(false);
    const menuContainerRef = useRef<HTMLDivElement | null>(null);

    const sorted = useMemo(() => {
        const list = [...sessions];
        list.sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return b.updatedAt - a.updatedAt;
        });
        return list;
    }, [sessions]);

    useEffect(() => {
        if (!menuOpenId) return;
        const close = (e: MouseEvent) => {
            if (
                menuContainerRef.current &&
                !menuContainerRef.current.contains(e.target as Node)
            ) {
                setMenuOpenId(null);
            }
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [menuOpenId]);

    const startRename = (s: SavedChatSession) => {
        setMenuOpenId(null);
        setRenamingId(s.id);
        setRenameDraft(s.title || 'New chat');
    };

    const commitRename = (id: string) => {
        const t = renameDraft.trim() || 'New chat';
        onRenameSession(id, t);
        setRenamingId(null);
    };

    return (
        <>
            {mobileOpen && (
                <button
                    type="button"
                    className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:hidden"
                    onClick={onMobileClose}
                    aria-label="Close menu"
                />
            )}
            <aside
                className={cn(
                    'fixed inset-y-0 left-0 z-50 flex h-full w-full max-w-[min(100%,22rem)] flex-col border-r border-[var(--rg-border)] bg-[var(--rg-surface-1)] shadow-xl transition-transform duration-200 ease-out lg:static lg:max-w-none lg:shadow-none',
                    'w-[min(100%,22rem)] lg:w-80',
                    '-translate-x-full lg:translate-x-0',
                    mobileOpen && 'translate-x-0',
                    collapsed && 'lg:hidden'
                )}
            >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--rg-border)] px-4 py-4">
                    <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--rg-surface-2)] shadow-lg shadow-black/20">
                            {!logoLoadFailed ? (
                                <img
                                    src="/rigguru-logo.png"
                                    alt="RigGuru logo"
                                    className="h-full w-full object-cover"
                                    onError={() => setLogoLoadFailed(true)}
                                />
                            ) : (
                                <span className="text-sm font-black tracking-tight text-indigo-300">RG</span>
                            )}
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate text-base font-bold leading-tight text-[var(--rg-text)]">RigGuru</h1>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onToggleCollapse}
                        className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--rg-border)] text-[var(--rg-muted)] transition-colors hover:bg-[var(--rg-surface-3)] hover:text-[var(--rg-text)] lg:flex"
                        title="Minimize sidebar"
                        aria-label="Minimize sidebar"
                    >
                        <PanelLeftClose className="h-4 w-4" />
                    </button>
                </div>

                <div className="shrink-0 p-3">
                    <button
                        type="button"
                        onClick={() => {
                            onNewChat();
                            onMobileClose();
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-2)] py-2.5 text-sm font-medium text-[var(--rg-text)] transition-colors hover:border-indigo-500/50 hover:bg-[var(--rg-surface-3)]"
                    >
                        <Plus className="h-4 w-4" />
                        New chat
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                    <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--rg-muted)]">
                        Chat history
                    </p>
                    <ul className="space-y-0.5">
                        {sorted.map((session) => {
                            const active = session.id === activeSessionId;
                            const menuOpen = menuOpenId === session.id;
                            const renaming = renamingId === session.id;

                            return (
                                <li key={session.id} className="relative">
                                    <div
                                        className={cn(
                                            'group flex items-center gap-0.5 rounded-lg transition-colors',
                                            active ? 'bg-[var(--rg-surface-3)]' : 'hover:bg-[var(--rg-surface-3)]'
                                        )}
                                    >
                                        {renaming ? (
                                            <div className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5">
                                                <input
                                                    autoFocus
                                                    value={renameDraft}
                                                    onChange={(e) => setRenameDraft(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') commitRename(session.id);
                                                        if (e.key === 'Escape') setRenamingId(null);
                                                    }}
                                                    onBlur={() => commitRename(session.id)}
                                                    className="min-w-0 flex-1 rounded border border-indigo-500/50 bg-[var(--rg-bg)] px-2 py-1 text-sm text-[var(--rg-text)] focus:outline-none"
                                                />
                                            </div>
                                        ) : (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => onSelectSession(session.id)}
                                                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm text-[var(--rg-text)]"
                                                >
                                                    {session.pinned ? (
                                                        <Pin className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
                                                    ) : (
                                                        <MessageSquare className="h-4 w-4 shrink-0 text-[var(--rg-muted)]" aria-hidden />
                                                    )}
                                                    <span className="truncate">{session.title || 'New chat'}</span>
                                                </button>
                                                <div
                                                    className="relative shrink-0 pr-1"
                                                    ref={menuOpenId === session.id ? menuContainerRef : null}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setMenuOpenId(menuOpen ? null : session.id);
                                                        }}
                                                        className={cn(
                                                            'flex h-8 w-8 items-center justify-center rounded-md text-[var(--rg-muted)] transition-colors hover:bg-[var(--rg-surface-3)] hover:text-[var(--rg-text)]',
                                                            menuOpen && 'bg-[var(--rg-surface-3)] text-[var(--rg-text)]'
                                                        )}
                                                        aria-expanded={menuOpen}
                                                        aria-label="Chat actions"
                                                    >
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </button>
                                                    {menuOpen && (
                                                        <div className="absolute right-0 top-full z-[70] mt-1 w-44 rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-1)] py-1 shadow-xl">
                                                            <button
                                                                type="button"
                                                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--rg-text)] hover:bg-[var(--rg-surface-3)]"
                                                                onClick={() => startRename(session)}
                                                            >
                                                                <Pencil className="h-3.5 w-3.5" />
                                                                Rename
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--rg-text)] hover:bg-[var(--rg-surface-3)]"
                                                                onClick={() => {
                                                                    onTogglePinSession(session.id);
                                                                    setMenuOpenId(null);
                                                                }}
                                                            >
                                                                {session.pinned ? (
                                                                    <>
                                                                        <PinOff className="h-3.5 w-3.5" />
                                                                        Unpin
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Pin className="h-3.5 w-3.5" />
                                                                        Pin
                                                                    </>
                                                                )}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--rg-text)] hover:bg-[var(--rg-surface-3)]"
                                                                onClick={() => {
                                                                    onShareSession(session.id);
                                                                    setMenuOpenId(null);
                                                                }}
                                                            >
                                                                <Share2 className="h-3.5 w-3.5" />
                                                                Share
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={sessions.length <= 1}
                                                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-500 hover:bg-[var(--rg-surface-3)] disabled:cursor-not-allowed disabled:opacity-40"
                                                                onClick={() => {
                                                                    if (sessions.length <= 1) return;
                                                                    onDeleteSession(session.id);
                                                                    setMenuOpenId(null);
                                                                }}
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                                Delete
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>

                <div className="shrink-0 border-t border-[var(--rg-border)] p-3">
                    <ProfileSection
                        email={profileEmail}
                        username={profileUsername}
                        theme={theme}
                        onThemeChange={onThemeChange}
                        onUpdateProfile={onUpdateProfile}
                        isGuest={isGuest}
                        onLoginRequired={onLoginRequired}
                        onLogout={onLogout}
                    />
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
