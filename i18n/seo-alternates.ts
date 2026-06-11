import { routing, type Locale } from './routing';

/**
 * SEO alternates (canonical + hreflang) for pages that live under the
 * `[locale]` route tree and exist in every UI locale.
 *
 * Why this exists: every localized page used to emit `canonical: '/about'`,
 * which Next resolves against `metadataBase` (the English origin) regardless of
 * the current locale — so `/es/about`, `/ja/about`, etc. all told Google they
 * were duplicates of the English page, with no hreflang to link the set. That
 * self-de-indexed the entire translated tree. This helper produces a
 * locale-correct self-canonical plus a full hreflang map derived from
 * `routing.locales`, so adding a locale needs no per-page edits.
 *
 * hreflang tags for the `zh` variants follow the routing convention:
 *   zh       → zh-Hans (Simplified)
 *   zh-hant  → zh-Hant (Traditional)
 */
const HREFLANG_BY_LOCALE: Record<Locale, string> = {
  en: 'en',
  es: 'es',
  de: 'de',
  fr: 'fr',
  ja: 'ja',
  zh: 'zh-Hans',
  'zh-hant': 'zh-Hant',
};

/**
 * Build the locale-prefixed path for a given locale.
 * The default locale (en) has no prefix (localePrefix: 'as-needed').
 */
function localizedPath(locale: Locale, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return locale === routing.defaultLocale ? clean : `/${locale}${clean}`;
}

/**
 * Returns a Next.js `Metadata['alternates']` object for a `[locale]` page.
 *
 * @param locale  The current request locale.
 * @param path    The locale-independent path, e.g. '/about' or '' for the home page.
 *
 * @example
 *   alternates: buildLocaleAlternates(locale, '/about')
 */
export function buildLocaleAlternates(locale: string, path: string) {
  const current = (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;

  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    languages[HREFLANG_BY_LOCALE[l]] = localizedPath(l, path);
  }
  // x-default points at the default-locale (English) URL.
  languages['x-default'] = localizedPath(routing.defaultLocale, path);

  return {
    canonical: localizedPath(current, path),
    languages,
  };
}
