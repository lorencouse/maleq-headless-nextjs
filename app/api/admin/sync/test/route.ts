import { NextRequest, NextResponse } from 'next/server';
import { syncService } from '@/lib/williams-trading/sync-service';
import { verifyAdminAuth } from '@/lib/api/admin-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for test sync (allows time for image uploads)

/**
 * Test sync endpoint - syncs just a few records for testing
 * Tests WooCommerce connection and syncs limited data
 */
export async function POST(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  const startTime = Date.now();

  try {
    console.log('=== Starting test sync to WooCommerce (limited records) ===');

    // First test the WooCommerce connection
    console.log('[1/4] Testing WooCommerce connection...');
    const connected = await syncService.testConnection();
    if (!connected) {
      return NextResponse.json({
        success: false,
        error: 'Could not connect to WooCommerce. Check your API credentials.',
      }, { status: 500 });
    }
    console.log('✓ WooCommerce connection successful!');

    const result = {
      categories: { added: 0, updated: 0, failed: 0 },
      manufacturers: { added: 0, updated: 0, failed: 0 },
      products: { added: 0, updated: 0, failed: 0 },
    };

    // Sync categories first (needed for products)
    console.log('\n[2/4] Syncing categories to WooCommerce...');
    const catStart = Date.now();
    result.categories = await syncService.syncCategories();
    console.log(`✓ Categories completed in ${Math.round((Date.now() - catStart) / 1000)}s: ${result.categories.added} added, ${result.categories.updated} updated, ${result.categories.failed} failed`);

    // Sync manufacturers
    console.log('\n[3/4] Syncing manufacturers to WooCommerce...');
    const mfrStart = Date.now();
    result.manufacturers = await syncService.syncManufacturers();
    console.log(`✓ Manufacturers completed in ${Math.round((Date.now() - mfrStart) / 1000)}s: ${result.manufacturers.added} added, ${result.manufacturers.updated} updated, ${result.manufacturers.failed} failed`);

    // Sync only 10 products for testing
    console.log('\n[4/4] Syncing 10 test products to WooCommerce (without images for now)...');
    const prodStart = Date.now();
    result.products = await syncService.syncProducts({ activeOnly: true, limit: 10, uploadImages: false });
    console.log(`✓ Products completed in ${Math.round((Date.now() - prodStart) / 1000)}s: ${result.products.added} added, ${result.products.updated} updated, ${result.products.failed} failed`);

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n=== Test sync completed in ${totalTime}s ===`);

    return NextResponse.json({
      success: true,
      message: 'Test sync to WooCommerce completed',
      note: 'Synced categories, manufacturers, and 10 products',
      duration: totalTime,
      data: result,
    });
  } catch (error) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.error(`\n=== Test sync failed after ${elapsed}s ===`);
    console.error('Error during test sync:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        elapsed,
      },
      { status: 500 }
    );
  }
}
