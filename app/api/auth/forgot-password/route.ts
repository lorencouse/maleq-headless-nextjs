import { NextRequest, NextResponse } from 'next/server';

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Use our custom WordPress endpoint for password reset
    const resetUrl = `${WOOCOMMERCE_URL}/wp-json/maleq/v1/forgot-password`;

    const response = await fetch(resetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();

    // Always return success to prevent email enumeration attacks
    // The WordPress endpoint handles the actual email sending
    return NextResponse.json({
      success: true,
      message: data.message || 'If an account with that email exists, we have sent password reset instructions.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);

    // Still return success to prevent email enumeration
    return NextResponse.json({
      success: true,
      message: 'If an account with that email exists, we have sent password reset instructions.',
    });
  }
}
