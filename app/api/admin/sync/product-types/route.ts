import { NextRequest, NextResponse } from 'next/server';
import { syncService } from '@/lib/williams-trading/sync-service';
import { verifyAdminAuth } from '@/lib/api/admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  try {
    console.log('Starting categories sync to WooCommerce...');
    const result = await syncService.syncCategories();

    return NextResponse.json({
      success: true,
      message: 'Categories sync to WooCommerce completed',
      data: result,
    });
  } catch (error) {
    console.error('Error syncing categories:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
