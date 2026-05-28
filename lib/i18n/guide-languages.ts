/**
 * Guide (blog post) language model.
 *
 * The site has no multilingual plugin active — WPML was removed and its
 * translation-mapping table (`wp_icl_translations`) is gone. The only surviving
 * signal of a post's language is its top-level "language" category:
 *
 *   English   → "Male Q"          (slug: en)
 *   Spanish   → "Español"         (slug: espanol)
 *   Chinese   → "Chinese 中文"    (slug: cn)        — Traditional (Taiwan content)
 *   Japanese  → "日本語 Japanese" (slug: url-encoded 日本語-japanese)
 *
 * Translations are otherwise independent posts, all served under /guides/{slug}.
 * The original↔translation links themselves are stored separately, in the
 * `_maleq_translations` post meta managed by the maleq-post-translations
 * mu-plugin and read by lib/db/post-translations.ts.
 */

export type GuideLocale = 'en' | 'es' | 'zh' | 'ja';

export interface GuideLanguage {
  /** Internal locale key. */
  locale: GuideLocale;
  /** hreflang value for SEO <link rel="alternate">. */
  hreflang: string;
  /** English label (for aria-labels / fallbacks). */
  label: string;
  /** Native label shown in the on-page switcher. */
  nativeLabel: string;
  /**
   * Root "language" category slugs as stored in wp_terms.slug. CJK slugs are
   * persisted URL-encoded by WordPress, so we list both the encoded and decoded
   * forms to stay robust across environments.
   */
  rootCategorySlugs: string[];
}

/** Display/sort order for the languages. English first (the canonical source). */
export const GUIDE_LANGUAGES: GuideLanguage[] = [
  {
    locale: 'en',
    hreflang: 'en',
    label: 'English',
    nativeLabel: 'English',
    rootCategorySlugs: ['en'],
  },
  {
    locale: 'es',
    hreflang: 'es',
    label: 'Spanish',
    nativeLabel: 'Español',
    rootCategorySlugs: ['espanol'],
  },
  {
    locale: 'zh',
    hreflang: 'zh-Hant',
    label: 'Chinese',
    nativeLabel: '中文',
    rootCategorySlugs: ['cn'],
  },
  {
    locale: 'ja',
    hreflang: 'ja',
    label: 'Japanese',
    nativeLabel: '日本語',
    // WordPress stores the CJK slug URL-encoded; accept the decoded form too.
    rootCategorySlugs: ['%e6%97%a5%e6%9c%ac%e8%aa%9e-japanese', '日本語-japanese'],
  },
];

/** English is treated as the canonical / default language for x-default. */
export const DEFAULT_GUIDE_LOCALE: GuideLocale = 'en';

const BY_LOCALE = new Map<GuideLocale, GuideLanguage>(
  GUIDE_LANGUAGES.map((l) => [l.locale, l]),
);

/** Lookup: root category slug → language. */
const BY_ROOT_SLUG = new Map<string, GuideLanguage>();
for (const lang of GUIDE_LANGUAGES) {
  for (const slug of lang.rootCategorySlugs) {
    BY_ROOT_SLUG.set(slug.toLowerCase(), lang);
  }
}

/** All root-language category slugs (for SQL filtering). */
export const ROOT_LANGUAGE_SLUGS: string[] = GUIDE_LANGUAGES.flatMap(
  (l) => l.rootCategorySlugs,
);

export function getGuideLanguage(locale: GuideLocale): GuideLanguage | undefined {
  return BY_LOCALE.get(locale);
}

/**
 * Resolve a post's language from the set of category slugs assigned to it.
 * Returns undefined if none of them is a known root-language category
 * (≈1 post in the corpus is uncategorised by language).
 */
export function detectGuideLocale(
  categorySlugs: Iterable<string>,
): GuideLocale | undefined {
  for (const slug of categorySlugs) {
    const lang = BY_ROOT_SLUG.get(slug.toLowerCase());
    if (lang) return lang.locale;
  }
  return undefined;
}

/** Stable sort index for a locale, for ordering switcher entries. */
export function localeOrder(locale: GuideLocale): number {
  const idx = GUIDE_LANGUAGES.findIndex((l) => l.locale === locale);
  return idx === -1 ? GUIDE_LANGUAGES.length : idx;
}
