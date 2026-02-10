import { NextRequest, NextResponse } from 'next/server';

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, key, password } = body;

    // Validate required fields
    if (!email || !key || !password) {
      return NextResponse.json(
        { error: 'Email, reset key, and new password are required' },
        { status: 400 }
      );
    }

    // Validate password strength
    if (password.length < 12) {
      return NextResponse.json(
        { error: 'Password must be at least 12 characters' },
        { status: 400 }
      );
    }

    // Use our custom WordPress endpoint for password reset
    const resetUrl = `${WOOCOMMERCE_URL}/wp-json/maleq/v1/reset-password`;

    const response = await fetch(resetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, key, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.message || 'Failed to reset password' },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: data.message || 'Password has been reset successfully.',
    });
  } catch (error) {
    console.error('Reset password error:', error);

    return NextResponse.json(
      { error: 'Failed to reset password. Please try again.' },
      { status: 500 }
    );
  }
}
