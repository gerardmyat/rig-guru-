'use client';

import React, { useState } from 'react';
import { User, ChevronRight, LogOut, Pencil } from 'lucide-react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type { AppTheme } from '@/lib/theme';

type ProfileSectionProps = {
    email: string;
    username: string;
    theme: AppTheme;
    onThemeChange: (theme: AppTheme) => void;
    onUpdateProfile: (payload: { username: string }) => Promise<{ username: string }>;
    isGuest: boolean;
    onLoginRequired: () => void;
    onLogout: () => void;
};

export default function ProfileSection({
    email,
    username,
    theme,
    onThemeChange,
    onUpdateProfile,
    isGuest,
    onLoginRequired,
    onLogout,
}: ProfileSectionProps) {
    const [open, setOpen] = useState(false);
    const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draftUsername, setDraftUsername] = useState(username);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mounted, setMounted] = useState(false);

    React.useEffect(() => {
        setMounted(true);
    }, []);

    const displayLine = username?.trim() || email || 'Account';
    const subLine = email && username?.trim() ? email : 'Signed in';
    const initial = (username?.trim() || email || '?').slice(0, 1).toUpperCase();

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--rg-surface-3)]"
            >
                <div
                    className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                        'bg-gradient-to-br from-indigo-600 to-violet-700 text-sm font-bold text-white'
                    )}
                >
                    {displayLine ? initial : <User className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--rg-text)]">{displayLine}</p>
                    <p className="truncate text-[10px] text-[var(--rg-muted)]">{subLine}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--rg-muted)]" aria-hidden />
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="profile-dialog-title"
                >
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/70"
                        aria-label="Close profile"
                        onClick={() => setOpen(false)}
                    />
                    <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--rg-border)] bg-[var(--rg-surface-1)] p-6 shadow-2xl">
                        <h2 id="profile-dialog-title" className="text-lg font-semibold text-[var(--rg-text)]">
                            Account
                        </h2>
                        <p className="mt-2 text-sm text-[var(--rg-muted)]">
                            {isGuest
                                ? 'You are using guest mode. Chat history is local-only and will not be saved to your account.'
                                : 'You’re signed in. Chats and history are stored on the server for this account.'}
                        </p>

                        <dl className="mt-4 space-y-2 rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-2)] p-4 text-sm">
                            <div>
                                <dt className="text-[10px] font-bold uppercase tracking-widest text-[var(--rg-muted)]">
                                    Username
                                </dt>
                                <dd className="mt-1 text-[var(--rg-text)]">
                                    {editing ? (
                                        <input
                                            value={draftUsername}
                                            onChange={(e) => setDraftUsername(e.target.value)}
                                            className="w-full rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-1)] px-3 py-2 text-sm text-[var(--rg-text)] focus:border-indigo-500 focus:outline-none"
                                            minLength={2}
                                            maxLength={100}
                                        />
                                    ) : (
                                        username || '—'
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-[10px] font-bold uppercase tracking-widest text-[var(--rg-muted)]">Email</dt>
                                <dd className="mt-0.5 break-all text-[var(--rg-text)]">{email || '—'}</dd>
                            </div>
                        </dl>
                        {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}

                        <div className="mt-4 rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-2)] p-4">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--rg-muted)]">
                                Theme
                            </p>
                            <select
                                value={theme}
                                onChange={(e) => onThemeChange(e.target.value as AppTheme)}
                                className="mt-2 w-full rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-1)] px-3 py-2 text-sm text-[var(--rg-text)] focus:outline-none"
                            >
                                <option value="naval-blue">Naval Blue</option>
                                <option value="dark">Dark</option>
                                <option value="white">White</option>
                            </select>
                        </div>

                        <div className="mt-6 flex flex-wrap gap-2">
                            {!editing && !isGuest ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setDraftUsername(username || '');
                                        setError(null);
                                        setEditing(true);
                                    }}
                                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--rg-border)] px-4 py-2 text-sm text-[var(--rg-text)] hover:bg-[var(--rg-surface-3)]"
                                >
                                    <Pencil className="h-4 w-4" />
                                    Edit profile
                                </button>
                            ) : editing ? (
                                <>
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={async () => {
                                            setError(null);
                                            setSaving(true);
                                            try {
                                                const updated = await onUpdateProfile({
                                                    username: draftUsername.trim(),
                                                });
                                                setDraftUsername(updated.username);
                                                setEditing(false);
                                            } catch (e) {
                                                setError(
                                                    e instanceof Error
                                                        ? e.message
                                                        : 'Could not save profile changes'
                                                );
                                            } finally {
                                                setSaving(false);
                                            }
                                        }}
                                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                                    >
                                        {saving ? 'Saving…' : 'Save'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => {
                                            setDraftUsername(username || '');
                                            setError(null);
                                            setEditing(false);
                                        }}
                                        className="rounded-lg border border-[var(--rg-border)] px-4 py-2 text-sm text-[var(--rg-text)] hover:bg-[var(--rg-surface-3)] disabled:opacity-60"
                                    >
                                        Cancel
                                    </button>
                                </>
                            ) : null}
                            {isGuest && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setOpen(false);
                                        onLoginRequired();
                                    }}
                                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                                >
                                    Log in to save chats
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => {
                                    setOpen(false);
                                    setConfirmLogoutOpen(true);
                                }}
                                className="inline-flex items-center gap-2 rounded-lg bg-[var(--rg-danger)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--rg-danger-strong)]"
                            >
                                <LogOut className="h-4 w-4" />
                                Log out
                            </button>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="rounded-lg border border-[var(--rg-border)] px-4 py-2 text-sm text-[var(--rg-text)] hover:bg-[var(--rg-surface-3)]"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {mounted &&
                confirmLogoutOpen &&
                createPortal(
                    <div
                        className="fixed inset-0 z-[110] flex items-center justify-center p-4"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="logout-confirm-title"
                    >
                        <button
                            type="button"
                            className="absolute inset-0 bg-black/55 backdrop-blur-md"
                            aria-label="Close logout confirmation"
                            onClick={() => setConfirmLogoutOpen(false)}
                        />
                        <div className="relative z-10 w-full max-w-sm rounded-3xl border border-[var(--rg-border)] bg-[var(--rg-surface-1)] p-6 text-center shadow-2xl">
                            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/15 text-rose-500">
                                <LogOut className="h-5 w-5" />
                            </div>
                            <h3 id="logout-confirm-title" className="text-2xl font-semibold text-[var(--rg-text)]">
                                Log Out
                            </h3>
                            <p className="mt-2 text-sm text-[var(--rg-muted)]">
                                Are you sure you want to log out?
                            </p>
                            <div className="mt-6 space-y-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setConfirmLogoutOpen(false);
                                        setOpen(false);
                                        onLogout();
                                    }}
                                    className="w-full rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-600"
                                >
                                    Log Out
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmLogoutOpen(false)}
                                    className="w-full rounded-xl border border-[var(--rg-border)] bg-[var(--rg-surface-2)] px-4 py-2.5 text-sm font-medium text-[var(--rg-text)] hover:bg-[var(--rg-surface-3)]"
                                >
                                    Return
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
        </>
    );
}
