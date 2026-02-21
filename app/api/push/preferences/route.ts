import { NextRequest } from 'next/server';
import { getPreferences, updatePreferences } from '@/lib/push/push-service';
import { successResponse, validationError, notFoundError, handleApiError } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const endpoint = request.nextUrl.searchParams.get('endpoint');
    if (!endpoint) {
      return validationError({ endpoint: 'Endpoint query parameter is required' });
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
    const body = await request.json();
    const { endpoint, orderUpdates, backInStock, promotions } = body;

    if (!endpoint) {
      return validationError({ endpoint: 'Endpoint is required' });
    }

    await updatePreferences(endpoint, {
      orderUpdates,
      backInStock,
      promotions,
    });

    return successResponse(null, 'Preferences updated');
  } catch (error) {
    return handleApiError(error, 'Failed to update preferences');
  }
}
