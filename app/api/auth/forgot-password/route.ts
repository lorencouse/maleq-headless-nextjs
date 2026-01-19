import { NextRequest, NextResponse } from 'next/server';
import { getCustomerByEmail } from '@/lib/woocommerce/customers';

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

    // Check if customer exists
    const customer = await getCustomerByEmail(email);

    // Always return success to prevent email enumeration
    // In production, only send email if customer exists
    if (customer) {
      // Trigger WordPress password reset
      // This uses WordPress's built-in password reset functionality
      try {
        const resetUrl = `${WOOCOMMERCE_URL}/wp-json/custom/v1/forgot-password`;

        await fetch(resetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
      } catch (err) {
        // If custom endpoint doesn't exist, try the standard WP approach
        // Log the error but don't expose it to the user
        console.error('Password reset endpoint not available:', err);

        // Alternative: Use WooCommerce's lost password endpoint
        // This typically requires the user to go through WP's standard flow
      }
    }

    // Always return success to prevent email enumeration attacks
    return NextResponse.json({
      success: true,
      message: 'If an account with that email exists, we have sent password reset instructions.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);

    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
