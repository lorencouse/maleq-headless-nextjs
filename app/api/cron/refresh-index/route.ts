import { NextRequest, NextResponse } from 'next/server';
import { verifyCronOrAdminAuth } from '@/lib/api/admin-auth';
import { invalidateProductIndex } from '@/lib/products/product-index';
import { invalidateCategoryCache } from '@/lib/db/category-loader';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Safety-net product-index refresh.
 *
 * Real-time index freshness comes from /api/revalidate (WordPress webhook).
 * This endpoint exists for cases where data is mutated without the webhook
 * firing (background scripts, direct DB edits). Triggered by external cron
 * (e.g., daily on the WP VPS).
 */
export async function GET(request: NextRequest) {
  const authError = verifyCronOrAdminAuth(request);
  if (authError) return authError;

  const startedAt = Date.now();
  await invalidateProductIndex();
  invalidateCategoryCache();

  return NextResponse.json({
    success: true,
    durationMs: Date.now() - startedAt,
  });
}
