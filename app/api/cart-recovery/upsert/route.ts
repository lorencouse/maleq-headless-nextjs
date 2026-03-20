import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  errorResponse,
  successResponse,
  validationError,
  handleApiError,
} from '@/lib/api/response';
import { validateEmail } from '@/lib/api/validation';
import { upsertCartRecoverySnapshot } from '@/lib/cart-recovery/service';

const cartItemSchema = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  variationId: z.string().optional(),
  name: z.string().min(1),
  slug: z.string().min(1),
  sku: z.string().min(1),
  price: z.number().min(0),
  regularPrice: z.number().min(0),
  quantity: z.number().int().min(1),
  subtotal: z.number().min(0),
  image: z
    .object({
      url: z.string(),
      altText: z.string(),
    })
    .optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  stockQuantity: z.number().optional(),
  maxQuantity: z.number(),
  inStock: z.boolean(),
  type: z.string().optional(),
});

const cartSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  subtotal: z.number().min(0),
  tax: z.number().min(0),
  shipping: z.number().min(0),
  discount: z.number().min(0),
  autoDiscount: z.number().min(0),
  autoDiscountLabel: z.string().optional(),
  total: z.number().min(0),
  itemCount: z.number().int().min(1),
  currency: z.string().min(1),
  couponCode: z.string().optional(),
  updatedAt: z.number(),
});

const requestSchema = z.object({
  cartKey: z.string().min(8).max(64),
  email: z.string().min(1).max(255),
  customerId: z.number().int().positive().optional().nullable(),
  cart: cartSchema,
  shippingMethodId: z.string().max(64).optional().nullable(),
  shippingMethodName: z.string().max(255).optional().nullable(),
  shippingCountry: z.string().max(8).optional().nullable(),
  checkoutUrl: z.string().max(255).optional().nullable(),
  paymentIntentId: z.string().max(128).optional().nullable(),
});

export async function POST(request: NextRequest) {
  if (!isTrustedCheckoutSource(request)) {
    return errorResponse('Forbidden', 403, 'FORBIDDEN');
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400, 'INVALID_JSON');
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return validationError({ cart: 'Invalid cart recovery payload' });
    }

    const emailError = validateEmail(parsed.data.email);
    if (emailError) {
      return validationError({ email: emailError });
    }

    await upsertCartRecoverySnapshot({
      cartKey: parsed.data.cartKey,
      email: parsed.data.email,
      customerId: parsed.data.customerId ?? null,
      cart: parsed.data.cart,
      shippingMethodId: parsed.data.shippingMethodId ?? null,
      shippingMethodName: parsed.data.shippingMethodName ?? null,
      shippingCountry: parsed.data.shippingCountry ?? null,
      checkoutUrl: parsed.data.checkoutUrl ?? '/checkout',
      paymentIntentId: parsed.data.paymentIntentId ?? null,
    });

    return successResponse(undefined, 'Cart snapshot saved');
  } catch (error) {
    return handleApiError(error, 'Failed to save cart recovery snapshot');
  }
}

function parseHost(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getTrustedHosts(): Set<string> {
  const trustedHosts = new Set<string>(['maleq.com', 'www.maleq.com']);
  const siteHost = parseHost(process.env.NEXT_PUBLIC_SITE_URL || null);
  if (siteHost) trustedHosts.add(siteHost);
  return trustedHosts;
}

function isTrustedCheckoutSource(request: NextRequest): boolean {
  const trustedHosts = getTrustedHosts();
  const originHost = parseHost(request.headers.get('origin'));
  const refererHost = parseHost(request.headers.get('referer'));
  return (
    (originHost !== null && trustedHosts.has(originHost)) ||
    (refererHost !== null && trustedHosts.has(refererHost))
  );
}
