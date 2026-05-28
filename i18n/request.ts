import { getRequestConfig } from 'next-intl/server';
import { routing, type Locale } from './routing';

/**
 * Resolves the active locale and loads its message catalog for every server
 * render.
 *
 * Locale is resolved from the URL via `requestLocale` (set by next-intl
 * middleware for app/[locale]/... routes). Content-root routes (product,
 * sex-toys, guides, brand, brands, shop) live outside [locale] and render with
 * the default locale's chrome — those pages have ISR / `revalidate = N`, so
 * calling `cookies()` here would throw DYNAMIC_SERVER_USAGE and break every
 * cached page. Cookie-driven chrome locale on content-root pages is a
 * follow-up; needs to be wired client-side so it doesn't poison ISR.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  // Validate against the configured locales; unknown values fall back to en.
  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
