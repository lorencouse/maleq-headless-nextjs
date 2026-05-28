'use client';

import { useState, useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRouter, usePathname } from '@/i18n/navigation';
import { type Locale } from '@/i18n/routing';

// UI locales offered by the toggle. en/es are URL-routed locales; zh is a
// chrome-only catalog locale applied via cookie (no /zh/ URL tree).
const UI_LOCALES = ['en', 'es', 'zh'] as const;
const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Español',
  zh: '中文',
};
const ROUTING_LOCALES = new Set(['en', 'es']);

/**
 * Language switcher dropdown.
 *
 * Two switching modes depending on the current route:
 *
 *   1. en/es on a shell route under app/[locale]/... — uses next-intl's
 *      locale-aware router to navigate /about ↔ /es/about (URL + content +
 *      chrome all localize, server-rendered, best for SEO).
 *
 *   2. Everything else (zh, or any selection on a content-root page) — writes
 *      the NEXT_LOCALE cookie and fires a `ui-locale-change` event.
 *      ChromeLocaleProvider (client) reacts and re-renders the chrome in the
 *      chosen language in place. Needed because content-root pages are
 *      English-only ISR and can't read the cookie server-side, and because zh
 *      has no URL route.
 *
 * Detection: presence of a `locale` param means we're under [locale].
 */
export default function LanguageSwitcher() {
  const t = useTranslations('language');
  const locale = useLocale();
  const params = useParams();
  const intlRouter = useRouter();
  const intlPathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Routes under app/[locale]/... have a `locale` param; everything else
  // lives outside that route group.
  const isUnderLocaleSegment = params && 'locale' in params;

  // Close on outside click / escape
  useEffect(() => {
    if (!isOpen) return;
    function onClick(e: MouseEvent) {
      if (
        !buttonRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  function selectLocale(next: string) {
    setIsOpen(false);
    if (next === locale) return;

    // Persist the preference for ChromeLocaleProvider (and future visits).
    document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;

    if (isUnderLocaleSegment && ROUTING_LOCALES.has(next)) {
      // Shell route + a URL-routed locale: navigate so URL + content + chrome
      // all localize server-side. intlPathname is the unprefixed path.
      intlRouter.replace(intlPathname, { locale: next as Locale });
    } else {
      // zh (no URL route) or any content-root page: switch the chrome in place.
      window.dispatchEvent(new Event('ui-locale-change'));
    }
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen((v) => !v)}
        className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center gap-1 text-foreground hover:text-primary transition-colors text-sm font-medium"
        aria-label={t('switchLabel')}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <svg
          className="h-5 w-5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
        </svg>
        <span className="hidden lg:inline uppercase">{locale}</span>
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="listbox"
          aria-label={t('switchLabel')}
          className="absolute right-0 mt-2 w-40 bg-card border border-border rounded-lg shadow-lg z-50 py-1"
        >
          {UI_LOCALES.map((loc) => (
            <button
              key={loc}
              role="option"
              aria-selected={loc === locale}
              onClick={() => selectLocale(loc)}
              className={`block w-full text-left px-4 py-3 min-h-[44px] text-sm transition-colors hover:bg-muted ${
                loc === locale ? 'font-semibold text-primary' : 'text-foreground'
              }`}
            >
              {LOCALE_LABELS[loc]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
