'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { apiUrl } from '@/lib/api';
import { clearAuth, setSessionUser } from '@/lib/authStorage';
import { cn } from '@/lib/utils';
import { applyTheme, loadTheme, saveTheme, type AppTheme } from '@/lib/theme';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const GUEST_MODE_KEY = 'rigguru-guest-mode';

type Mode = 'login' | 'register';

function GoogleBrandIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="#EA4335"
                d="M12 10.2v3.9h5.4c-.2 1.2-.9 2.2-1.9 2.9l3.1 2.4c1.8-1.7 2.9-4.1 2.9-7 0-.7-.1-1.4-.2-2.1H12z"
            />
            <path
                fill="#34A853"
                d="M12 22c2.6 0 4.9-.9 6.6-2.5l-3.1-2.4c-.9.6-2 1-3.5 1-2.7 0-5-1.8-5.8-4.3l-3.2 2.4C4.7 19.7 8.1 22 12 22z"
            />
            <path
                fill="#4A90E2"
                d="M6.2 13.8c-.2-.6-.4-1.2-.4-1.8s.1-1.3.4-1.8L3 7.8C2.4 9 2 10.4 2 12s.4 3 1 4.2l3.2-2.4z"
            />
            <path
                fill="#FBBC05"
                d="M12 5.9c1.4 0 2.7.5 3.8 1.5l2.8-2.8C16.8 3 14.5 2 12 2 8.1 2 4.7 4.3 3 7.8l3.2 2.4c.8-2.5 3.1-4.3 5.8-4.3z"
            />
        </svg>
    );
}

function AppleBrandIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M16.84 12.23c.02 2.23 1.96 2.97 1.98 2.98-.01.05-.31 1.08-1.02 2.14-.61.92-1.24 1.83-2.24 1.85-.98.02-1.3-.58-2.42-.58-1.13 0-1.48.56-2.41.6-.96.04-1.69-.97-2.31-1.88-1.27-1.84-2.24-5.2-.94-7.46.65-1.13 1.81-1.85 3.08-1.87.96-.02 1.86.64 2.42.64.56 0 1.61-.79 2.72-.68.46.02 1.75.19 2.58 1.4-.07.05-1.54.9-1.52 2.86zM15.86 5.4c.5-.6.84-1.44.75-2.28-.72.03-1.59.48-2.11 1.08-.46.52-.87 1.37-.76 2.18.8.06 1.62-.41 2.12-.98z" />
        </svg>
    );
}

/** FastAPI returns `detail` as a string, or a list of `{ msg?: string }` for 422 validation. */
async function parseFastApiError(response: Response, fallback: string): Promise<string> {
    const raw = await response.text();
    let j: { detail?: unknown } | null = null;
    try {
        j = JSON.parse(raw) as { detail?: unknown };
    } catch {
        j = null;
    }
    if (j && typeof j.detail === 'string') {
        if (response.status === 404 && j.detail === 'Not Found') {
            return (
                'Not found — the browser called a URL this API does not serve. ' +
                'Set NEXT_PUBLIC_API_URL to the API root (e.g. http://localhost:8000) with no /api suffix, restart `npm run dev`, ' +
                'and confirm the backend is this Rig Guru app (open /docs → you should see POST /api/auth/register).'
            );
        }
        return j.detail;
    }
    if (j && Array.isArray(j.detail)) {
        const parts = j.detail
            .map((d: { msg?: string; type?: string }) => d?.msg)
            .filter(Boolean) as string[];
        if (parts.length) return parts.join('; ');
    }
    if (response.status === 0 || response.status >= 500) {
        const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 220);
        if (snippet && !snippet.startsWith('<') && snippet.length > 3) {
            return `${fallback}. Server said: ${snippet}`;
        }
        return `${fallback} (HTTP ${response.status} — open the API terminal for the Python traceback; often PostgreSQL not running, wrong DATABASE_URL, or DB missing columns).`;
    }
    return fallback || response.statusText || `HTTP ${response.status}`;
}

