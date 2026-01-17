import { NextRequest, NextResponse } from 'next/server';
import { syncService } from '@/lib/williams-trading/sync-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max for full sync

export async function POST(request: NextRequest) {
  try {
    // Optional: Add authentication check here
    // const authHeader = request.headers.get('authorization');
    // if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // }

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
