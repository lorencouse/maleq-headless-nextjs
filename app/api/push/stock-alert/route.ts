import { NextRequest } from 'next/server';
import { saveStockAlert, deleteStockAlert } from '@/lib/push/push-service';
import { successResponse, validationError, handleApiError, errorResponse } from '@/lib/api/response';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { getPushRateLimitKey, isValidPushEndpointUrl } from '@/lib/push/route-helpers';
import { verifyEndpointOwnershipToken } from '@/lib/push/endpoint-ownership';

function parseIntSafe(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const rateResult = checkRateLimit(getPushRateLimitKey(request, 'stock-alert-post'), RATE_LIMITS.push);
    if (!rateResult.allowed) {
      return errorResponse('Too many requests. Please try again later.', 429, 'RATE_LIMITED');
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const { endpoint, ownershipToken, productId, productName, productSlug } = body as {
      endpoint?: string;
      ownershipToken?: string;
      productId?: unknown;
      productName?: string;
      productSlug?: string;
    };

    if (!endpoint || typeof endpoint !== 'string') {
      return validationError({ endpoint: 'Push endpoint is required' });
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

    const parsedProductId = parseIntSafe(productId);
    if (!parsedProductId) {
      return validationError({ productId: 'Valid numeric productId is required' });
    }
    if (!productName || typeof productName !== 'string' || productName.length > 500) {
      return validationError({ productName: 'Valid productName is required' });
    }
    if (!productSlug || typeof productSlug !== 'string' || !/^[a-z0-9-]+$/.test(productSlug)) {
      return validationError({ productSlug: 'Valid productSlug is required (lowercase alphanumeric and hyphens only)' });
    }

    await saveStockAlert(endpoint, {
      productId: parsedProductId,
      productName,
      productSlug,
    });

    return successResponse(null, 'Stock alert created');
  } catch (error) {
    return handleApiError(error, 'Failed to create stock alert');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const rateResult = checkRateLimit(getPushRateLimitKey(request, 'stock-alert-delete'), RATE_LIMITS.push);
    if (!rateResult.allowed) {
      return errorResponse('Too many requests. Please try again later.', 429, 'RATE_LIMITED');
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const { endpoint, ownershipToken, productId } = body as {
      endpoint?: string;
      ownershipToken?: string;
      productId?: unknown;
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

    const parsedProductId = parseIntSafe(productId);
    if (!parsedProductId) {
      return validationError({ productId: 'Valid numeric productId is required' });
    }

    await deleteStockAlert(endpoint, parsedProductId);
    return successResponse(null, 'Stock alert removed');
  } catch (error) {
    return handleApiError(error, 'Failed to remove stock alert');
  }
}