export default function LoginPage() {
    const router = useRouter();
    const [mode, setMode] = useState<Mode>('login');
    const [theme, setTheme] = useState<AppTheme>('white');
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [gsiReady, setGsiReady] = useState(false);
    const [logoLoadFailed, setLogoLoadFailed] = useState(false);
    const googleBtnRef = useRef<HTMLDivElement>(null);
    const setGuestMode = (enabled: boolean) => {
        if (enabled) window.localStorage.setItem(GUEST_MODE_KEY, '1');
        else window.localStorage.removeItem(GUEST_MODE_KEY);
    };

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
        (async () => {
            try {
                const r = await fetch(apiUrl('/api/auth/me'), { credentials: 'include' });
                if (r.ok) router.replace('/');
            } catch {
                /* stay on login */
            }
        })();
    }, [router]);

    const handleGoogleCredential = useCallback(
        async (credential: string) => {
            setError(null);
            setLoading(true);
            try {
                const res = await fetch(apiUrl('/api/auth/google'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ id_token: credential }),
                });
                if (!res.ok) {
                    throw new Error(await parseFastApiError(res, 'Google sign-in failed'));
                }
                const data = (await res.json()) as {
                    user_id: number;
                    email: string;
                    username: string;
                };
                setSessionUser({
                    userId: data.user_id,
                    email: data.email,
                    username: data.username,
                });
                setGuestMode(false);
                router.replace('/');
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Google sign-in failed');
            } finally {
                setLoading(false);
            }
        },
        [router]
    );

    useEffect(() => {
        if (!gsiReady || !GOOGLE_CLIENT_ID || !googleBtnRef.current || !window.google) return;
        try {
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: (resp) => {
                    if (resp.credential) void handleGoogleCredential(resp.credential);
                },
            });
            googleBtnRef.current.innerHTML = '';
            window.google.accounts.id.renderButton(googleBtnRef.current, {
                theme: 'filled_blue',
                size: 'large',
                width: 320,
                text: 'continue_with',
            });
        } catch {
            setError('Could not load Google button');
        }
    }, [gsiReady, handleGoogleCredential]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            if (mode === 'register') {
                if (password.length < 8) {
                    setError('Password must be at least 8 characters');
                    setLoading(false);
                    return;
                }
                const res = await fetch(apiUrl('/api/auth/register'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ email, username, password }),
                });
                if (!res.ok) {
                    throw new Error(
                        await parseFastApiError(res, 'Could not create account')
                    );
                }
                const data = (await res.json()) as {
                    user_id: number;
                    email: string;
                    username: string;
                };
                setSessionUser({
                    userId: data.user_id,
                    email: data.email,
                    username: data.username,
                });
                setGuestMode(false);
            } else {
                const res = await fetch(apiUrl('/api/auth/login'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ email, password }),
                });
                if (!res.ok) {
                    throw new Error(await parseFastApiError(res, 'Invalid email or password'));
                }
                const data = (await res.json()) as {
                    user_id: number;
                    email: string;
                    username: string;
                };
                setSessionUser({
                    userId: data.user_id,
                    email: data.email,
                    username: data.username,
                });
                setGuestMode(false);
            }
            router.replace('/');
        } catch (err) {
            const msg =
                err instanceof TypeError && err.message === 'Failed to fetch'
                    ? [
                          `Browser could not complete a request to ${apiUrl('')}.`,
                          '1) Confirm the API is running (open /docs in a tab).',
                          "2) If /docs works but this still fails, it is often CORS: use the same host for UI and API (both localhost or both 127.0.0.1), or restart the API after updating backend CORS.",
                          '3) If you set NEXT_PUBLIC_API_URL, try removing it — the app defaults to a same-origin proxy (no CORS). For another API port, set BACKEND_INTERNAL_URL (e.g. http://127.0.0.1:8001) and restart `npm run dev`.',
                          '4) Press F12 → Console / Network on "Create account" to see the real error.',
                      ].join(' ')
                    : err instanceof Error
                      ? err.message
                      : 'Something went wrong';
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            {GOOGLE_CLIENT_ID ? (
                <Script
                    src="https://accounts.google.com/gsi/client"
                    strategy="afterInteractive"
                    onLoad={() => setGsiReady(true)}
                />
            ) : null}
            <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--rg-bg)] px-4 text-[var(--rg-text)]">
                <div className="w-full max-w-md rounded-2xl border border-[var(--rg-border)] bg-[var(--rg-surface-1)] p-8 shadow-xl">
                    <div className="mb-4 flex items-center justify-end">
                        <select
                            value={theme}
                            onChange={(e) => setTheme(e.target.value as AppTheme)}
                            className="rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--rg-text)] focus:outline-none"
                            aria-label="Theme"
                        >
                            <option value="white">White</option>
                            <option value="dark">Dark</option>
                            <option value="naval-blue">Naval Blue</option>
                        </select>
                    </div>

                    <div className="flex flex-col items-center text-center">
                        <div className="mb-3 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-[var(--rg-border)] bg-[var(--rg-surface-2)]">
                            {!logoLoadFailed ? (
                                <img
                                    src="/rigguru-logo.png"
                                    alt="RigGuru logo"
                                    className="h-full w-full object-cover"
                                    onError={() => setLogoLoadFailed(true)}
                                />
                            ) : (
                                <span className="text-xl font-black tracking-tight text-indigo-500">RG</span>
                            )}
                        </div>
                        <h1 className="text-center text-2xl font-bold text-[var(--rg-text)]">Rig Guru</h1>
                        <p className="mt-1 text-center text-xs text-[var(--rg-muted)]">
                            AI advisor for laptops, workstations, and enterprise hardware decisions.
                        </p>
                    </div>

                    <div className="mt-6 flex gap-2 rounded-lg bg-[var(--rg-surface-2)] p-1">
                        <button
                            type="button"
                            onClick={() => {
                                setMode('login');
                                setError(null);
                            }}
                            className={cn(
                                'flex-1 rounded-md py-2 text-sm font-medium transition-colors',
                                mode === 'login' ? 'bg-indigo-600 text-white' : 'text-[var(--rg-muted)] hover:text-[var(--rg-text)]'
                            )}
                        >
                            Log in
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMode('register');
                                setError(null);
                            }}
                            className={cn(
                                'flex-1 rounded-md py-2 text-sm font-medium transition-colors',
                                mode === 'register' ? 'bg-indigo-600 text-white' : 'text-[var(--rg-muted)] hover:text-[var(--rg-text)]'
                            )}
                        >
                            Register
                        </button>
                    </div>

                    <div className="mt-6 space-y-3">
                        <button
                            type="button"
                            onClick={() => {
                                setError(null);
                                if (!GOOGLE_CLIENT_ID) {
                                    setError('Google sign-in is not configured yet for this app.');
                                    return;
                                }
                                if (!window.google) {
                                    setError('Google sign-in is not ready yet. Try again in a second.');
                                    return;
                                }
                                window.google.accounts.id.prompt();
                            }}
                            className="flex w-full items-center justify-center gap-3 rounded-full border border-[var(--rg-border)] bg-[var(--rg-surface-2)] px-5 py-3 text-base font-semibold text-[var(--rg-text)] transition-colors hover:bg-[var(--rg-surface-3)]"
                        >
                            <GoogleBrandIcon />
                            Continue with Google
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setError('Apple sign-in is not configured yet for this app.');
                            }}
                            className="flex w-full items-center justify-center gap-3 rounded-full border border-[var(--rg-border)] bg-[var(--rg-surface-2)] px-5 py-3 text-base font-semibold text-[var(--rg-text)] transition-colors hover:bg-[var(--rg-surface-3)]"
                        >
                            <AppleBrandIcon />
                            Continue with Apple
                        </button>
                        <div ref={googleBtnRef} className="hidden min-h-[40px]" />
                    </div>
                    <div className="my-6 flex items-center gap-3">
                        <div className="h-px flex-1 bg-[var(--rg-border)]" />
                        <span className="text-[10px] uppercase tracking-widest text-[var(--rg-muted)]">or email</span>
                        <div className="h-px flex-1 bg-[var(--rg-border)]" />
                    </div>

                    <form onSubmit={submit} className="space-y-4">
                        {mode === 'register' && (
                            <p className="text-[11px] leading-relaxed text-[var(--rg-muted)]">
                                Password must be <strong className="text-[var(--rg-text)]">8+ characters</strong>. Username:
                                letters, numbers, spaces, <code className="text-[var(--rg-text)]">_</code>{' '}
                                <code className="text-[var(--rg-text)]">-</code> <code className="text-[var(--rg-text)]">.</code>{' '}
                                only. Use a real email address you can log in with later.
                            </p>
                        )}
                        {mode === 'register' && (
                            <div>
                                <label className="text-xs font-medium text-[var(--rg-muted)]">Username</label>
                                <input
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="mt-1 w-full rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-2)] px-3 py-2 text-sm text-[var(--rg-text)] focus:border-indigo-500 focus:outline-none"
                                    required
                                    minLength={2}
                                    autoComplete="username"
                                />
                            </div>
                        )}
                        <div>
                            <label className="text-xs font-medium text-[var(--rg-muted)]">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="mt-1 w-full rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-2)] px-3 py-2 text-sm text-[var(--rg-text)] focus:border-indigo-500 focus:outline-none"
                                required
                                autoComplete="email"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-[var(--rg-muted)]">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="mt-1 w-full rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-2)] px-3 py-2 text-sm text-[var(--rg-text)] focus:border-indigo-500 focus:outline-none"
                                required
                                minLength={mode === 'register' ? 8 : 1}
                                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                            />
                        </div>
                        {error && <p className="text-sm text-rose-400">{error}</p>}
                        <button
                            type="button"
                            onClick={() => {
                                setGuestMode(true);
                                clearAuth();
                                router.replace('/');
                            }}
                            className="w-full rounded-lg border border-[var(--rg-border)] bg-[var(--rg-surface-2)] py-2.5 text-sm font-semibold text-[var(--rg-text)] hover:bg-[var(--rg-surface-3)]"
                        >
                            Continue as Guest User
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                        >
                            {loading ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Log in'}
                        </button>
                    </form>
                </div>
            </div>
        </>
    );
}
