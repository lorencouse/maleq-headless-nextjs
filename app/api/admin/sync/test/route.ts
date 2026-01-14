import { NextRequest, NextResponse } from 'next/server';
import { syncService } from '@/lib/williams-trading/sync-service';

export const dynamic = 'force-dynamic';

/**
 * Test sync endpoint - syncs just a few records for testing
 */
export async function POST(request: NextRequest) {
  try {
    console.log('Starting test sync (limited records)...');

    const result = {
      manufacturers: { added: 0, updated: 0, failed: 0 },
      productTypes: { added: 0, updated: 0, failed: 0 },
      products: { added: 0, updated: 0, failed: 0 },
    };

    // Sync manufacturers first (needed for products)
    console.log('Syncing manufacturers...');
    result.manufacturers = await syncService.syncManufacturers();
    console.log(`Manufacturers: ${result.manufacturers.added} added, ${result.manufacturers.updated} updated`);

    // Sync product types (needed for products)
    console.log('Syncing product types...');
    result.productTypes = await syncService.syncProductTypes();
    console.log(`Product types: ${result.productTypes.added} added, ${result.productTypes.updated} updated`);

    // Sync only 10 products for testing
    console.log('Syncing 10 test products...');
    result.products = await syncService.syncProducts(true, 10); // Sync 10 active products
    console.log(`Products: ${result.products.added} added, ${result.products.updated} updated`);

    return NextResponse.json({
      success: true,
      message: 'Test sync completed',
      note: 'Synced manufacturers, product types, and products',
      data: result,
    });
  } catch (error) {
    console.error('Error during test sync:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
