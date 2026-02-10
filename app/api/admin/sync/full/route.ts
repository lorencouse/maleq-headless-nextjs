import { NextRequest, NextResponse } from 'next/server';
import { syncService } from '@/lib/williams-trading/sync-service';
import { verifyAdminAuth } from '@/lib/api/admin-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max for full sync

export async function POST(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  try {
    // Parse request body for options
    let uploadImages = true;
    try {
      const body = await request.json();
      uploadImages = body.uploadImages !== false;
    } catch {
      // No body or invalid JSON, use defaults
    }

    console.log('Starting full sync to WooCommerce...');
    console.log('Options: uploadImages =', uploadImages);

    const result = await syncService.fullSync({ uploadImages });

    return NextResponse.json({
      success: true,
      message: 'Full sync to WooCommerce completed',
      data: result,
    });
  } catch (error) {
    console.error('Error during full sync:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
