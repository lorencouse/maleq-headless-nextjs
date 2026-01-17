import { NextRequest, NextResponse } from 'next/server';
import { syncService } from '@/lib/williams-trading/sync-service';

export const dynamic = 'force-dynamic';

/**
 * Stock update endpoint - used for hourly updates
 * Updates stock quantities in WooCommerce via batch API
 */
export async function POST(request: NextRequest) {
  try {
    // Optional: Add authentication check here
    // const authHeader = request.headers.get('authorization');
    // if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // }

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
