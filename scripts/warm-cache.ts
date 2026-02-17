/**
 * Post-deploy cache warming script.
 *
 * Warms ISR cache by hitting category pages first, then top products by view count.
 * Reads product slugs directly from MySQL (or from in-memory index via API).
 *
 * Usage:
 *   SITE_URL=https://maleq.com bun run scripts/warm-cache.ts
 *   SITE_URL=https://maleq.com bun run scripts/warm-cache.ts --categories-only
 *   SITE_URL=https://maleq.com bun run scripts/warm-cache.ts --limit 500
 */
import { getConnection } from './lib/db';

const SITE_URL = process.env.SITE_URL || 'https://maleq.com';
const CONCURRENCY = 3;
const DELAY_MS = 200;
const categoriesOnly = process.argv.includes('--categories-only');

function getLimitArg(): number {
  const idx = process.argv.indexOf('--limit');
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return parseInt(process.argv[idx + 1], 10) || 200;
  }
  return 200;
}

const productLimit = getLimitArg();

async function fetchUrl(url: string): Promise<{ url: string; status: number; ms: number }> {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MaleQ-CacheWarmer/1.0' },
      redirect: 'follow',
    });
    const ms = Math.round(performance.now() - start);
    return { url, status: res.status, ms };
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    console.error(`  FAIL ${url}: ${err}`);
    return { url, status: 0, ms };
  }
}

async function warmBatch(urls: string[]): Promise<void> {
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(fetchUrl));
    for (const r of results) {
      const status = r.status === 200 ? '✓' : `✗ ${r.status}`;
      console.log(`  ${status} ${r.url} (${r.ms}ms)`);
    }
    if (i + CONCURRENCY < urls.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }
}

async function main() {
  console.log(`\n🔥 Cache Warming: ${SITE_URL}\n`);

  const db = await getConnection();

  try {
    // 1. Warm category pages
    console.log('📁 Warming category pages...');
    const [catRows] = await db.query(
      `SELECT t.slug
       FROM wp_term_taxonomy tt
       JOIN wp_terms t ON tt.term_id = t.term_id
       WHERE tt.taxonomy = 'product_cat' AND tt.count > 0
       ORDER BY tt.count DESC`
    );
    const categorySlugs = (catRows as { slug: string }[]).map(r => r.slug);
    const categoryUrls = categorySlugs.map(s => `${SITE_URL}/product-category/${s}`);
    // Also warm the shop page with category filter
    const shopCategoryUrls = categorySlugs.slice(0, 20).map(s => `${SITE_URL}/shop?category=${s}`);

    await warmBatch([`${SITE_URL}/shop`, ...shopCategoryUrls]);
    console.log(`  Warmed shop + ${shopCategoryUrls.length} category-filtered pages\n`);

    await warmBatch(categoryUrls);
    console.log(`  Warmed ${categoryUrls.length} category pages\n`);

    if (categoriesOnly) {
      console.log('Done (categories only).\n');
      await db.end();
      return;
    }

    // 2. Warm top product pages by view count / sales
    console.log(`📦 Warming top ${productLimit} product pages...`);
    const [productRows] = await db.query(
      `SELECT p.post_name
       FROM wp_posts p
       LEFT JOIN wp_wc_product_meta_lookup lk ON lk.product_id = p.ID
       LEFT JOIN wp_postmeta vc ON vc.post_id = p.ID AND vc.meta_key = 'view_count'
       WHERE p.post_type = 'product' AND p.post_status = 'publish'
       ORDER BY (COALESCE(lk.total_sales, 0) * 3 + COALESCE(CAST(vc.meta_value AS UNSIGNED), 0)) DESC
       LIMIT ?`,
      [productLimit]
    );
    const productSlugs = (productRows as { post_name: string }[]).map(r => r.post_name);
    const productUrls = productSlugs.map(s => `${SITE_URL}/product/${s}`);

    await warmBatch(productUrls);
    console.log(`  Warmed ${productUrls.length} product pages\n`);

    // 3. Warm key static pages
    console.log('📄 Warming static pages...');
    const staticPages = [
      '/',
      '/guides',
      '/contact',
      '/about',
    ];
    await warmBatch(staticPages.map(p => `${SITE_URL}${p}`));
    console.log();

    console.log('✅ Cache warming complete.\n');
  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error('Cache warming failed:', err);
  process.exit(1);
});
