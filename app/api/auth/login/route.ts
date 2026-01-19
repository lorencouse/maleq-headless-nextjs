import { NextRequest, NextResponse } from 'next/server';
import { authenticateCustomer } from '@/lib/woocommerce/customers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Validate required fields
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Authenticate with WooCommerce/WordPress
    const { customer, token } = await authenticateCustomer(email, password);

    return NextResponse.json({
      success: true,
      user: {
        id: customer.id,
        email: customer.email,
        firstName: customer.first_name,
        lastName: customer.last_name,
        displayName: `${customer.first_name} ${customer.last_name}`,
        avatarUrl: customer.avatar_url,
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);

    const message = error instanceof Error ? error.message : 'Login failed';

    // Return appropriate status codes for different errors
    if (message.includes('No account found') || message.includes('Incorrect password')) {
      return NextResponse.json(
        { error: message },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
