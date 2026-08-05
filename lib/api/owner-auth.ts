import { NextResponse } from 'next/server';
import { extractAuthToken } from '@/lib/api/auth-token';
import { ensureWpEnv, getWooCommerceUrl } from '@/lib/config/wp-env';

export interface OwnerContext {
  userId: number;
  email: string;
}

/**
 * Guard for owner/admin-only routes: requires a session cookie whose raw WP
 * token VALIDATES against WordPress and whose user has the `administrator`
 * role. Unlike routes that trust `extractAuthToken()` alone (which only
 * decodes the cookie), this round-trips to WP — the cookie's userId is
 * meaningless until the raw token inside it is verified.
 *
 * Returns an OwnerContext on success, or a ready-to-return NextResponse
 * (401/403/500) on failure.
 */
export async function requireOwner(request: Request): Promise<OwnerContext | NextResponse> {
  const tokenData = extractAuthToken(request);
  if (!tokenData) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Mode-aware base URL (same resolver the login path uses) so the token is
    // validated against the SAME WordPress that issued it — local in dev, prod
    // in prod. ensureWpEnv() completes the async local-probe first; without it
    // the sync fallback answers 'prod' on a cold route bundle.
    await ensureWpEnv();
    const res = await fetch(`${getWooCommerceUrl()}/wp-json/maleq/v1/validate-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenData.rawToken}`,
      },
      body: JSON.stringify({ user_id: tokenData.userId }),
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
    const customer = await res.json();
    if (customer?.role !== 'administrator') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return { userId: tokenData.userId, email: customer.email };
  } catch (e) {
    console.error('owner-auth validation error:', e);
    return NextResponse.json({ error: 'Auth validation failed' }, { status: 500 });
  }
}
