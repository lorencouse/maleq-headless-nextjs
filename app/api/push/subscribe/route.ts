import { NextRequest } from 'next/server';
import { saveSubscription, deleteSubscription } from '@/lib/push/push-service';
import { successResponse, validationError, handleApiError, errorResponse } from '@/lib/api/response';

function isValidEndpointUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseIntSafe(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export async function POST(request: NextRequest) {
  try {
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

    if (!isValidEndpointUrl(endpoint)) {
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

    return successResponse(null, 'Subscribed to push notifications');
  } catch (error) {
    return handleApiError(error, 'Failed to save push subscription');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const { endpoint } = body as { endpoint?: string };

    if (!endpoint || typeof endpoint !== 'string') {
      return validationError({ endpoint: 'Endpoint is required' });
    }

    await deleteSubscription(endpoint);
    return successResponse(null, 'Unsubscribed from push notifications');
  } catch (error) {
    return handleApiError(error, 'Failed to remove push subscription');
  }
}
