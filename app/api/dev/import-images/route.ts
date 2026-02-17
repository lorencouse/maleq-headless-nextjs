import { NextRequest, NextResponse } from 'next/server';
import { createConnection, Connection } from 'mysql2/promise';
import { ImageProcessor } from '@/lib/import/image-processor';
import { XMLParser, XMLProduct } from '@/lib/import/xml-parser';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { readFile as readFileAsync } from 'fs/promises';
import { join, dirname } from 'path';

// Module-level caches (persist across requests while dev server runs)
let stcImageCache: Map<string, string[]> | null = null;
let mcProductCache: Map<string, XMLProduct> | null = null;

/**
 * Parse a CSV line respecting quoted fields (handles commas inside quotes)
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Load STC images from both stc-images.csv and stc-products.csv.
 */
function loadSTCImages(): Map<string, string[]> {
  if (stcImageCache) return stcImageCache;
  stcImageCache = new Map();

  // 1. stc-images.csv (simple: upc,image1,image2,image3,image4)
  const simpleCSVPath = join(process.cwd(), 'data', 'stc-images.csv');
  if (existsSync(simpleCSVPath)) {
    const lines = readFileSync(simpleCSVPath, 'utf-8').split('\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const [upc, ...imageCols] = line.split(',');
      if (!upc) continue;
      const images = imageCols.map(u => u.trim()).filter(u => u.length > 0);
      if (images.length > 0) {
        stcImageCache.set(upc.trim(), images);
      }
    }
  }

  // 2. stc-products.csv (full catalog, quoted CSV)
  //    UPC = col 1, Image 1/2/3 = cols 17/18/19
  const fullCSVPath = join(process.cwd(), 'data', 'stc-products.csv');
  if (existsSync(fullCSVPath)) {
    const lines = readFileSync(fullCSVPath, 'utf-8').split('\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const fields = parseCSVLine(line);
      const upc = (fields[1] || '').trim();
      if (!upc || stcImageCache.has(upc)) continue;

      const images: string[] = [];
      for (const idx of [17, 18, 19]) {
        const url = (fields[idx] || '').trim();
        if (url) images.push(url);
      }
      if (images.length > 0) {
        stcImageCache.set(upc, images);
      }
    }
  }

  console.log(`[DevImageImport] Loaded ${stcImageCache.size} STC image entries`);
  return stcImageCache;
}

/**
 * Load MC/Williams Trading XML products into a Map keyed by barcode
 */
async function loadMCProducts(): Promise<Map<string, XMLProduct>> {
  if (mcProductCache) return mcProductCache;

  const xmlPath = join(process.cwd(), 'data', 'products-filtered.xml');
  const parser = new XMLParser(xmlPath);
  const products = await parser.parseProducts();

  mcProductCache = new Map();
  for (const product of products) {
    if (product.barcode) {
      mcProductCache.set(product.barcode.trim(), product);
    }
  }

  console.log(`[DevImageImport] Loaded ${mcProductCache.size} MC product entries`);
  return mcProductCache;
}

/**
 * Get existing attachment file paths for a product.
 * Returns the _wp_attached_file values for the thumbnail + gallery attachments.
 */
