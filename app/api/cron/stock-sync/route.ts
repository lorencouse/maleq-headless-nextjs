import { NextRequest, NextResponse } from 'next/server';
import { verifyCronOrAdminAuth } from '@/lib/api/admin-auth';
import { syncStcStock } from '@/lib/stc/sync-service';
import { syncService } from '@/lib/williams-trading/sync-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Daily stock sync cron endpoint.
 *
 * 1. STC sync — updates _stock for ALL matched products (STC CSV = combined total)
 * 2. WT stock meta — stores wt_stock_count on WT products (for fulfillment prioritization)
 *
 * Triggered by Vercel cron (daily 6 AM UTC) or manually via ADMIN_API_KEY.
 */
export async function GET(request: NextRequest) {
  const authError = verifyCronOrAdminAuth(request);
  if (authError) return authError;

  const startTime = Date.now();

  try {
    // 1. STC stock sync (updates _stock for all products)
    console.log('[Cron] Starting STC stock sync...');
    const stcResult = await syncStcStock();

    // 2. WT stock meta sync (stores wt_stock_count for WT products)
    console.log('[Cron] Starting WT stock meta sync...');
    const wtResult = await syncService.syncWTStockMeta();

    const duration = Math.round((Date.now() - startTime) / 1000);

    return NextResponse.json({
      success: true,
      duration: `${duration}s`,
      stc: stcResult,
      wt: wtResult,
    });
  } catch (error) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    console.error('[Cron] Stock sync failed:', error);

    return NextResponse.json(
      {
        success: false,
        duration: `${duration}s`,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
