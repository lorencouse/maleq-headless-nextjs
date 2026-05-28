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
  locales: ['en', 'es'] as const,
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  // Cookie that persists the user's choice across visits.
  localeCookie: {
    name: 'NEXT_LOCALE',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  },
});

export type Locale = (typeof routing.locales)[number];
