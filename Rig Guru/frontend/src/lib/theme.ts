export const THEME_STORAGE_KEY = 'rigguru-theme';

export const THEMES = ['naval-blue', 'dark', 'white'] as const;

export type AppTheme = (typeof THEMES)[number];

export function isAppTheme(value: string): value is AppTheme {
    return (THEMES as readonly string[]).includes(value);
}

export function loadTheme(): AppTheme {
    if (typeof window === 'undefined') return 'white';
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY) || '';
    return isAppTheme(raw) ? raw : 'white';
}

export function saveTheme(theme: AppTheme): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function applyTheme(theme: AppTheme): void {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
}
