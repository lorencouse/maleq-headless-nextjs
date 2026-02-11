/**
 * STC Stock Sync Service (Vercel-compatible — no direct MySQL)
 *
 * Fetches STC inventory CSV, maps to WP products via the stock-mapping endpoint,
 * and applies stock updates via the stock-update endpoint.
 *
 * STC CSV contains COMBINED stock for both STC and Williams Trading products.
 * All matched products get their _stock updated (STC = total available for customers).
 */

const STC_INVENTORY_URL =
  'https://sextoy-wholesale-datafeeds.s3.amazonaws.com/sextoywholesale-inventory.csv';

interface ProductMapping {
  id: number;
  sku: string | null;
  barcode: string | null;
  source: string | null;
  stock: number | null;
  stock_status: string | null;
}

interface StockUpdatePayload {
  id: number;
  stock: number;
  status: string;
}

interface SyncResult {
  updated: number;
  failed: number;
  skipped: number;
  matched: number;
  totalCsvUpcs: number;
  totalProducts: number;
}

function normalizeUpc(upc: string): string {
  return upc.trim().replace(/^0+/, '');
}

function getWpBaseUrl(): string {
  // Use WOOCOMMERCE_URL as the WP base (same host, just different path)
  const url = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL;
  if (!url) throw new Error('WOOCOMMERCE_URL or NEXT_PUBLIC_WORDPRESS_API_URL must be set');
  // Strip /graphql suffix if present
  return url.replace(/\/graphql$/, '');
}

function getAdminKey(): string {
  const key = process.env.ADMIN_API_KEY;
  if (!key) throw new Error('ADMIN_API_KEY environment variable must be set');
  return key;
}

/**
 * Fetch product mapping from WP stock-mapping endpoint
 */
async function fetchProductMapping(): Promise<ProductMapping[]> {
  const baseUrl = getWpBaseUrl();
  const adminKey = getAdminKey();

  const response = await fetch(`${baseUrl}/wp-json/maleq/v1/stock-mapping`, {
    headers: { Authorization: `Bearer ${adminKey}` },
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch stock mapping: ${response.status} — ${text}`);
  }

  return response.json();
}

/**
 * Parse STC inventory CSV (simple inline parser — no csv-parse dependency)
 */
function parseStcCsv(csvText: string): Map<string, number> {
  const inventory = new Map<string, number>();
  const lines = csvText.split('\n');

  if (lines.length === 0) return inventory;

  // Parse header to find column indices
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const upcIdx = header.findIndex((h) => h === 'UPC');
  const qtyIdx = header.findIndex((h) => h === 'inventory_quantity');

  if (upcIdx === -1 || qtyIdx === -1) {
    throw new Error(`STC CSV missing required columns. Found: ${header.join(', ')}`);
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const upc = normalizeUpc(cols[upcIdx] || '');
    if (!upc) continue;

    const qty = parseInt(cols[qtyIdx] || '0', 10);
    inventory.set(upc, isNaN(qty) ? 0 : qty);
  }

  return inventory;
}

/**
 * Fetch STC inventory CSV from S3
 */
async function fetchStcInventory(): Promise<Map<string, number>> {
  const response = await fetch(STC_INVENTORY_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch STC inventory: ${response.status} ${response.statusText}`);
  }

  const csvText = await response.text();
  return parseStcCsv(csvText);
}

/**
 * Compute stock updates by matching products to STC inventory
 */
function computeUpdates(
  products: ProductMapping[],
  inventory: Map<string, number>
): StockUpdatePayload[] {
  const updates: StockUpdatePayload[] = [];

  for (const product of products) {
    const normalizedSku = product.sku ? normalizeUpc(product.sku) : null;
    const normalizedBarcode = product.barcode ? normalizeUpc(product.barcode) : null;

    let stcQty: number | undefined;
    if (normalizedSku && inventory.has(normalizedSku)) {
      stcQty = inventory.get(normalizedSku)!;
    } else if (normalizedBarcode && inventory.has(normalizedBarcode)) {
      stcQty = inventory.get(normalizedBarcode)!;
    }

    if (stcQty === undefined) continue;

    // Skip if stock hasn't changed
    if (product.stock === stcQty) continue;

    updates.push({
      id: product.id,
      stock: stcQty,
      status: stcQty > 0 ? 'instock' : 'outofstock',
    });
  }

  return updates;
}

/**
 * Send stock updates to WP in batches of 500
 */
async function applyUpdates(
  updates: StockUpdatePayload[]
): Promise<{ updated: number; failed: number }> {
  const baseUrl = getWpBaseUrl();
  const adminKey = getAdminKey();
  const batchSize = 500;
  let totalUpdated = 0;
  let totalFailed = 0;

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);

    const response = await fetch(`${baseUrl}/wp-json/maleq/v1/stock-update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminKey}`,
      },
      body: JSON.stringify({ updates: batch }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Stock update batch failed: ${response.status} — ${text}`);
      totalFailed += batch.length;
      continue;
    }

    const result = await response.json();
    totalUpdated += result.updated || 0;
    totalFailed += result.failed || 0;

    if (result.errors?.length > 0) {
      console.warn(`Batch errors:`, result.errors.slice(0, 5));
    }
  }

  return { updated: totalUpdated, failed: totalFailed };
}

/**
 * Run full STC stock sync
 */
export async function syncStcStock(): Promise<SyncResult> {
  console.log('[STC Sync] Starting...');

  // 1. Fetch product mapping from WP
  console.log('[STC Sync] Fetching product mapping from WP...');
  const products = await fetchProductMapping();
  console.log(`[STC Sync] Got ${products.length} products from WP`);

  // 2. Fetch STC inventory CSV
  console.log('[STC Sync] Fetching STC inventory CSV...');
  const inventory = await fetchStcInventory();
  console.log(`[STC Sync] Got ${inventory.size} UPCs from STC CSV`);

  // 3. Compute deltas
  const updates = computeUpdates(products, inventory);
  const matched = updates.length;
  console.log(`[STC Sync] ${matched} products need stock updates`);

  if (matched === 0) {
    console.log('[STC Sync] No updates needed');
    return {
      updated: 0,
      failed: 0,
      skipped: products.length,
      matched: 0,
      totalCsvUpcs: inventory.size,
      totalProducts: products.length,
    };
  }

  // 4. Apply updates
  console.log(`[STC Sync] Applying ${matched} updates...`);
  const { updated, failed } = await applyUpdates(updates);

  const result: SyncResult = {
    updated,
    failed,
    skipped: products.length - matched,
    matched,
    totalCsvUpcs: inventory.size,
    totalProducts: products.length,
  };

  console.log(`[STC Sync] Done: ${updated} updated, ${failed} failed, ${result.skipped} skipped`);
  return result;
}
