import { NextRequest } from 'next/server';
import { verifyCronOrAdminAuth } from '@/lib/api/admin-auth';
import { checkAndNotifyStockAlerts } from '@/lib/push/push-service';
import { successResponse, handleApiError } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  const authError = verifyCronOrAdminAuth(request);
  if (authError) return authError;

  try {
    const result = await checkAndNotifyStockAlerts();
    return successResponse(
      result,
      `Stock alerts: sent ${result.sent}, failed ${result.failed}, expired ${result.expired}`
    );
  } catch (error) {
    return handleApiError(error, 'Failed to check stock alerts');
  }
}
