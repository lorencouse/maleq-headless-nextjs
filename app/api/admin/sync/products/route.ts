import { NextRequest, NextResponse } from 'next/server';
import { syncService } from '@/lib/williams-trading/sync-service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Optional: Add authentication check here
    // const authHeader = request.headers.get('authorization');
    // if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // }

    console.log('Starting products sync...');
    const result = await syncService.syncProducts();

    return NextResponse.json({
      success: true,
      message: 'Products sync completed',
      data: result,
    });
  } catch (error) {
    console.error('Error syncing products:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
