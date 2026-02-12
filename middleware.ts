import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit, RATE_LIMITS, type RateLimitConfig } from '@/lib/api/rate-limit';

/**
 * Route-specific rate limit configurations.
 * More restrictive limits for sensitive endpoints.
 */
const RATE_LIMITED_ROUTES: Record<string, RateLimitConfig> = {
  '/api/auth/login': RATE_LIMITS.auth,
  '/api/auth/register': RATE_LIMITS.auth,
  '/api/auth/forgot-password': RATE_LIMITS.form,
  '/api/auth/reset-password': RATE_LIMITS.form,
  '/api/contact': RATE_LIMITS.form,
  '/api/newsletter/subscribe': RATE_LIMITS.form,
  '/api/coupons/validate': RATE_LIMITS.api,
  '/api/orders/create': RATE_LIMITS.auth,
  '/api/payment/create-intent': RATE_LIMITS.auth,
};

function getClientIp(request: NextRequest): string {
  // Vercel provides the real IP via x-forwarded-for
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || 'anonymous';
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only rate-limit configured routes
  const config = RATE_LIMITED_ROUTES[pathname];
  if (!config) {
    return NextResponse.next();
  }

  const ip = getClientIp(request);
  const identifier = `${ip}:${pathname}`;
  const result = checkRateLimit(identifier, config);

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

  // Add rate limit headers to successful responses
  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', String(result.limit));
  response.headers.set('X-RateLimit-Remaining', String(result.remaining));
  response.headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetTime / 1000)));
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
