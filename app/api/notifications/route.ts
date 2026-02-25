import { NextRequest } from 'next/server';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { errorResponse, successResponse, handleApiError } from '@/lib/api/response';
import { parseIntSafe } from '@/lib/api/validation';
import { extractAuthToken } from '@/lib/api/auth-token';
import { getCustomerPushNotificationHistory } from '@/lib/push/notification-history-service';

function getRateLimitKey(request: NextRequest, customerId: number): string {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  return `notifications:${customerId}:${ip}`;
}

export async function GET(request: NextRequest) {
  const tokenData = extractAuthToken(request);
  if (!tokenData) {
    return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  }

  try {
    const rateResult = checkRateLimit(
      getRateLimitKey(request, tokenData.userId),
      RATE_LIMITS.api
    );
    if (!rateResult.allowed) {
      return errorResponse('Too many requests. Please try again later.', 429, 'RATE_LIMITED');
    }

    const limit = parseIntSafe(request.nextUrl.searchParams.get('limit'), 50, 1, 200);
    const notifications = await getCustomerPushNotificationHistory(tokenData.userId, limit);

    return successResponse({
      notifications,
      limit,
      count: notifications.length,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch notifications');
  }
}
