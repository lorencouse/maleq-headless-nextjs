import { NextRequest, NextResponse } from 'next/server';

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

    // Use WordPress endpoint to verify password
    const response = await fetch(`${WOOCOMMERCE_URL}/wp-json/maleq/v1/verify-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId,
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
