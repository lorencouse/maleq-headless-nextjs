import { NextRequest, NextResponse } from 'next/server';
import { wooClient } from '@/lib/woocommerce/client';
import { verifyAdminAuth } from '@/lib/api/admin-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

/**
 * Delete all products from WooCommerce
 * WARNING: This is destructive and cannot be undone
 */
export async function POST(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  const startTime = Date.now();

  try {
    console.log('=== Starting to delete all products ===');

    let totalDeleted = 0;
    let page = 1;
    const perPage = 100;

    while (true) {
      console.log(`Fetching products page ${page}...`);
      const products = await wooClient.getProducts({ per_page: perPage, page });

      if (products.length === 0) {
        console.log('No more products to delete');
        break;
      }

      console.log(`Found ${products.length} products on page ${page}`);

      // Delete products one by one
      for (const product of products) {
        try {
          if (product.id) {
            await wooClient.deleteProduct(product.id, true); // force=true for permanent deletion
            totalDeleted++;
            console.log(`Deleted product ${product.id}: ${product.name}`);
          }
        } catch (error) {
          console.error(`Failed to delete product ${product.id}:`, error);
        }
      }

      // If we got fewer products than requested, we're done
      if (products.length < perPage) {
        break;
      }

      page++;
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n=== Deleted ${totalDeleted} products in ${totalTime}s ===`);

    return NextResponse.json({
      success: true,
      message: `Deleted ${totalDeleted} products`,
      totalDeleted,
      duration: totalTime,
    });
  } catch (error) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.error(`\n=== Delete failed after ${elapsed}s ===`);
    console.error('Error during delete:', error);
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
