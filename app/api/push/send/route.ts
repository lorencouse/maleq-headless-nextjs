import { NextRequest } from 'next/server';
import { verifyCronOrAdminAuth } from '@/lib/api/admin-auth';
import { sendByType } from '@/lib/push/push-service';
import { successResponse, validationError, handleApiError } from '@/lib/api/response';
import type { PushType } from '@/lib/push/types';

const VALID_TYPES: PushType[] = ['order_update', 'back_in_stock', 'promotion'];

export async function POST(request: NextRequest) {
  const authError = verifyCronOrAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { type, title, body: msgBody, url, image, customerId, productId } = body;

    if (!type || !VALID_TYPES.includes(type)) {
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
      type,
      title,
      body: msgBody,
      url,
      image,
      customerId: customerId ? Number(customerId) : undefined,
      productId: productId ? Number(productId) : undefined,
    });

    return successResponse(result, `Sent ${result.sent}, failed ${result.failed}, expired ${result.expired}`);
  } catch (error) {
    return handleApiError(error, 'Failed to send push notifications');
  }
}
