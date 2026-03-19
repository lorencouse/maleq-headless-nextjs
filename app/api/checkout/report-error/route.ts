import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logDurableEvent } from '@/lib/monitoring/durable-events';
import { sendAdminAlert } from '@/lib/email/alert';

const reportSchema = z.object({
  eventType: z.string().min(1).max(64).regex(/^(checkout|stripe)_[a-z0-9_]+$/),
  message: z.string().min(1).max(500),
  severity: z.enum(['warning', 'error']).default('warning'),
  paymentIntentId: z.string().max(128).nullable().optional(),
  notifyAdmin: z.boolean().optional(),
  adminSubject: z.string().min(1).max(120).optional(),
  context: z.record(z.string(), z.union([
    z.string().max(500),
    z.number(),
    z.boolean(),
    z.null(),
  ])).optional(),
});

type AlertDetails = Record<string, string | number | boolean | undefined>;

export async function POST(request: NextRequest) {
  const requestMeta = getRequestMeta(request);

  if (!isTrustedCheckoutSource(request)) {
    await logDurableEvent({
      eventType: 'checkout_client_report_untrusted_source',
      severity: 'warning',
      message: 'Rejected checkout client error report from untrusted origin/referrer',
      ...requestMeta,
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const parsed = reportSchema.safeParse(await request.json());
    if (!parsed.success) {
      await logDurableEvent({
        eventType: 'checkout_client_report_validation_failed',
        severity: 'warning',
        message: 'Rejected invalid checkout client error report payload',
        ...requestMeta,
        payload: {
          issueCount: parsed.error.issues.length,
        },
      });
      return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
    }

    const { eventType, message, severity, paymentIntentId, notifyAdmin, adminSubject, context } =
      parsed.data;

    await logDurableEvent({
      eventType,
      severity,
      message,
      paymentIntentId: paymentIntentId || null,
      ...requestMeta,
      payload: context || null,
    });

    if (notifyAdmin) {
      await sendAdminAlert(adminSubject || 'Checkout Client Error', buildAlertDetails({
        eventType,
        message,
        severity,
        paymentIntentId: paymentIntentId || undefined,
        ...context,
      }));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await logDurableEvent({
      eventType: 'checkout_client_report_failed',
      severity: 'error',
      message: 'Failed to persist checkout client error report',
      ...requestMeta,
      payload: { error: message },
    });
    return NextResponse.json({ error: 'Failed to report error' }, { status: 500 });
  }
}

function buildAlertDetails(
  details: Record<string, string | number | boolean | null | undefined>
): AlertDetails {
  const result: AlertDetails = {};

  for (const [key, value] of Object.entries(details)) {
    if (value === null || value === undefined || value === '') continue;
    result[key] = value;
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
