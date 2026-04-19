const USER_KEY = 'rigguru_user';
/** Legacy key — cleared on logout / 401 */
const LEGACY_TOKEN_KEY = 'rigguru_token';

export type StoredUser = {
    userId: number;
    email: string;
    username: string;
};

/** Cache who is logged in for UI; real auth is the API session cookie. */
export function setSessionUser(user: StoredUser): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.removeItem(LEGACY_TOKEN_KEY);
}

export function clearAuth(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
}

export function getStoredUser(): StoredUser | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(USER_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as StoredUser;
    } catch {
        return null;
    }
}
