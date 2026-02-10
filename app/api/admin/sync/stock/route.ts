import { NextRequest, NextResponse } from 'next/server';
import { syncService } from '@/lib/williams-trading/sync-service';
import { verifyAdminAuth } from '@/lib/api/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * Stock update endpoint - used for hourly updates
 * Updates stock quantities in WooCommerce via batch API
 */
export async function POST(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  try {
    console.log('Starting stock update to WooCommerce...');
    const result = await syncService.updateStock();

    return NextResponse.json({
      success: true,
      message: 'Stock update to WooCommerce completed',
      data: result,
    });
  } catch (error) {
    console.error('Error updating stock:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
