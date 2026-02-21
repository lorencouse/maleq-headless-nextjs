import { NextRequest } from 'next/server';
import { getPreferences, updatePreferences } from '@/lib/push/push-service';
import { successResponse, validationError, notFoundError, handleApiError, errorResponse } from '@/lib/api/response';

export async function POST(request: NextRequest) {
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

    const prefs = await getPreferences(endpoint);
    if (!prefs) {
      return notFoundError('Subscription');
    }

    return successResponse(prefs);
  } catch (error) {
    return handleApiError(error, 'Failed to get preferences');
  }
}

export async function PUT(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const { endpoint, orderUpdates, backInStock, promotions } = body as {
      endpoint?: string;
      orderUpdates?: unknown;
      backInStock?: unknown;
      promotions?: unknown;
    };

    if (!endpoint || typeof endpoint !== 'string') {
      return validationError({ endpoint: 'Endpoint is required' });
    }

    // Validate preference values are booleans if provided
    const prefs: { orderUpdates?: boolean; backInStock?: boolean; promotions?: boolean } = {};
    if (orderUpdates !== undefined) {
      if (typeof orderUpdates !== 'boolean') {
        return validationError({ orderUpdates: 'Must be a boolean' });
      }
      prefs.orderUpdates = orderUpdates;
    }
    if (backInStock !== undefined) {
      if (typeof backInStock !== 'boolean') {
        return validationError({ backInStock: 'Must be a boolean' });
      }
      prefs.backInStock = backInStock;
    }
    if (promotions !== undefined) {
      if (typeof promotions !== 'boolean') {
        return validationError({ promotions: 'Must be a boolean' });
      }
      prefs.promotions = promotions;
    }

    const updated = await updatePreferences(endpoint, prefs);
    if (!updated) {
      return notFoundError('Subscription');
    }

    return successResponse(null, 'Preferences updated');
  } catch (error) {
    return handleApiError(error, 'Failed to update preferences');
  }
}
