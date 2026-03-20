import { NextRequest } from 'next/server';
import { verifyCronOrAdminAuth } from '@/lib/api/admin-auth';
import {
  successResponse,
  handleApiError,
} from '@/lib/api/response';
import { sendDueCartRecoveryEmails } from '@/lib/cart-recovery/service';

export async function GET(request: NextRequest) {
  const authError = verifyCronOrAdminAuth(request);
  if (authError) return authError;

  try {
    const result = await sendDueCartRecoveryEmails();
    return successResponse(
      result,
      `Cart recovery emails: sent ${result.sent}, failed ${result.failed}, skipped ${result.skipped}`
    );
  } catch (error) {
    return handleApiError(error, 'Failed to send cart recovery emails');
  }
}