async function getExistingAttachmentPaths(
  connection: Connection,
  productId: number
): Promise<{ attachmentId: number; filePath: string }[]> {
  // Get thumbnail ID
  const [thumbRows] = await connection.execute(
    `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_thumbnail_id'`,
    [productId]
  );
  const thumbId = (thumbRows as any[])[0]?.meta_value;

  // Get gallery IDs (comma-separated)
  const [galleryRows] = await connection.execute(
    `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
    [productId]
  );
  const galleryValue = (galleryRows as any[])[0]?.meta_value || '';

  // Collect all attachment IDs (thumbnail first, then gallery)
  const attachmentIds: number[] = [];
  if (thumbId && thumbId !== '0' && thumbId !== '') {
    attachmentIds.push(parseInt(thumbId));
  }
  if (galleryValue) {
    for (const id of galleryValue.split(',')) {
      const parsed = parseInt(id.trim());
      if (parsed && !attachmentIds.includes(parsed)) {
        attachmentIds.push(parsed);
      }
    }
  }

  if (attachmentIds.length === 0) return [];

  // Get the _wp_attached_file for each attachment
  const placeholders = attachmentIds.map(() => '?').join(',');
  const [fileRows] = await connection.execute(
    `SELECT post_id, meta_value FROM wp_postmeta
     WHERE meta_key = '_wp_attached_file' AND post_id IN (${placeholders})`,
    attachmentIds
  );

  // Return in the same order as attachmentIds
  const fileMap = new Map<number, string>();
  for (const row of fileRows as any[]) {
    fileMap.set(row.post_id, row.meta_value);
  }

  return attachmentIds
    .filter(id => fileMap.has(id))
    .map(id => ({ attachmentId: id, filePath: fileMap.get(id)! }));
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Dev only' }, { status: 403 });
  }

  const { slug } = await request.json();
  if (!slug || typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
  }

  const socketPath = process.env.DEV_MYSQL_SOCKET;
  const uploadsDir = process.env.DEV_WP_UPLOADS_DIR;

  if (!socketPath || !uploadsDir) {
    return NextResponse.json(
      { error: 'Missing DEV_MYSQL_SOCKET or DEV_WP_UPLOADS_DIR env vars' },
      { status: 500 }
    );
  }

  let connection: Connection | null = null;

  try {
    connection = await createConnection({
      socketPath,
      user: 'root',
      password: 'root',
      database: 'local',
    });

    // 1. Look up product by slug
    const [productRows] = await connection.execute(
      `SELECT ID, post_title, post_name, post_type, post_parent
       FROM wp_posts
       WHERE post_name = ? AND post_type IN ('product', 'product_variation') AND post_status = 'publish'
       LIMIT 1`,
      [slug]
    );

    const product = (productRows as any[])[0];
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const productId = product.ID;
    const productName = product.post_title;

    // 2. Get existing attachment paths from DB
    const existingAttachments = await getExistingAttachmentPaths(connection, productId);

    if (existingAttachments.length === 0) {
      return NextResponse.json({ error: 'No attachment records in DB for this product' }, { status: 404 });
    }

    // 3. Check if first attachment file already exists on disk
    const firstFilePath = join(uploadsDir, existingAttachments[0].filePath);
    if (existsSync(firstFilePath)) {
      return NextResponse.json({ success: true, skipped: true, message: 'Images already exist on disk' });
    }

    // 4. Get product SKU and source meta
    const [metaRows] = await connection.execute(
      `SELECT meta_key, meta_value FROM wp_postmeta
       WHERE post_id = ? AND meta_key IN ('_sku', '_product_source', 'product_source')`,
      [productId]
    );

    const meta: Record<string, string> = {};
    for (const row of metaRows as any[]) {
      meta[row.meta_key] = row.meta_value;
    }

    const sku = (meta._sku || '').trim();
    if (!sku) {
      return NextResponse.json({ error: 'Product has no SKU' }, { status: 404 });
    }

    // product_source='MUFFS' → XML, otherwise → STC CSV
    const isMuffs = meta.product_source === 'MUFFS';

    let sourceImageUrls: string[] = [];
    let baseImageUrl: string | undefined;

    if (isMuffs) {
      const mcProducts = await loadMCProducts();
      const xmlProduct = mcProducts.get(sku);
      if (xmlProduct && xmlProduct.images.length > 0) {
        sourceImageUrls = xmlProduct.images;
        baseImageUrl = 'http://images.williams-trading.com/product_images';
      }
    } else {
      const stcImages = loadSTCImages();
      const stcMatch = stcImages.get(sku);
      if (stcMatch && stcMatch.length > 0) {
        sourceImageUrls = stcMatch;
      }
    }

    if (sourceImageUrls.length === 0) {
      return NextResponse.json(
        { error: `No images found for SKU: ${sku} (source: ${isMuffs ? 'MUFFS/XML' : 'STC/CSV'})` },
        { status: 404 }
      );
    }

    // 5. Download and process source images via ImageProcessor
    const imageProcessor = new ImageProcessor();
    await imageProcessor.init();

    const processedImages = await imageProcessor.processProductImages(
      sourceImageUrls,
      productName,
      baseImageUrl
    );

    if (processedImages.length === 0) {
      return NextResponse.json({ error: 'No images could be processed' }, { status: 500 });
    }

    // 6. Save processed images to the EXACT paths the existing DB records expect
    const savedImages: string[] = [];
    const count = Math.min(processedImages.length, existingAttachments.length);

    for (let i = 0; i < count; i++) {
      const processed = processedImages[i];
      const attachment = existingAttachments[i];
      const targetPath = join(uploadsDir, attachment.filePath);

      // Ensure target directory exists
      const targetDir = dirname(targetPath);
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      // Read processed image from cache and write to expected WP path
      const imageBuffer = await readFileAsync(processed.localPath);
      writeFileSync(targetPath, imageBuffer);

      savedImages.push(attachment.filePath);
    }

    console.log(`[DevImageImport] Saved ${savedImages.length} images for "${productName}" (${slug})`);

    return NextResponse.json({
      success: true,
      images: savedImages,
      count: savedImages.length,
    });
  } catch (error) {
    console.error('[DevImageImport] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}
