import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Locale routing middleware.
 *
 * Uses an **explicit allowlist** of paths to handle, rather than a denylist.
 * This is intentional: we have two root-level dynamic segments — `[locale]`
 * (this work) and `[slug]` (legacy WordPress URL catch-all in app/[slug]/).
 * A denylist matcher would catch arbitrary `/some-legacy-url` paths and try
 * to resolve them under `app/[locale]/`, which would 404 instead of falling
 * through to `app/[slug]/`.
 *
 * The allowlist lists every top-level path that lives under app/[locale]/...
 * plus the bare `/(en|es)` locale prefixes. Dynamic content roots (product,
 * sex-toys, brand, shop, guides) and legacy catch-alls ([slug]) stay at their
 * original URLs and pick up the locale from the NEXT_LOCALE cookie at render
 * time via i18n/request.ts.
 *
 * When adding a new shell route under app/[locale]/, add it to the
 * SHELL_PATHS regex group below. There's a CI test that catches drift.
 */

const SHELL_PATHS = [
  'about',
  'account',
  'cart',
  'checkout',
  'contact',
  'faq',
  'forgot-password',
  'login',
  'order-confirmation',
  'privacy',
  'register',
  'reset-password',
  'search',
  'share',
  'shipping-returns',
  'terms',
  'track-order',
].join('|');

export default createMiddleware(routing);

export const config = {
  matcher: [
    // Homepage
    '/',
    // Bare locale prefix (e.g. /es) — homepage in another locale
    '/(en|es)',
    // Any path under a locale prefix
    '/(en|es)/:path*',
    // Localized shell routes at the root (no locale prefix → default locale)
    `/(${SHELL_PATHS})`,
    `/(${SHELL_PATHS})/:path*`,
  ],
};
