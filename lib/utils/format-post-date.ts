/**
 * Format a post date for display, mapping a next-intl locale to a BCP-47 tag.
 *
 * Pinned to UTC so the server (UTC in prod) and the browser render the same
 * string — a timezone-shifted date otherwise triggers a hydration mismatch
 * (React #418). Keep this in sync with any other post-date rendering.
 */
const NEXT_INTL_TO_BCP47: Record<string, string> = {
  es: 'es-ES',
  de: 'de-DE',
  fr: 'fr-FR',
  zh: 'zh-CN',
  'zh-hant': 'zh-TW',
  ja: 'ja-JP',
};

export function formatPostDate(dateString: string, locale: string): string {
  const intlLocale = NEXT_INTL_TO_BCP47[locale] ?? 'en-US';
  return new Date(dateString).toLocaleDateString(intlLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
