import { NextRequest, NextResponse } from 'next/server';
import { syncService } from '@/lib/williams-trading/sync-service';
import { verifyAdminAuth } from '@/lib/api/admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  try {
    console.log('Starting full category hierarchy sync to WooCommerce...');
    const startTime = Date.now();

    const stats = await syncService.syncCategoryHierarchy();

    const duration = Math.round((Date.now() - startTime) / 1000);

    return NextResponse.json({
      success: true,
      message: 'Category hierarchy sync to WooCommerce completed',
      stats: {
        ...stats,
        duration: `${duration}s`,
      },
    });
  } catch (error) {
    console.error('Error syncing category hierarchy:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
