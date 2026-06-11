import { NextRequest } from 'next/server';
import { getPreferences, updatePreferences } from '@/lib/push/push-service';
import { successResponse, validationError, notFoundError, handleApiError, errorResponse } from '@/lib/api/response';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { getPushRateLimitKey, isValidPushEndpointUrl } from '@/lib/push/route-helpers';
import { verifyEndpointOwnershipToken } from '@/lib/push/endpoint-ownership';

export async function POST(request: NextRequest) {
  try {
    const rateResult = checkRateLimit(getPushRateLimitKey(request, 'preferences-post'), RATE_LIMITS.push);
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
    const rateResult = checkRateLimit(getPushRateLimitKey(request, 'preferences-put'), RATE_LIMITS.push);
    if (!rateResult.allowed) {
      return errorResponse('Too many requests. Please try again later.', 429, 'RATE_LIMITED');
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const { endpoint, ownershipToken, orderUpdates, backInStock, promotions, news } = body as {
      endpoint?: string;
      ownershipToken?: string;
      orderUpdates?: unknown;
      backInStock?: unknown;
      promotions?: unknown;
      news?: unknown;
    };

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

    // Validate preference values are booleans if provided
    const prefs: { orderUpdates?: boolean; backInStock?: boolean; promotions?: boolean; news?: boolean } = {};
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
    if (news !== undefined) {
      if (typeof news !== 'boolean') {
        return validationError({ news: 'Must be a boolean' });
      }
      prefs.news = news;
    }

    if (Object.keys(prefs).length === 0) {
      return validationError({ preferences: 'At least one preference field is required' });
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
