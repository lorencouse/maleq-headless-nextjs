import { NextRequest, NextResponse } from 'next/server';
import { getStripeServer, formatAmountForStripe } from '@/lib/stripe/server';
import { sendAdminAlert } from '@/lib/email/alert';
import { logDurableEvent } from '@/lib/monitoring/durable-events';
import { checkRateLimit } from '@/lib/api/rate-limit';
import { validateEmail } from '@/lib/api/validation';
import { extractAuthToken } from '@/lib/api/auth-token';
import {
  buildCheckoutCustomerRef,
  buildCheckoutFingerprint,
} from '@/lib/checkout/integrity';
import { z } from 'zod';
import {
  CheckoutPricingError,
  computeAuthoritativeCheckoutPricing,
} from '@/lib/checkout/server-pricing';

/**
 * Create Payment Intent API Route
 *
 * Creates a Stripe PaymentIntent for the checkout process.
 * Returns the client secret needed to confirm the payment on the frontend.
 */

export interface CreatePaymentIntentRequest {
  amount?: number; // Optional client-computed total (server computes authoritative total)
  cartItems: Array<{
    productId: string;
    variationId?: string;
    quantity: number;
  }>;
  couponCode?: string;
  shippingMethod: {
    id: string;
  };
  currency?: string;
  metadata?: Record<string, string>;
  customerEmail?: string;
  customerId?: number;
  shippingAddress?: {
    name: string;
    address: {
      line1: string;
      line2?: string;
      city: string;
      state?: string;
      postal_code: string;
      country: string;
    };
  };
}

export interface CreatePaymentIntentResponse {
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
  pricing: {
    subtotal: number;
    shipping: number;
    discount: number;
    tax: number;
    total: number;
    shippingMethodId: string;
    shippingMethodName: string;
    shippingCountry: string;
  };
}

const MAX_PAYMENT_INTENT_AMOUNT_USD = Number(process.env.MAX_PAYMENT_INTENT_AMOUNT_USD || 5000);
const CREATE_INTENT_RATE_LIMIT = {
  limit: Number(process.env.PAYMENT_INTENT_RATE_LIMIT_PER_MINUTE || 15),
  windowSeconds: 60,
};

