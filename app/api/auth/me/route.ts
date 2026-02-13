import { NextRequest, NextResponse } from 'next/server';
import { extractAuthToken } from '@/lib/api/auth-token';

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');

export async function GET(request: NextRequest) {
  try {
    const tokenData = extractAuthToken(request);

    if (!tokenData) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Validate token server-side against WordPress
    const response = await fetch(`${WOOCOMMERCE_URL}/wp-json/maleq/v1/validate-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenData.rawToken}`,
      },
      body: JSON.stringify({ user_id: tokenData.userId }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const customer = await response.json();

    return NextResponse.json({
      user: {
        id: customer.id,
        email: customer.email,
        firstName: customer.first_name,
        lastName: customer.last_name,
        displayName: `${customer.first_name} ${customer.last_name}`,
        avatarUrl: customer.avatar_url,
      },
    });
  } catch (error) {
    console.error('Auth check error:', error);

    return NextResponse.json(
      { error: 'Failed to verify authentication' },
      { status: 500 }
    );
  }
}
