import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/** Parse `**bold**` segments for display (no full markdown). */
export function renderSimpleBold(text: string): React.ReactNode[] {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
            return React.createElement(
                'strong',
                { key: i, className: 'font-semibold text-[var(--rg-text)]' },
                part.slice(2, -2)
            );
        }
        return React.createElement('span', { key: i }, part);
    });
}
