import { NextRequest } from 'next/server';
import {
  successResponse,
  validationError,
  handleApiError,
  errorResponse,
} from '@/lib/api/response';
import { validateEmail } from '@/lib/api/validation';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import {
  deleteEmailStockAlertSubscription,
  saveEmailStockAlertSubscription,
} from '@/lib/stock-alert/email-alert-service';

function parsePositiveInt(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num);
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getRateLimitKey(request: NextRequest): string {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  return `stock-alert-email:${ip}`;
}

export async function POST(request: NextRequest) {
  try {
    const rateResult = checkRateLimit(getRateLimitKey(request), RATE_LIMITS.form);
    if (!rateResult.allowed) {
      return errorResponse('Too many requests. Please try again in a minute.', 429, 'RATE_LIMITED');
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400, 'INVALID_JSON');
    }

    const rawProductId = body.productId;
    const productId = parsePositiveInt(rawProductId);
    const productName = typeof body.productName === 'string' ? body.productName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const rawSlug = typeof body.productSlug === 'string' ? body.productSlug.trim() : '';

    const errors: Record<string, string> = {};
    if (!productId) errors.productId = 'Valid productId is required';
    if (!productName) errors.productName = 'Product name is required';
    if (productName.length > 255) errors.productName = 'Product name is too long';

    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;

    const parsedSlug = rawSlug ? toSlug(rawSlug) : toSlug(productName);
    if (!parsedSlug) errors.productSlug = 'Unable to derive a valid product slug';
    if (parsedSlug.length > 255) errors.productSlug = 'Product slug is too long';

    if (Object.keys(errors).length > 0) {
      return validationError(errors);
    }

    await saveEmailStockAlertSubscription({
      email,
      productId: productId!,
      productName,
      productSlug: parsedSlug,
    });

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
    const rateResult = checkRateLimit(getRateLimitKey(request), RATE_LIMITS.form);
    if (!rateResult.allowed) {
      return errorResponse('Too many requests. Please try again in a minute.', 429, 'RATE_LIMITED');
    }

    const { searchParams } = new URL(request.url);
    const productIdParam = searchParams.get('productId');
    const emailParam = searchParams.get('email');

    const productId = parsePositiveInt(productIdParam);
    const email = (emailParam || '').trim().toLowerCase();

    const errors: Record<string, string> = {};
    if (!productId) errors.productId = 'Valid productId is required';
    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;

    if (Object.keys(errors).length > 0) {
      return validationError(errors);
    }

    await deleteEmailStockAlertSubscription(productId!, email);
    return successResponse(null, 'Stock alert removed');
  } catch (error) {
    return handleApiError(error, 'Failed to unsubscribe. Please try again.');
  }
}
