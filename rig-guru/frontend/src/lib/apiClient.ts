import { apiUrl } from '@/lib/api';
import { clearAuth } from '@/lib/authStorage';

const defaultInit = (): RequestInit => ({
    credentials: 'include',
});

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    const body = init?.body;
    if (body != null && typeof body === 'string' && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    const res = await fetch(apiUrl(path), {
        ...defaultInit(),
        ...init,
        headers,
        credentials: 'include',
    });
    if (res.status === 401) {
        try {
            await fetch(apiUrl('/api/auth/logout'), { method: 'POST', ...defaultInit() });
        } catch {
            /* ignore */
        }
        clearAuth();
    }
    return res;
}
