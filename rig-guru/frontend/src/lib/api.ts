/**
 * Backend API base URL.
 *
 * **Local dev (default):** same-origin proxy `/__rigguru_api` → Next.js rewrites to the real API
 * (see `next.config.ts`). No browser CORS, avoids localhost/IPv6 quirks.
 *
 * **Override:** set `NEXT_PUBLIC_API_URL` in `.env.local` to e.g. `http://localhost:8000` (API root only, not `.../api`).
 */
const PROXY_PREFIX = '/__rigguru_api';

const explicit = (process.env.NEXT_PUBLIC_API_URL ?? '').trim();

export const API_BASE_URL = explicit.length > 0 ? explicit.replace(/\/+$/, '') : PROXY_PREFIX;

/** True when using built-in Next rewrite (not a direct http(s) URL). */
export const USE_API_PROXY = API_BASE_URL.startsWith('/');

/** Short label for headers (avoids huge URLs). */
export function apiBaseLabel(): string {
    if (USE_API_PROXY) {
        return 'same-origin proxy → API (default :8000)';
    }
    return API_BASE_URL.replace(/^https?:\/\//, '');
}

export function apiUrl(path: string): string {
    const p = path.startsWith('/') ? path : `/${path}`;
    const base = API_BASE_URL.replace(/\/+$/, '');

    if (base.startsWith('/')) {
        return `${base}${p}`;
    }
    if (p.startsWith('/api') && /\/api$/i.test(base)) {
        return `${base.replace(/\/api$/i, '')}${p}`;
    }
    return `${base}${p}`;
}