const createIntentSchema = z.object({
  amount: z.number().positive().optional(),
  cartItems: z.array(z.object({
    productId: z.string().min(1),
    variationId: z.string().min(1).optional(),
    quantity: z.number().int().min(1).max(100),
  })).min(1, 'Cart cannot be empty'),
  couponCode: z.string().max(100).optional(),
  shippingMethod: z.object({
    id: z.string().min(1),
  }),
  currency: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  customerEmail: z.string().email().optional(),
  customerId: z.number().int().positive().optional(),
  shippingAddress: z.object({
    name: z.string().min(1),
    address: z.object({
      line1: z.string().min(1),
      line2: z.string().optional(),
      city: z.string().min(1),
      state: z.string().optional(),
      postal_code: z.string().min(1),
      country: z.string().min(2).max(2),
    }),
  }).optional(),
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestMeta = getRequestMeta(request);
  let body: CreatePaymentIntentRequest | undefined;
  try {
    const limiterKey = `checkout-intent:${requestMeta.ip || 'unknown'}:${(requestMeta.userAgent || 'na').slice(0, 64)}`;
    const rateResult = checkRateLimit(limiterKey, CREATE_INTENT_RATE_LIMIT);
    if (!rateResult.allowed) {
      await logDurableEvent({
        eventType: 'checkout_intent_rate_limited',
        severity: 'warning',
        message: 'Rejected create-intent request due to rate limit',
        ...requestMeta,
      });
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429 }
      );
    }

    if (!isTrustedCheckoutSource(request)) {
      await logDurableEvent({
        eventType: 'checkout_intent_untrusted_source',
        severity: 'warning',
        message: 'Rejected create-intent request from untrusted origin/referrer',
        ...requestMeta,
      });
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    const parsedBody = createIntentSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      await logDurableEvent({
        eventType: 'checkout_intent_validation_failed',
        severity: 'warning',
        message: 'Rejected create-intent request due to validation errors',
        ...requestMeta,
        payload: {
          issueCount: parsedBody.error.issues.length,
        },
      });
      return NextResponse.json(
        { error: 'Invalid request payload' },
        { status: 400 }
      );
    }

    body = parsedBody.data;

    const {
      amount: clientAmount,
      cartItems,
      couponCode,
      shippingMethod,
      currency = 'usd',
      metadata,
      customerEmail,
      customerId,
      shippingAddress,
    } = body;

    if (customerId !== undefined) {
      const tokenData = extractAuthToken(request);
      if (!tokenData) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      if (tokenData.userId !== customerId) {
        return NextResponse.json(
          { error: 'Forbidden' },
          { status: 403 }
        );
      }
    }

    if (currency.toLowerCase() !== 'usd') {
      await logDurableEvent({
        eventType: 'checkout_intent_invalid_currency',
        severity: 'warning',
        message: 'Rejected create-intent request with unsupported currency',
        ...requestMeta,
        payload: { currency },
      });
      return NextResponse.json(
        { error: 'Unsupported currency' },
        { status: 400 }
      );
    }

    if (customerEmail) {
      const emailError = validateEmail(customerEmail);
      if (emailError) {
        await logDurableEvent({
          eventType: 'checkout_intent_invalid_email',
          severity: 'warning',
          message: 'Rejected create-intent request with invalid customer email',
          ...requestMeta,
          payload: { customerEmail },
        });
        return NextResponse.json(
          { error: 'Invalid customer email' },
          { status: 400 }
        );
      }
    }

    const pricing = await computeAuthoritativeCheckoutPricing({
      cartItems,
      couponCode,
      shippingMethodId: shippingMethod.id,
      shippingCountry: shippingAddress?.address.country,
    });

    // If client sent a total, enforce parity with authoritative pricing.
    if (typeof clientAmount === 'number') {
      const delta = Math.abs(clientAmount - pricing.total);
      if (delta > 0.01) {
        await logDurableEvent({
          eventType: 'checkout_intent_amount_mismatch',
          severity: 'warning',
          message: 'Rejected create-intent request due to amount mismatch',
          ...requestMeta,
          payload: {
            clientAmount,
            authoritativeTotal: pricing.total,
            delta: Number(delta.toFixed(2)),
          },
        });
        return NextResponse.json(
          { error: 'Order total has changed. Please review your cart and try again.' },
          { status: 409 }
        );
      }
    }

    if (!Number.isFinite(pricing.total) || pricing.total <= 0 || pricing.total > MAX_PAYMENT_INTENT_AMOUNT_USD) {
      await logDurableEvent({
        eventType: 'checkout_intent_invalid_amount',
        severity: 'warning',
        message: 'Rejected create-intent request with invalid authoritative amount',
        ...requestMeta,
        payload: {
          amount: pricing.total,
          currency,
          maxAllowed: MAX_PAYMENT_INTENT_AMOUNT_USD,
        },
      });
      return NextResponse.json(
        { error: 'Invalid amount' },
        { status: 400 }
      );
    }

    const safeMetadata = sanitizeMetadata(metadata);
    const checkoutFingerprint = buildCheckoutFingerprint({
      cartItems,
      shippingMethodId: pricing.shippingMethod.id,
      shippingCountry: pricing.shippingCountry,
      customerId,
      customerEmail,
    });
    const checkoutCustomerRef = buildCheckoutCustomerRef(customerId, customerEmail);

    // Create the PaymentIntent
    const stripe = getStripeServer();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: formatAmountForStripe(pricing.total),
      currency,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        ...safeMetadata,
        checkout_subtotal: pricing.subtotal.toFixed(2),
        checkout_shipping: pricing.shipping.toFixed(2),
        checkout_discount: pricing.discount.toFixed(2),
        checkout_total: pricing.total.toFixed(2),
        shipping_method_id: pricing.shippingMethod.id,
        shipping_country: pricing.shippingCountry,
        checkout_fingerprint: checkoutFingerprint,
        checkout_customer_ref: checkoutCustomerRef,
        source: 'maleq-headless-checkout',
      },
      ...(customerEmail && { receipt_email: customerEmail }),
      ...(shippingAddress && { shipping: shippingAddress }),
    });

    if (!paymentIntent.client_secret) {
      throw new Error('Failed to create payment intent');
    }

    const response: CreatePaymentIntentResponse = {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: pricing.total,
      pricing: {
        subtotal: pricing.subtotal,
        shipping: pricing.shipping,
        discount: pricing.discount,
        tax: pricing.tax,
        total: pricing.total,
        shippingMethodId: pricing.shippingMethod.id,
        shippingMethodName: pricing.shippingMethod.name,
        shippingCountry: pricing.shippingCountry,
      },
    };

    await logDurableEvent({
      eventType: 'checkout_intent_created',
      message: `Created payment intent ${paymentIntent.id}`,
      paymentIntentId: paymentIntent.id,
      ...requestMeta,
      payload: {
        amount: pricing.total,
        subtotal: pricing.subtotal,
        shipping: pricing.shipping,
        discount: pricing.discount,
        currency,
        metadataKeys: Object.keys(safeMetadata).length,
        hasCustomerEmail: Boolean(customerEmail),
        hasShippingAddress: Boolean(shippingAddress),
        durationMs: Date.now() - startedAt,
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof CheckoutPricingError) {
      await logDurableEvent({
        eventType: 'checkout_intent_pricing_error',
        severity: 'warning',
        message: error.message,
        ...requestMeta,
        payload: {
          code: error.code,
          durationMs: Date.now() - startedAt,
        },
      });
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    console.error('Error creating payment intent:', error);
    sendAdminAlert('PaymentIntent Creation Failed', {
      'Amount': `$${body?.amount || 'N/A'}`,
      'Customer Email': body?.customerEmail || 'N/A',
      'Error': error instanceof Error ? error.message : String(error),
    });
    await logDurableEvent({
      eventType: 'checkout_intent_failed',
      severity: 'error',
      message: 'Failed to create payment intent',
      ...requestMeta,
      payload: {
        amount: body?.amount ?? null,
        currency: body?.currency ?? 'usd',
        hasMetadata: Boolean(body?.metadata),
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      },
    });

    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}

function sanitizeMetadata(
  metadata: Record<string, string> | undefined
): Record<string, string> {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  const result: Record<string, string> = {};
  const entries = Object.entries(metadata).slice(0, 20);

  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim().slice(0, 40);
    if (!key) continue;
    if (typeof rawValue !== 'string') continue;
    result[key] = rawValue.slice(0, 200);
  }

  return result;
}

function getRequestMeta(request: NextRequest): {
  requestPath: string;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
} {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
  return {
    requestPath: request.nextUrl.pathname,
    ip,
    userAgent: request.headers.get('user-agent'),
    referrer: request.headers.get('referer'),
  };
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
