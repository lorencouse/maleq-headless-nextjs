import { NextRequest, NextResponse } from 'next/server';
import { extractAuthToken } from '@/lib/api/auth-token';

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, password } = body;

    if (!userId || !password) {
      return NextResponse.json(
        { error: 'User ID and password are required' },
        { status: 400 }
      );
    }

    const parsedUserId = Number(userId);
    if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) {
      return NextResponse.json(
        { error: 'Invalid user ID' },
        { status: 400 }
      );
    }

    const tokenData = extractAuthToken(request);
    if (!tokenData) {
      return NextResponse.json(
        { valid: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (tokenData.userId !== parsedUserId) {
      return NextResponse.json(
        { valid: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Use WordPress endpoint to verify password
    const response = await fetch(`${WOOCOMMERCE_URL}/wp-json/maleq/v1/verify-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenData.rawToken}`,
      },
      body: JSON.stringify({
        user_id: parsedUserId,
        password,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { valid: false, error: data.message || 'Invalid password' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      valid: true,
    });
  } catch (error) {
    console.error('Password verification error:', error);
    return NextResponse.json(
      { valid: false, error: 'Failed to verify password' },
      { status: 500 }
    );
  }
}
