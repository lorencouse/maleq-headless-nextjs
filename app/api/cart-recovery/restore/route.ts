import { NextRequest } from 'next/server';
import {
  errorResponse,
  successResponse,
  handleApiError,
} from '@/lib/api/response';
import { restoreCartByRecoveryToken } from '@/lib/cart-recovery/service';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return errorResponse('Recovery token is required', 400, 'MISSING_TOKEN');
  }

  try {
    const restored = await restoreCartByRecoveryToken(token);
    if (!restored) {
      return errorResponse(
        'This recovery link is invalid or expired.',
        404,
        'RECOVERY_NOT_FOUND'
      );
    }

    return successResponse(restored, 'Cart restored');
  } catch (error) {
    return handleApiError(error, 'Failed to restore cart');
  }
}
