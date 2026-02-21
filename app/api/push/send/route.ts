import { NextRequest } from 'next/server';
import { verifyCronOrAdminAuth } from '@/lib/api/admin-auth';
import { sendByType } from '@/lib/push/push-service';
import { successResponse, validationError, handleApiError, errorResponse } from '@/lib/api/response';
import type { PushType } from '@/lib/push/types';

const VALID_TYPES: PushType[] = ['order_update', 'back_in_stock', 'promotion'];

function parseIntSafe(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export async function POST(request: NextRequest) {
  const authError = verifyCronOrAdminAuth(request);
  if (authError) return authError;

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const { type, title, body: msgBody, url, image, customerId, productId } = body as {
      type?: string;
      title?: string;
      body?: string;
      url?: string;
      image?: string;
      customerId?: unknown;
      productId?: unknown;
    };

    if (!type || !VALID_TYPES.includes(type as PushType)) {
      return validationError({
        type: `type must be one of: ${VALID_TYPES.join(', ')}`,
      });
    }
    if (!title || !msgBody) {
      return validationError({
        message: 'title and body are required',
      });
    }

    const result = await sendByType({
      type: type as PushType,
      title,
      body: msgBody,
      url: typeof url === 'string' ? url : undefined,
      image: typeof image === 'string' ? image : undefined,
      customerId: parseIntSafe(customerId),
      productId: parseIntSafe(productId),
    });

    return successResponse(result, `Sent ${result.sent}, failed ${result.failed}, expired ${result.expired}`);
  } catch (error) {
    return handleApiError(error, 'Failed to send push notifications');
  }
}
