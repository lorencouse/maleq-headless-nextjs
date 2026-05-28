import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

/**
 * UI locales that have a message catalog in messages/. This is a SUPERSET of
 * routing.locales (the URL-prefixed locales en/es/zh). `ja` is the only
 * chrome-ONLY locale: its catalog is still an untranslated copy of en, so it
 * gets no /ja URL tree and is applied only per-page by the guide-post layout
 * (app/(guide)/guides/[slug]/layout.tsx) via setRequestLocale() so a Japanese
 * guide renders its own shell. Keeping `ja` out of routing.locales stops
 * next-intl middleware from minting a /ja prefix until it's actually translated.
 */
const UI_LOCALES = ['en', 'es', 'zh', 'ja'] as const;
type UiLocale = (typeof UI_LOCALES)[number];

/**
 * Resolves the active locale and loads its message catalog for every server
 * render.
 *
 * Locale comes from `requestLocale`, which next-intl middleware sets for
 * app/[locale]/... routes and which the guide-post layout sets explicitly via
 * setRequestLocale() for content-root guide pages. Both are derived from the
 * URL (segment or slug), never from cookies()/headers(), so this stays safe on
 * ISR / `revalidate = N` pages (reading headers there throws
 * DYNAMIC_SERVER_USAGE and breaks every cached page).
 */
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  // Validate against the UI catalogs; unknown values fall back to the default.
  if (!locale || !UI_LOCALES.includes(locale as UiLocale)) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
