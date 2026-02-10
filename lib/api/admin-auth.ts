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
