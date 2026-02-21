import { NextRequest } from 'next/server';
import { saveSubscription, deleteSubscription } from '@/lib/push/push-service';
import { successResponse, validationError, handleApiError } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { endpoint, keys, customerId, email } = body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return validationError({
        subscription: 'Valid push subscription with endpoint and keys is required',
      });
    }

    await saveSubscription({
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      customerId: customerId ? Number(customerId) : undefined,
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
    const body = await request.json();
    const { endpoint } = body;

    if (!endpoint) {
      return validationError({ endpoint: 'Endpoint is required' });
    }

    await deleteSubscription(endpoint);
    return successResponse(null, 'Unsubscribed from push notifications');
  } catch (error) {
    return handleApiError(error, 'Failed to remove push subscription');
  }
}
