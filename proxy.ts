import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit, RATE_LIMITS, type RateLimitConfig } from '@/lib/api/rate-limit';
import { productRedirectMap } from '@/lib/redirects/product-redirects';
import { routing } from './i18n/routing';

/**
 * Unified edge handler — Next 16 replaced `middleware.ts` with `proxy.ts`.
 *
 * Responsibilities, in dispatch order:
 *   1. Legacy WordPress query-param redirects (`?s=`, `?p=`).
 *   2. V1 → V2 product slug redirects.
 *   3. Rate limiting for configured API routes.
 *   4. Content roots (sex-toys, brand, brands, shop, guides, news, admin) pass
 *      through untouched — they render in English regardless of locale UI.
 *   5. Everything else flows through next-intl locale routing.
 *
 * The matcher excludes only `_next`, `_vercel`, and asset files (anything with
 * a dot). All other paths reach `proxy()`, which dispatches based on prefix.
 * This is required so a one-segment legacy slug like `/some-wp-url` reaches
 * the `app/[locale]/[slug]/` catch-all after the i18n rewrite — without the
 * rewrite, Next can't match a two-segment route from a one-segment URL.
 */

const intlMiddleware = createIntlMiddleware(routing);

// Path prefixes whose routing is handled by their own static directories.
// They must NOT pass through the i18n rewrite, or `/product/abc` would be
// rewritten to `/en/product/abc` and try to resolve under `app/[locale]/`.
const CONTENT_ROOT_PREFIXES = [
  '/sex-toys',
  '/brand',
  '/brands',
  '/shop',
  '/guides',
  '/news',
  '/admin',
];

function isContentRoot(pathname: string): boolean {
  return CONTENT_ROOT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

const RATE_LIMITED_ROUTES: Record<string, RateLimitConfig> = {
  '/api/auth/login': RATE_LIMITS.auth,
  '/api/auth/register': RATE_LIMITS.auth,
  '/api/auth/forgot-password': RATE_LIMITS.form,
  '/api/auth/reset-password': RATE_LIMITS.form,
  '/api/contact': RATE_LIMITS.form,
  '/api/newsletter/subscribe': RATE_LIMITS.form,
  '/api/comments': RATE_LIMITS.form,
  '/api/reviews': RATE_LIMITS.form,
  '/api/upload/avatar': RATE_LIMITS.form,
  '/api/search': RATE_LIMITS.api,
  '/api/blog/search': RATE_LIMITS.api,
  '/api/coupons/validate': RATE_LIMITS.api,
  '/api/orders/create': RATE_LIMITS.auth,
  '/api/payment/create-intent': RATE_LIMITS.auth,
};

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || 'anonymous';
}

export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // --- Reject malformed / abusive URLs cheaply, before any render or DB hit ---
  // Crawlers follow self-referential links whose URL-encoding doubles on every
  // hop (%20 → %2520 → %252520 → …), producing an ever-growing path. Each hit
  // used to run a full dynamic render + DB lookup and then crash Next's
  // prerender-cache writer with `ENAMETOOLONG: mkdir`. Reject them here:
  //   - `%25` in the path is an ENCODED percent sign — a sign of double-encoding.
  //     Real product/guide/category slugs never contain a literal `%`. (Encoded
  //     non-ASCII slug chars use %C3/%E2/etc., never %25, so locale slugs are
  //     safe.) Query strings are not checked.
  //   - No legitimate slug is anywhere near 512 chars.
  // 410 Gone (not 404) tells crawlers to drop the URL permanently.
  if (pathname.length > 512 || pathname.includes('%25')) {
    return new NextResponse('Gone', {
      status: 410,
      headers: { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' },
    });
  }

  // --- Redirect old WordPress query-param URLs ---

  // /?s=search+term → /search?q=search+term
  const wpSearch = searchParams.get('s');
  if (wpSearch && pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/search';
    url.searchParams.delete('s');
    url.searchParams.set('q', wpSearch);
    return NextResponse.redirect(url, 301);
  }

  // /?p=12345 → / (post by ID — no reliable mapping, send to homepage)
  const wpPostId = searchParams.get('p');
  if (wpPostId && pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.delete('p');
    return NextResponse.redirect(url, 302);
  }

  // --- V1 → V2 product slug redirects (SKU-matched) ---
  if (pathname.startsWith('/product/')) {
    const slug = pathname.replace('/product/', '').replace(/\/$/, '');
    const newSlug = productRedirectMap[slug];
    if (newSlug) {
      const url = request.nextUrl.clone();
      url.pathname = `/product/${newSlug}`;
      return NextResponse.redirect(url, 301);
    }
    return NextResponse.next();
  }

  // --- Rate limiting for API routes ---
  if (pathname.startsWith('/api/')) {
    const rateConfig = RATE_LIMITED_ROUTES[pathname];
    if (!rateConfig) {
      return NextResponse.next();
    }

    const ip = getClientIp(request);
    const identifier = `${ip}:${pathname}`;
    const result = checkRateLimit(identifier, rateConfig);

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(result.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(result.resetTime / 1000)),
          },
        }
      );
    }

    const response = NextResponse.next();
    response.headers.set('X-RateLimit-Limit', String(result.limit));
    response.headers.set('X-RateLimit-Remaining', String(result.remaining));
    response.headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetTime / 1000)));
    return response;
  }

  // --- Content roots render in English regardless of UI locale ---
  if (isContentRoot(pathname)) {
    return NextResponse.next();
  }

  // --- Everything else: locale routing (covers `/`, shell pages, legacy slugs) ---
  return intlMiddleware(request);
}

export const config = {
  matcher: [
    // Everything except Next internals, Vercel internals, and static assets.
    '/((?!_next|_vercel|.*\\..*).*)',
  ],
};
