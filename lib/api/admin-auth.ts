import { NextRequest, NextResponse } from 'next/server';

/**
 * Verify admin API key from Authorization header.
 * Requires ADMIN_API_KEY environment variable to be set.
 * Returns null if authenticated, or an error response if not.
 */
export function verifyAdminAuth(request: NextRequest): NextResponse | null {
  const adminKey = process.env.ADMIN_API_KEY;

  if (!adminKey) {
    return NextResponse.json(
      { error: 'Admin API key not configured' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization');

  if (!authHeader || authHeader !== `Bearer ${adminKey}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return null;
}

/**
 * Verify cron or admin auth.
 * Accepts either CRON_SECRET (Vercel cron) or ADMIN_API_KEY (manual trigger).
 * Returns null if authenticated, or an error response if not.
 */
export function verifyCronOrAdminAuth(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const adminKey = process.env.ADMIN_API_KEY;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return null;
  if (adminKey && authHeader === `Bearer ${adminKey}`) return null;

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
