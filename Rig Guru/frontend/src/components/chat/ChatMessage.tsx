import React from 'react';
import { AlertCircle } from 'lucide-react';
import { ChatMessage as ChatMessageType } from '@/types';
import { cn, renderSimpleBold } from '@/lib/utils';

interface ChatMessageProps {
    message: ChatMessageType;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
    const isUser = message.role === 'user';
    const isError = message.isError;

    return (
        <div className={cn('flex w-full mb-6', isUser ? 'justify-end' : 'justify-start')}>
            <div
                className={cn(
                    'rg-chat-bubble max-w-[85%] rounded-2xl p-4 shadow-lg md:max-w-[75%]',
                    isUser && 'rg-chat-bubble-user text-white rounded-tr-none',
                    !isUser &&
                        !isError &&
                        'rg-chat-bubble-assistant text-[var(--rg-text)] rounded-tl-none border border-[var(--rg-border)]',
                    !isUser &&
                        isError &&
                        'rg-chat-bubble-error text-[var(--rg-text)] rounded-tl-none border border-amber-500/50 ring-1 ring-amber-500/20'
                )}
            >
                <div className="text-sm font-semibold mb-1 opacity-90 flex items-center gap-2">
                    {isError && <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden />}
                    {isUser ? 'You' : isError ? 'Connection issue' : 'RigGuru'}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">
                    {renderSimpleBold(message.text)}
                </div>

                {!isUser && message.groundingLinks && message.groundingLinks.length > 0 && (
                    <div className="mt-4 border-t border-[var(--rg-border)] pt-3">
                        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--rg-muted)]">
                            Sources & references
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {message.groundingLinks.map((chunk, idx) => {
                                const web = chunk.web;
                                if (!web) return null;
                                const href = web.uri || web.url;
                                if (!href) return null;

                                return (
                                    <a
                                        key={idx}
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex max-w-[200px] items-center gap-1 truncate rounded border border-[var(--rg-border)] bg-[var(--rg-surface-1)] px-2 py-1 text-xs text-blue-500 transition-colors hover:bg-[var(--rg-surface-3)]"
                                        title={web.title || href}
                                    >
                                        <span className="truncate">{web.title || new URL(href).hostname}</span>
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ChatMessage;
