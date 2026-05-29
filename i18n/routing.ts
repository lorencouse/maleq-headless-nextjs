import { defineRouting } from 'next-intl/routing';

/**
 * i18n routing config.
 *
 * Strategy: "as-needed" prefix — the default locale (en) has no prefix, so all
 * existing URLs keep working unchanged. Additional locales get a path prefix
 * (e.g. /es/about). Add new locales here and to `messages/`; no other code
 * changes required.
 *
 * See: docs/i18n.md (to be written) for the full architecture rationale —
 * notably why product/sex-toys/brand/shop/guides routes are NOT under [locale].
 */
export const routing = defineRouting({
  // en (no prefix) + es (/es) + de (/de) + fr (/fr) + ja (/ja) + zh (/zh,
  // Simplified — hreflang zh-Hans) + zh-hant (/zh-hant, Traditional/Taiwan —
  // hreflang zh-Hant). Bare `zh` is Simplified by convention (the larger
  // mainland audience); the original Traditional catalog lives under the
  // explicit /zh-hant prefix. Every locale here has a fully translated UI
  // catalog in messages/ and ships as a URL-routed, server-rendered locale.
  // This is the single source of truth for which locales exist — i18n/request.ts
  // and the LanguageSwitcher both derive from it, so there are no chrome-only
  // special cases anymore.
  locales: ['en', 'es', 'de', 'fr', 'ja', 'zh', 'zh-hant'] as const,
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  // Cookie that persists the user's choice across visits.
  localeCookie: {
    name: 'NEXT_LOCALE',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  },
});

export type Locale = (typeof routing.locales)[number];
