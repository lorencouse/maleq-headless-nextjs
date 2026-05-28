import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { routing, type Locale } from './routing';

/**
 * Resolves the active locale and loads its message catalog for every server
 * render.
 *
 * Two paths feed into this:
 *   1. URL-based — requests under app/[locale]/... arrive with `requestLocale`
 *      set by next-intl middleware. Used for static/shell pages.
 *   2. Cookie-based fallback — requests to non-[locale] routes (product,
 *      sex-toys, guides, etc.) have no URL locale; we read NEXT_LOCALE so the
 *      chrome (Header/Footer) still renders in the user's chosen language
 *      while the content stays English.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  // Fallback for routes outside [locale] — read the cookie set by the
  // language switcher.
  if (!locale) {
    const cookieStore = await cookies();
    locale = cookieStore.get('NEXT_LOCALE')?.value;
  }

  // Validate against the configured locales; unknown values fall back to en.
  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
