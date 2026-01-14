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

    console.log('Starting product types sync...');
    const result = await syncService.syncProductTypes();

    return NextResponse.json({
      success: true,
      message: 'Product types sync completed',
      data: result,
    });
  } catch (error) {
    console.error('Error syncing product types:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
