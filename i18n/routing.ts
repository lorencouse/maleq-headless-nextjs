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
  // en (no prefix) + es (/es) + zh (/zh, Simplified — hreflang zh-Hans) +
  // zh-hant (/zh-hant, Traditional/Taiwan — hreflang zh-Hant). Bare `zh` is
  // Simplified by convention (the larger mainland audience); the original
  // Traditional catalog now lives under the explicit /zh-hant prefix.
  // ja is intentionally NOT here: its catalog is still an untranslated copy of
  // en, so it stays a chrome-only locale (applied per-guide) until translated.
  locales: ['en', 'es', 'zh', 'zh-hant'] as const,
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  // Cookie that persists the user's choice across visits.
  localeCookie: {
    name: 'NEXT_LOCALE',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  },
});

export type Locale = (typeof routing.locales)[number];
