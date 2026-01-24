import { NextRequest, NextResponse } from 'next/server';
import { createCustomer, getCustomerByEmail } from '@/lib/woocommerce/customers';
import {
  errorResponse,
  validationError,
  handleApiError,
} from '@/lib/api/response';
import {
  validateRequired,
  validateEmail,
  validateLength,
  hasErrors,
  combineValidationErrors,
} from '@/lib/api/validation';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, firstName, lastName } = body;

    // Validate required fields
    const requiredErrors = validateRequired(body, [
      'email',
      'password',
      'firstName',
      'lastName',
    ]);

    // Validate email format
    const emailError = validateEmail(email);
    if (emailError && !requiredErrors.email) {
      requiredErrors.email = emailError;
    }

    // Validate password strength
    const passwordError = validateLength(password, 'password', 8);
    if (passwordError && !requiredErrors.password) {
      requiredErrors.password = passwordError;
    }

    const errors = combineValidationErrors(requiredErrors);
    if (hasErrors(errors)) {
      return validationError(errors);
    }

    // Check if customer already exists
    const existingCustomer = await getCustomerByEmail(email);
    if (existingCustomer) {
      return errorResponse(
        'An account with this email already exists',
        409,
        'ACCOUNT_EXISTS'
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
    return handleApiError(error, 'Registration failed');
  }
}
