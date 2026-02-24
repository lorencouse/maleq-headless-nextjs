import { NextRequest } from 'next/server';
import {
  successResponse,
  errorResponse,
  validationError,
  handleApiError,
} from '@/lib/api/response';
import { validateEmail } from '@/lib/api/validation';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { logDurableEvent } from '@/lib/monitoring/durable-events';
import {
  getEmailFingerprint,
  subscribeNewsletter,
} from '@/lib/newsletter/subscription-service';

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

export async function POST(request: NextRequest) {
  const requestMeta = getRequestMeta(request);
  try {
    const rateKey = `newsletter:${requestMeta.ip || 'unknown'}:${requestMeta.requestPath}`;
    const rateResult = checkRateLimit(rateKey, RATE_LIMITS.form);
    if (!rateResult.allowed) {
      await logDurableEvent({
        eventType: 'newsletter_subscribe_rate_limited',
        severity: 'warning',
        message: 'Newsletter subscribe request rate limited',
        ...requestMeta,
      });
      return errorResponse('Too many requests. Please try again in a minute.', 429, 'RATE_LIMITED');
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400, 'INVALID_JSON');
    }

    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const rawSource = typeof body.source === 'string' ? body.source.trim() : 'footer';
    const source = rawSource.length > 0 ? rawSource.toLowerCase() : 'footer';

    // Validate email
    const emailError = validateEmail(email);
    if (emailError) {
      return validationError({ email: emailError });
    }

    const result = await subscribeNewsletter({
      email,
      source,
      ip: requestMeta.ip,
      userAgent: requestMeta.userAgent,
      referrer: requestMeta.referrer,
    });

    const emailFingerprint = getEmailFingerprint(email);

    await logDurableEvent({
      eventType:
        result.syncStatus === 'failed'
          ? 'newsletter_subscribe_provider_sync_failed'
          : 'newsletter_subscribe_success',
      severity: result.syncStatus === 'failed' ? 'warning' : 'info',
      message:
        result.syncStatus === 'failed'
          ? 'Newsletter subscriber saved, but provider sync failed'
          : 'Newsletter subscriber saved',
      ...requestMeta,
      payload: {
        source,
        created: result.created,
        syncStatus: result.syncStatus,
        provider: result.provider,
        emailFingerprint,
      },
    });

    return successResponse(undefined, 'Thank you for subscribing!');
  } catch (error) {
    await logDurableEvent({
      eventType: 'newsletter_subscribe_failed',
      severity: 'error',
      message: 'Newsletter subscribe request failed',
      ...requestMeta,
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return handleApiError(error, 'Failed to subscribe. Please try again.');
  }
}
