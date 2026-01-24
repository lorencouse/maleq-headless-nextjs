import { NextRequest } from 'next/server';
import {
  successResponse,
  validationError,
  handleApiError,
} from '@/lib/api/response';
import {
  validateRequired,
  validateEmail,
  hasErrors,
} from '@/lib/api/validation';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { productId, productName, email } = body;

    // Validate required fields
    const errors = validateRequired(body, ['productId', 'productName', 'email']);

    // Validate email format
    const emailError = validateEmail(email);
    if (emailError && !errors.email) {
      errors.email = emailError;
    }

    if (hasErrors(errors)) {
      return validationError(errors);
    }

    // In production, integrate with your email service or database
    // For now, log the subscription (only in development)
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `Stock alert subscription: ${email} for "${productName}" (${productId}) at ${new Date().toISOString()}`
      );
    }

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    return successResponse(
      { productId, productName, email },
      "You'll be notified when this product is back in stock!"
    );
  } catch (error) {
    return handleApiError(error, 'Failed to subscribe. Please try again.');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const email = searchParams.get('email');

    const errors: Record<string, string> = {};
    if (!productId) errors.productId = 'Product ID is required';
    if (!email) errors.email = 'Email is required';

    if (hasErrors(errors)) {
      return validationError(errors);
    }

    // In production, remove from database
    if (process.env.NODE_ENV === 'development') {
      console.log(`Stock alert unsubscribed: ${email} for product ${productId}`);
    }

    return successResponse(null, 'Stock alert removed');
  } catch (error) {
    return handleApiError(error, 'Failed to unsubscribe. Please try again.');
  }
}
