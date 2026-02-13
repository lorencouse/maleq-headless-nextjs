import { NextRequest, NextResponse } from 'next/server';
import { authenticateCustomer } from '@/lib/woocommerce/customers';
import {
  handleApiError,
  validationError,
} from '@/lib/api/response';
import { validateRequired, hasErrors } from '@/lib/api/validation';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { login, email, password } = body;

    // Support both 'login' and 'email' parameters for backwards compatibility
    const identifier = login || email;

    if (!identifier || !password) {
      return validationError({ login: 'Email or username is required', password: 'Password is required' });
    }

    // Authenticate with WooCommerce/WordPress
    const { customer, token } = await authenticateCustomer(identifier, password);

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
    return handleApiError(error, 'Login failed');
  }
}
