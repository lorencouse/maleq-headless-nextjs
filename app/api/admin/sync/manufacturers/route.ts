import { NextRequest, NextResponse } from 'next/server';
import { syncService } from '@/lib/williams-trading/sync-service';
import { verifyAdminAuth } from '@/lib/api/admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  try {
    console.log('Starting manufacturers sync to WooCommerce...');
    const result = await syncService.syncManufacturers();

    return NextResponse.json({
      success: true,
      message: 'Manufacturers sync to WooCommerce completed',
      data: result,
    });
  } catch (error) {
    console.error('Error syncing manufacturers:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
