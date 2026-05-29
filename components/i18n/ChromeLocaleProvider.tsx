'use client';

import { NextIntlClientProvider, useLocale } from 'next-intl';
import { useEffect, useState } from 'react';

/**
 * Client-side UI-locale override for the storefront chrome.
 *
 * Why this exists: product/shop/guide-listing pages are English-only ISR — the
 * server CANNOT read a locale cookie there (cookies() forces dynamic rendering
 * and trips DYNAMIC_SERVER_USAGE, which has caused outages). So a "switch the
 * whole UI to 中文 / Español" preference can only be applied on the client.
 *
 * Behaviour: reads the NEXT_LOCALE cookie and, ONLY when the server already
 * rendered in the DEFAULT locale (en), re-provides the chosen catalog so every
 * CLIENT chrome component (Header, Footer, ChatWidget, menus…) re-renders in
 * that language. Server-rendered page text stays as-is (it can't change on the
 * client) and product data is unaffected.
 *
 * It deliberately does NOTHING when the server locale isn't the default — i.e.
 * on /es/* URL routes (the URL won) and on Chinese/Japanese guides (the post's
 * content language won). Those are authoritative and must not be overridden.
 *
 * No-flash safety: override starts null (matches SSR), then applies after mount
 * via state, so there is no hydration mismatch — just a brief switch for users
 * who picked a non-default language. Crawlers (no cookie) always see the SSR
 * default, so this has no SEO effect.
 */

const DEFAULT_LOCALE = 'en';

// Explicit loader map so the bundler can code-split each catalog (only fetched
// when a user actually selects that language).
const CATALOG_LOADERS: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  es: () => import('@/messages/es.json'),
  zh: () => import('@/messages/zh.json'), // Simplified
  'zh-hant': () => import('@/messages/zh-hant.json'), // Traditional
};

function readLocaleCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function ChromeLocaleProvider({ children }: { children: React.ReactNode }) {
  const serverLocale = useLocale();
  const [override, setOverride] = useState<{ locale: string; messages: Record<string, unknown> } | null>(null);

  useEffect(() => {
    let cancelled = false;

    function apply() {
      // The server committed to a specific locale (es URL / guide content) —
      // never override it.
      if (serverLocale !== DEFAULT_LOCALE) {
        setOverride(null);
        return;
      }
      const pref = readLocaleCookie();
      if (!pref || pref === DEFAULT_LOCALE || !CATALOG_LOADERS[pref]) {
        setOverride(null);
        return;
      }
      CATALOG_LOADERS[pref]().then((m) => {
        if (!cancelled) setOverride({ locale: pref, messages: m.default });
      });
    }

    apply();
    // The language switcher fires this after writing the cookie so the chrome
    // updates in place without a full reload.
    window.addEventListener('ui-locale-change', apply);
    return () => {
      cancelled = true;
      window.removeEventListener('ui-locale-change', apply);
    };
  }, [serverLocale]);

  if (override) {
    return (
      <NextIntlClientProvider locale={override.locale} messages={override.messages}>
        {children}
      </NextIntlClientProvider>
    );
  }
  return <>{children}</>;
}
