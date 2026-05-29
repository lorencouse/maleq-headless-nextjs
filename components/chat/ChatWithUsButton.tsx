'use client';

import { useTranslations } from 'next-intl';
import { OPEN_CHAT_EVENT } from './ChatWidget';

/**
 * Opens the global ChatWidget panel by dispatching OPEN_CHAT_EVENT. Used on
 * the /contact page so visitors can reach Mr. Q without scrolling for the
 * floating bubble. The widget itself lives in the layout, so this only needs
 * to fire the event.
 */
export default function ChatWithUsButton({ className }: { className?: string }) {
  const t = useTranslations('contactPage');

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_CHAT_EVENT))}
      className={
        className ??
        'inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:bg-primary-hover transition-colors'
      }
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
      {t('chatButton')}
    </button>
  );
}
