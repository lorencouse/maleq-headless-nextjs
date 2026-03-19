'use client';

export type CheckoutClientErrorSeverity = 'warning' | 'error';

type PrimitiveContextValue = string | number | boolean | null | undefined;

export interface CheckoutClientErrorReport {
  eventType: string;
  message: string;
  severity?: CheckoutClientErrorSeverity;
  paymentIntentId?: string | null;
  notifyAdmin?: boolean;
  adminSubject?: string;
  context?: Record<string, PrimitiveContextValue>;
}

function sanitizeValue(value: PrimitiveContextValue): string | number | boolean | null {
  if (value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return String(value).slice(0, 500);
}

export async function reportCheckoutClientError(
  input: CheckoutClientErrorReport
): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  const context = Object.fromEntries(
    Object.entries(input.context || {}).map(([key, value]) => [key, sanitizeValue(value)])
  );

  try {
    await fetch('/api/checkout/report-error', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventType: input.eventType,
        message: input.message,
        severity: input.severity || 'warning',
        paymentIntentId: input.paymentIntentId || null,
        notifyAdmin: Boolean(input.notifyAdmin),
        adminSubject: input.adminSubject,
        context,
      }),
      keepalive: true,
    });
  } catch {
    // Client-side logging should never block the checkout flow.
  }
}
