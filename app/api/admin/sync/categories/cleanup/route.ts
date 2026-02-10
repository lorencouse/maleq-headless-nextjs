import { NextRequest, NextResponse } from 'next/server';
import { wooClient } from '@/lib/woocommerce/client';
import { verifyAdminAuth } from '@/lib/api/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * Delete all product categories except "Uncategorized"
 * Use this to clean up before re-syncing with new slug format
 */
export async function POST(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  try {
    console.log('Starting category cleanup...');

    let page = 1;
    let totalDeleted = 0;
    let totalFailed = 0;

    while (true) {
      // Fetch categories in pages
      const categories = await wooClient.getCategories({ per_page: 100, page });

      if (categories.length === 0) break;

      console.log(`Processing page ${page}: ${categories.length} categories`);

      for (const category of categories) {
        // Skip "Uncategorized" category
        if (category.slug === 'uncategorized') {
          console.log(`Skipping: ${category.name}`);
          continue;
        }

        try {
          // Delete category (force=true to delete even if it has products)
          await fetch(
            `https://staging.maleq.com/wp-json/wc/v3/products/categories/${category.id}?force=true`,
            {
              method: 'DELETE',
              headers: {
                'Authorization': `Basic ${Buffer.from(
                  `${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`
                ).toString('base64')}`,
              },
            }
          );

          totalDeleted++;
          console.log(`Deleted: [${category.id}] ${category.name}`);
        } catch (error) {
          console.error(`Failed to delete: [${category.id}] ${category.name}:`, error);
          totalFailed++;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      if (categories.length < 100) break;
      page++;
    }

    return NextResponse.json({
      success: true,
      message: 'Category cleanup completed',
      stats: {
        deleted: totalDeleted,
        failed: totalFailed,
      },
    });
  } catch (error) {
    console.error('Error during category cleanup:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
