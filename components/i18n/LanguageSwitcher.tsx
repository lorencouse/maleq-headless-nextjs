'use client';

import { useState, useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useParams, useRouter as useNextRouter } from 'next/navigation';
import { useRouter, usePathname } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';

const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
};

/**
 * Language switcher dropdown.
 *
 * Two switching modes depending on the current route:
 *
 *   1. On routes under app/[locale]/... — uses next-intl's locale-aware
 *      router to navigate /about ↔ /es/about. URL changes, cookie is set
 *      automatically by next-intl.
 *
 *   2. On routes outside [locale] (product, sex-toys, brand, etc.) — sets
 *      the NEXT_LOCALE cookie manually and triggers a refresh. URL stays
 *      put, but the chrome (Header/Footer/etc.) re-renders in the new
 *      locale because i18n/request.ts falls back to the cookie for these
 *      routes.
 *
 * Detection: presence of a `locale` param means we're under [locale].
 */
export default function LanguageSwitcher() {
  const t = useTranslations('language');
  const locale = useLocale() as Locale;
  const params = useParams();
  const intlRouter = useRouter();
  const intlPathname = usePathname();
  const nextRouter = useNextRouter();
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

  function selectLocale(next: Locale) {
    setIsOpen(false);
    if (next === locale) return;

    if (isUnderLocaleSegment) {
      // intlPathname is the path without the locale prefix — replace() will
      // add the right prefix for `next`. Cookie is set by next-intl.
      intlRouter.replace(intlPathname, { locale: next });
    } else {
      // Non-localized route: set cookie ourselves and force a server refresh.
      document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      nextRouter.refresh();
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
          {routing.locales.map((loc) => (
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
