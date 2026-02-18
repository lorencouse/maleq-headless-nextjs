import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';
import { revalidatePath } from 'next/cache';
import type { RowDataPacket } from 'mysql2';

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { productId, imageUrl } = await request.json();

  if (!productId || !imageUrl) {
    return NextResponse.json(
      { error: `productId and imageUrl are required. Got productId=${productId}, imageUrl=${imageUrl}` },
      { status: 400 }
    );
  }

  try {
    const pool = getPool();

    // Resolve attachment ID from URL (strip to just the filename path for matching)
    const urlPath = new URL(imageUrl).pathname;
    const [attachRows] = await pool.query<RowDataPacket[]>(
      `SELECT ID FROM wp_posts
       WHERE post_type = 'attachment' AND guid LIKE ?
       LIMIT 1`,
      [`%${urlPath}`]
    );

    const imageId = attachRows[0]?.ID;
    if (!imageId) {
      return NextResponse.json(
        { error: `Attachment not found for URL: ${imageUrl}` },
        { status: 404 }
      );
    }

    // Get current thumbnail and gallery
    const [metaRows] = await pool.query<RowDataPacket[]>(
      `SELECT meta_key, meta_value FROM wp_postmeta
       WHERE post_id = ? AND meta_key IN ('_thumbnail_id', '_product_image_gallery')`,
      [productId]
    );

    const metaMap = Object.fromEntries(
      metaRows.map((r) => [r.meta_key, r.meta_value])
    );
    const oldThumbnailId = metaMap['_thumbnail_id'] || '';
    const galleryStr: string = metaMap['_product_image_gallery'] || '';

    const galleryIds = galleryStr
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);

    // Swap: new image becomes thumbnail, old thumbnail takes its place in gallery
    const newGalleryIds = galleryIds.map((id: string) =>
      id === String(imageId) ? String(oldThumbnailId) : id
    );

    await pool.query(
      `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_thumbnail_id'`,
      [String(imageId), productId]
    );

    await pool.query(
      `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
      [newGalleryIds.join(','), productId]
    );

    // Get slug for cache revalidation
    const [slugRows] = await pool.query<RowDataPacket[]>(
      `SELECT post_name FROM wp_posts WHERE ID = ?`,
      [productId]
    );
    const slug = slugRows[0]?.post_name;
    if (slug) {
      try { revalidatePath(`/product/${slug}`); } catch { /* ok in dev */ }
    }

    return NextResponse.json({ success: true, slug });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error setting default image:', message, error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
