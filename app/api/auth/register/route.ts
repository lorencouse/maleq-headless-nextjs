import { NextRequest, NextResponse } from 'next/server';
import { createCustomer, getCustomerByEmail } from '@/lib/woocommerce/customers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, firstName, lastName } = body;

    // Validate required fields
    if (!email || !password || !firstName || !lastName) {
      return NextResponse.json(
        { error: 'Email, password, first name, and last name are required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Please enter a valid email address' },
        { status: 400 }
      );
    }

    // Validate password strength
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    // Check if customer already exists
    const existingCustomer = await getCustomerByEmail(email);
    if (existingCustomer) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    // Create customer in WooCommerce
    const customer = await createCustomer({
      email,
      password,
      first_name: firstName,
      last_name: lastName,
      username: email,
    });

    // Generate a simple token (in production, use proper JWT)
    const token = Buffer.from(`${customer.id}:${Date.now()}:${Math.random()}`).toString('base64');

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
    console.error('Registration error:', error);

    const message = error instanceof Error ? error.message : 'Registration failed';

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
