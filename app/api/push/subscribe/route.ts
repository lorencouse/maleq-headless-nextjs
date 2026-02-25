import { NextRequest } from 'next/server';
import { saveSubscription, deleteSubscription } from '@/lib/push/push-service';
import { successResponse, validationError, handleApiError, errorResponse } from '@/lib/api/response';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { getPushRateLimitKey, isValidPushEndpointUrl } from '@/lib/push/route-helpers';
import { createEndpointOwnershipToken, verifyEndpointOwnershipToken } from '@/lib/push/endpoint-ownership';

function parseIntSafe(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const rateResult = checkRateLimit(getPushRateLimitKey(request, 'subscribe-post'), RATE_LIMITS.push);
    if (!rateResult.allowed) {
      return errorResponse('Too many requests. Please try again later.', 429, 'RATE_LIMITED');
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const { endpoint, keys, customerId, email } = body as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
      customerId?: unknown;
      email?: string;
    };

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return validationError({
        subscription: 'Valid push subscription with endpoint and keys is required',
      });
    }

    if (!isValidPushEndpointUrl(endpoint)) {
      return validationError({ endpoint: 'Endpoint must be a valid HTTPS URL' });
    }

    if (endpoint.length > 1000) {
      return validationError({ endpoint: 'Endpoint URL too long' });
    }

    if (keys.p256dh.length > 200 || keys.auth.length > 100) {
      return validationError({ keys: 'Key values too long' });
    }

    if (email && (typeof email !== 'string' || email.length > 255)) {
      return validationError({ email: 'Invalid email' });
    }

    await saveSubscription({
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      customerId: parseIntSafe(customerId),
      email: email || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    });

    const ownership = createEndpointOwnershipToken(endpoint);

    return successResponse(
      {
        ownershipToken: ownership.token,
        ownershipTokenExpiresAt: ownership.expiresAt,
      },
      'Subscribed to push notifications'
    );
  } catch (error) {
    return handleApiError(error, 'Failed to save push subscription');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const rateResult = checkRateLimit(getPushRateLimitKey(request, 'subscribe-delete'), RATE_LIMITS.push);
    if (!rateResult.allowed) {
      return errorResponse('Too many requests. Please try again later.', 429, 'RATE_LIMITED');
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const { endpoint, ownershipToken } = body as { endpoint?: string; ownershipToken?: string };

    if (!endpoint || typeof endpoint !== 'string') {
      return validationError({ endpoint: 'Endpoint is required' });
    }
    if (!isValidPushEndpointUrl(endpoint)) {
      return validationError({ endpoint: 'Endpoint must be a valid HTTPS URL' });
    }
    if (endpoint.length > 1000) {
      return validationError({ endpoint: 'Endpoint URL too long' });
    }
    if (!ownershipToken || typeof ownershipToken !== 'string') {
      return errorResponse('Missing endpoint ownership token', 401, 'MISSING_OWNERSHIP_TOKEN');
    }
    if (ownershipToken.length > 4096) {
      return validationError({ ownershipToken: 'Invalid ownership token' });
    }
    if (!verifyEndpointOwnershipToken(ownershipToken, endpoint)) {
      return errorResponse('Unauthorized endpoint access', 401, 'UNAUTHORIZED_ENDPOINT');
    }

    await deleteSubscription(endpoint);
    return successResponse(null, 'Unsubscribed from push notifications');
  } catch (error) {
    return handleApiError(error, 'Failed to remove push subscription');
  }
}
