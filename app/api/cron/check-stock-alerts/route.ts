import { NextRequest } from 'next/server';
import { verifyCronOrAdminAuth } from '@/lib/api/admin-auth';
import { checkAndNotifyStockAlerts } from '@/lib/push/push-service';
import { checkAndSendEmailStockAlerts } from '@/lib/stock-alert/email-alert-service';
import { successResponse, handleApiError } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  const authError = verifyCronOrAdminAuth(request);
  if (authError) return authError;

  try {
    const [push, email] = await Promise.all([
      checkAndNotifyStockAlerts(),
      checkAndSendEmailStockAlerts(),
    ]);

    return successResponse(
      { push, email },
      `Stock alerts: push sent ${push.sent}, push failed ${push.failed}, email sent ${email.sent}, email failed ${email.failed}, email skipped ${email.skipped}`
    );
  } catch (error) {
    return handleApiError(error, 'Failed to check stock alerts');
  }
}
