#!/usr/bin/env bun

/**
 * Generate Product Link Mapping Report
 *
 * Creates a detailed document showing:
 * - Old links and their proposed new links/SKUs
 * - Unmatched links that need manual review
 */

import mysql from 'mysql2/promise';
import { writeFileSync } from 'fs';

const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

interface MatchedUrl {
  postId: number;
  postTitle: string;
  postType: string;
  oldUrl: string;
  oldSlug: string;
  newUrl: string;
  productName: string;
  sku: string;
}

interface UnmatchedUrl {
  postId: number;
  postTitle: string;
  postType: string;
  oldUrl: string;
  oldSlug: string;
}

interface MatchedShortcode {
  postId: number;
  postTitle: string;
  postType: string;
  oldShortcode: string;
  oldProductId: number;
  newShortcode: string;
  productName: string;
  sku: string;
  newUrl: string;
}

interface UnmatchedShortcode {
  postId: number;
  postTitle: string;
  postType: string;
  oldShortcode: string;
  oldProductId: number;
}

async function main() {
  const connection = await mysql.createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });

  console.log('Loading products...');

  // Get all products with SKUs
  const [products] = await connection.execute(`
    SELECT
      p.ID as id,
      p.post_name as slug,
      p.post_title as name,
      MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) as sku
    FROM wp_posts p
    LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
    WHERE p.post_type IN ('product', 'product_variation')
    AND p.post_status = 'publish'
    GROUP BY p.ID
  `) as [any[], any];

  const productBySlug = new Map<string, any>();
  const productById = new Map<number, any>();

  for (const p of products) {
    if (p.slug) {
      productBySlug.set(p.slug.toLowerCase(), p);
    }
    productById.set(p.id, p);
  }

  console.log(`Loaded ${products.length} products`);

  // Get posts with links
  const [posts] = await connection.execute(`
    SELECT ID, post_title, post_type, post_content
    FROM wp_posts
    WHERE post_type IN ('post', 'wp_block')
    AND post_status = 'publish'
    AND (
      post_content LIKE '%maleq%/product/%'
      OR post_content LIKE '%add_to_cart%'
    )
  `) as [any[], any];

  console.log(`Processing ${posts.length} posts...`);

  const matchedUrls: MatchedUrl[] = [];
  const unmatchedUrls: UnmatchedUrl[] = [];
  const matchedShortcodes: MatchedShortcode[] = [];
  const unmatchedShortcodes: UnmatchedShortcode[] = [];

  for (const post of posts) {
    const content = post.post_content || '';

    // Extract URLs
    const urlRegex = /https?:\/\/[^"'\s<>]*(?:maleq[^"'\s<>]*|maleq-local\.local)\/product\/([^"'\s<>\/\?#]+)[^"'\s<>]*/gi;
    let match;
    while ((match = urlRegex.exec(content)) !== null) {
      const oldUrl = match[0];
      const slug = match[1].toLowerCase();
      const product = productBySlug.get(slug);

      if (product) {
        matchedUrls.push({
          postId: post.ID,
          postTitle: post.post_title,
          postType: post.post_type,
          oldUrl,
          oldSlug: slug,
          newUrl: `/shop/product/${product.slug}`,
          productName: product.name,
          sku: product.sku || 'N/A',
        });
      } else {
        unmatchedUrls.push({
          postId: post.ID,
          postTitle: post.post_title,
          postType: post.post_type,
          oldUrl,
          oldSlug: slug,
        });
      }
    }

    // Extract shortcodes
    const scRegex = /\[add_to_cart\s+id="?(\d+)"?\]/gi;
    while ((match = scRegex.exec(content)) !== null) {
      const oldShortcode = match[0];
      const productId = parseInt(match[1], 10);
      const product = productById.get(productId);

      if (product) {
        matchedShortcodes.push({
          postId: post.ID,
          postTitle: post.post_title,
          postType: post.post_type,
          oldShortcode,
          oldProductId: productId,
          newShortcode: product.sku
            ? `[add_to_cart sku="${product.sku}"]`
            : `<a href="/shop/product/${product.slug}">View Product</a>`,
          productName: product.name,
          sku: product.sku || 'N/A',
          newUrl: `/shop/product/${product.slug}`,
        });
      } else {
        unmatchedShortcodes.push({
          postId: post.ID,
          postTitle: post.post_title,
          postType: post.post_type,
          oldShortcode,
          oldProductId: productId,
        });
      }
    }
  }

  // Generate markdown report
  const lines: string[] = [];

  lines.push('# Product Link Migration - Detailed Mapping');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Matched URLs:** ${matchedUrls.length}`);
  lines.push(`- **Unmatched URLs:** ${unmatchedUrls.length}`);
  lines.push(`- **Matched Shortcodes:** ${matchedShortcodes.length}`);
  lines.push(`- **Unmatched Shortcodes:** ${unmatchedShortcodes.length}`);
  lines.push('');

  // Matched URLs section
  lines.push('---');
  lines.push('');
  lines.push('## Matched URLs - Ready to Update');
  lines.push('');
  lines.push('These URLs have been matched to existing products and can be updated:');
  lines.push('');

  // Deduplicate by old slug and show unique mappings
  const uniqueMatchedUrls = new Map<string, MatchedUrl>();
  for (const item of matchedUrls) {
    if (!uniqueMatchedUrls.has(item.oldSlug)) {
      uniqueMatchedUrls.set(item.oldSlug, item);
    }
  }

  lines.push('| Old Slug | New URL | Product Name | SKU |');
  lines.push('|----------|---------|--------------|-----|');

  for (const item of uniqueMatchedUrls.values()) {
    const name =
      item.productName.length > 40
        ? item.productName.substring(0, 40) + '...'
        : item.productName;
    lines.push(`| ${item.oldSlug} | ${item.newUrl} | ${name} | ${item.sku} |`);
  }

  lines.push('');

  // Matched Shortcodes section
  lines.push('---');
  lines.push('');
  lines.push('## Matched Shortcodes - Ready to Update');
  lines.push('');
  lines.push('These shortcodes have been matched to existing products:');
  lines.push('');

  // Deduplicate by old product ID
  const uniqueMatchedSc = new Map<number, MatchedShortcode>();
  for (const item of matchedShortcodes) {
    if (!uniqueMatchedSc.has(item.oldProductId)) {
      uniqueMatchedSc.set(item.oldProductId, item);
    }
  }

  lines.push('| Old Product ID | Old Shortcode | New Shortcode | Product Name | SKU |');
  lines.push('|----------------|---------------|---------------|--------------|-----|');

  for (const item of uniqueMatchedSc.values()) {
    const name =
      item.productName.length > 30
        ? item.productName.substring(0, 30) + '...'
        : item.productName;
    const newSc =
      item.sku !== 'N/A'
        ? `[add_to_cart sku="${item.sku}"]`
        : `Link: ${item.newUrl}`;
    lines.push(
      `| ${item.oldProductId} | ${item.oldShortcode} | ${newSc} | ${name} | ${item.sku} |`
    );
  }

  lines.push('');

  // Unmatched URLs section
  lines.push('---');
  lines.push('');
  lines.push('## Unmatched URLs - Need Manual Review');
  lines.push('');
  lines.push(
    'These product slugs do not exist in the current database. The products may have been discontinued or renamed.'
  );
  lines.push('');
  lines.push('| Old Slug | Posts Using This Link |');
  lines.push('|----------|----------------------|');

  // Group by slug
  const unmatchedUrlsBySlug = new Map<string, UnmatchedUrl[]>();
  for (const item of unmatchedUrls) {
    if (!unmatchedUrlsBySlug.has(item.oldSlug)) {
      unmatchedUrlsBySlug.set(item.oldSlug, []);
    }
    unmatchedUrlsBySlug.get(item.oldSlug)!.push(item);
  }

  for (const [slug, items] of unmatchedUrlsBySlug) {
    const postList = items
      .slice(0, 3)
      .map((i) => `${i.postId}`)
      .join(', ');
    const more = items.length > 3 ? ` (+${items.length - 3} more)` : '';
    lines.push(`| ${slug} | Post IDs: ${postList}${more} |`);
  }

  lines.push('');

  // Unmatched Shortcodes section
  lines.push('---');
  lines.push('');
  lines.push('## Unmatched Shortcodes - Need Manual Review');
  lines.push('');
  lines.push('These product IDs do not exist in the current database:');
  lines.push('');
  lines.push('| Old Product ID | Posts Using This |');
  lines.push('|----------------|------------------|');

  // Group by product ID
  const unmatchedScById = new Map<number, UnmatchedShortcode[]>();
  for (const item of unmatchedShortcodes) {
    if (!unmatchedScById.has(item.oldProductId)) {
      unmatchedScById.set(item.oldProductId, []);
    }
    unmatchedScById.get(item.oldProductId)!.push(item);
  }

  for (const [productId, items] of unmatchedScById) {
    const postList = items
      .slice(0, 3)
      .map((i) => `${i.postId}`)
      .join(', ');
    const more = items.length > 3 ? ` (+${items.length - 3} more)` : '';
    lines.push(`| ${productId} | Post IDs: ${postList}${more} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Next Steps');
  lines.push('');
  lines.push(
    '1. **For matched items:** Run `bun scripts/update-product-links.ts --execute` to apply changes'
  );
  lines.push(
    '2. **For unmatched URLs:** Either find replacement products or remove the broken links'
  );
  lines.push(
    '3. **For unmatched shortcodes:** Either find replacement products or convert to text/remove'
  );
  lines.push('');

  const reportPath =
    '/Volumes/Mac Mini M4 -2TB/MacMini-Data/Documents/web-dev/maleq-headless/docs/product-link-mapping.md';
  writeFileSync(reportPath, lines.join('\n'));

  console.log(`\nReport saved to: ${reportPath}`);
  console.log(
    `\nMatched: ${uniqueMatchedUrls.size} unique URLs, ${uniqueMatchedSc.size} unique shortcodes`
  );
  console.log(
    `Unmatched: ${unmatchedUrlsBySlug.size} unique URL slugs, ${unmatchedScById.size} unique shortcode IDs`
  );

  await connection.end();
}

main().catch(console.error);
