import { NextRequest, NextResponse } from 'next/server';

import { getWordPressUrl } from '@/lib/config/wp-env';
const WP_URL = getWordPressUrl();

async function incrementViewViaSQL(productId: number): Promise<boolean> {
  try {
    const { getPoolAsync } = await import('@/lib/db/pool');

    const pool = await getPoolAsync();
    // Try to update existing row first
    const [result] = await pool.query<import('mysql2').ResultSetHeader>(
      `UPDATE wp_postmeta SET meta_value = CAST(meta_value AS UNSIGNED) + 1
       WHERE post_id = ? AND meta_key = '_view_count' LIMIT 1`,
      [productId]
    );
    // If no row existed, insert one
    if (result.affectedRows === 0) {
      await pool.query(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_view_count', '1')`,
        [productId]
      );
    }
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { productId } = await request.json();

    if (!productId || typeof productId !== 'number') {
      return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    // Try WordPress REST API first
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${WP_URL}/wp-json/maleq/v1/product-view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json(data);
      }
    } catch {
      // WordPress unreachable — fall through to SQL
    }

    // SQL fallback
    const sqlSuccess = await incrementViewViaSQL(productId);
    if (sqlSuccess) {
      return NextResponse.json({ success: true, source: 'sql' });
    }

    return NextResponse.json({ error: 'Failed to track view' }, { status: 500 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
