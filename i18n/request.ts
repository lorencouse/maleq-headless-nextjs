import { getRequestConfig } from 'next-intl/server';
import { routing, type Locale } from './routing';

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

  // Validate against the routing locales (the single source of truth — every
  // one has a catalog in messages/); unknown values fall back to the default.
  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
