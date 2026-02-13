import { NextRequest, NextResponse } from 'next/server';
import { extractAuthToken } from '@/lib/api/auth-token';

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');

export async function POST(request: NextRequest) {
  try {
    const tokenData = extractAuthToken(request);

    if (!tokenData) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Invalidate token on WordPress side
    await fetch(`${WOOCOMMERCE_URL}/wp-json/maleq/v1/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenData.rawToken}`,
      },
      body: JSON.stringify({ user_id: tokenData.userId }),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ success: true });
  }
}
