import { NextRequest, NextResponse } from 'next/server';
import { extractAuthToken, clearSessionCookie } from '@/lib/api/auth-token';

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');

export async function POST(request: NextRequest) {
  // Logout is idempotent: always clear the session cookie, even if there's no
  // valid token (already-expired session, double-click, etc.).
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);

  try {
    const tokenData = extractAuthToken(request);
    if (tokenData) {
      // Invalidate token on WordPress side (best-effort).
      await fetch(`${WOOCOMMERCE_URL}/wp-json/maleq/v1/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenData.rawToken}`,
        },
        body: JSON.stringify({ user_id: tokenData.userId }),
      });
    }
  } catch (error) {
    console.error('Logout error:', error);
  }

  return response;
}
