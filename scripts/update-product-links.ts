#!/usr/bin/env bun

/**
 * Update Product Links Script
 *
 * Updates product links and shortcodes in WordPress blog posts and reusable blocks
 * to use the new headless site URL format and SKU-based references.
 *
 * Usage:
 *   bun scripts/update-product-links.ts [options]
 *
 * Options:
 *   --dry-run    Show what would be updated without making changes (default)
 *   --execute    Actually perform the updates
 *   --report     Generate detailed report only
 */

import mysql from 'mysql2/promise';
import { writeFileSync } from 'fs';

// Configuration
const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

// New site URL format
const NEW_PRODUCT_URL_BASE = '/shop/product/';

// URL patterns to match (maleq domains and local)
const OLD_URL_PATTERNS = [
  /https?:\/\/(?:www\.)?maleq\.(?:com|org|local)\/product\//gi,
  /https?:\/\/maleq-local\.local\/product\//gi,
  /https?:\/\/[^"'\s<>]*maleq[^"'\s<>]*\/product\//gi,
];

interface Product {
  id: number;
  slug: string;
  sku: string | null;
  name: string;
  type: string;
  parentId: number | null;
}

interface PostToUpdate {
  id: number;
  title: string;
  type: string;
  content: string;
  originalContent: string;
  urlMatches: Array<{
    original: string;
    slug: string;
    matched: boolean;
    newUrl?: string;
    product?: Product;
  }>;
  shortcodeMatches: Array<{
    original: string;
    productId: string;
    matched: boolean;
    newShortcode?: string;
    product?: Product;
  }>;
}

interface MigrationStats {
  postsScanned: number;
  postsWithLinks: number;
  urlsFound: number;
  urlsMatched: number;
  urlsUnmatched: number;
  shortcodesFound: number;
  shortcodesMatched: number;
  shortcodesUnmatched: number;
  postsUpdated: number;
}

async function getProducts(connection: mysql.Connection): Promise<Map<string, Product>> {
  console.log('📦 Loading products from database...');

  // Get all products with their SKUs
  const [products] = await connection.execute(`
    SELECT
      p.ID as id,
      p.post_name as slug,
      p.post_title as name,
      p.post_type as type,
      p.post_parent as parentId,
      MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) as sku
    FROM wp_posts p
    LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
    WHERE p.post_type IN ('product', 'product_variation')
    AND p.post_status = 'publish'
    GROUP BY p.ID
  `) as [any[], any];

  const productMap = new Map<string, Product>();
  const productByIdMap = new Map<number, Product>();
  const productBySlugMap = new Map<string, Product>();
  const productBySkuMap = new Map<string, Product>();

  for (const row of products) {
    const product: Product = {
      id: row.id,
      slug: row.slug,
      sku: row.sku,
      name: row.name,
      type: row.type,
      parentId: row.parentId,
    };

    productByIdMap.set(product.id, product);
    productBySlugMap.set(product.slug.toLowerCase(), product);
    if (product.sku) {
      productBySkuMap.set(product.sku.toLowerCase(), product);
    }
  }

  console.log(`   Found ${productByIdMap.size} products`);
  console.log(`   ${productBySkuMap.size} have SKUs`);

  // Return a combined map with different lookup strategies
  return new Map([
    ...Array.from(productByIdMap.entries()).map(([k, v]) => [`id:${k}`, v] as [string, Product]),
    ...Array.from(productBySlugMap.entries()).map(([k, v]) => [`slug:${k}`, v] as [string, Product]),
    ...Array.from(productBySkuMap.entries()).map(([k, v]) => [`sku:${k}`, v] as [string, Product]),
  ]);
}

function findProductBySlug(productMap: Map<string, Product>, slug: string): Product | undefined {
  // Try exact match first
  let product = productMap.get(`slug:${slug.toLowerCase()}`);
  if (product) return product;

  // Try without trailing characters
  const cleanSlug = slug.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  product = productMap.get(`slug:${cleanSlug}`);
  if (product) return product;

  // Try partial match (slug might be truncated)
  for (const [key, p] of productMap.entries()) {
    if (key.startsWith('slug:') && key.includes(cleanSlug)) {
      return p;
    }
  }

  return undefined;
}

function findProductById(productMap: Map<string, Product>, id: number): Product | undefined {
  return productMap.get(`id:${id}`);
}

async function getPostsWithProductLinks(connection: mysql.Connection): Promise<any[]> {
  console.log('📝 Finding posts with product links...');

  const [rows] = await connection.execute(`
    SELECT ID, post_title, post_type, post_content
    FROM wp_posts
    WHERE post_type IN ('post', 'wp_block')
    AND post_status = 'publish'
    AND (
      post_content LIKE '%maleq%/product/%'
      OR post_content LIKE '%/shop/%'
      OR post_content LIKE '%add_to_cart%'
      OR post_content LIKE '%[product %'
      OR post_content LIKE '%[products %'
    )
  `) as [any[], any];

  console.log(`   Found ${rows.length} posts/blocks to process`);
  return rows;
}

function extractProductUrls(content: string): Array<{ original: string; slug: string }> {
  const results: Array<{ original: string; slug: string }> = [];
  const seen = new Set<string>();

  // Match product URLs
  const urlRegex = /https?:\/\/[^"'\s<>]*(?:maleq[^"'\s<>]*|maleq-local\.local)\/product\/([^"'\s<>\/\?#]+)[^"'\s<>]*/gi;

  let match;
  while ((match = urlRegex.exec(content)) !== null) {
    const original = match[0];
    const slug = match[1];

    if (!seen.has(original)) {
      seen.add(original);
      results.push({ original, slug });
    }
  }

  return results;
}

function extractShortcodes(content: string): Array<{ original: string; productId: string }> {
  const results: Array<{ original: string; productId: string }> = [];
  const seen = new Set<string>();

  // Match add_to_cart shortcodes
  const shortcodeRegex = /\[add_to_cart\s+id="?(\d*)"?\]/gi;

  let match;
  while ((match = shortcodeRegex.exec(content)) !== null) {
    const original = match[0];
    const productId = match[1];

    if (!seen.has(original) && productId) {
      seen.add(original);
      results.push({ original, productId });
    }
  }

  return results;
}

function updateContent(post: PostToUpdate): string {
  let content = post.originalContent;

  // Update URLs
  for (const urlMatch of post.urlMatches) {
    if (urlMatch.matched && urlMatch.newUrl) {
      content = content.split(urlMatch.original).join(urlMatch.newUrl);
    }
  }

  // Update shortcodes
  for (const scMatch of post.shortcodeMatches) {
    if (scMatch.matched && scMatch.newShortcode) {
      content = content.split(scMatch.original).join(scMatch.newShortcode);
    }
  }

  return content;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const reportOnly = args.includes('--report');

  console.log('🔗 Product Link Migration Script');
  console.log('='.repeat(50));

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made');
    console.log('   Use --execute to perform actual updates\n');
  } else {
    console.log('⚠️  EXECUTE MODE - Changes will be made to the database\n');
  }

  const connection = await mysql.createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });

  console.log('✓ Connected to database\n');

  const stats: MigrationStats = {
    postsScanned: 0,
    postsWithLinks: 0,
    urlsFound: 0,
    urlsMatched: 0,
    urlsUnmatched: 0,
    shortcodesFound: 0,
    shortcodesMatched: 0,
    shortcodesUnmatched: 0,
    postsUpdated: 0,
  };

  try {
    // Load products
    const productMap = await getProducts(connection);

    // Get posts with product links
    const posts = await getPostsWithProductLinks(connection);
    stats.postsScanned = posts.length;

    const postsToUpdate: PostToUpdate[] = [];
    const unmatchedUrls: Array<{ postId: number; postTitle: string; url: string; slug: string }> = [];
    const unmatchedShortcodes: Array<{ postId: number; postTitle: string; shortcode: string; productId: string }> = [];

    console.log('\n📊 Processing posts...\n');

    for (const row of posts) {
      const urlMatches = extractProductUrls(row.post_content);
      const shortcodeMatches = extractShortcodes(row.post_content);

      if (urlMatches.length === 0 && shortcodeMatches.length === 0) {
        continue;
      }

      stats.postsWithLinks++;
      stats.urlsFound += urlMatches.length;
      stats.shortcodesFound += shortcodeMatches.length;

      const post: PostToUpdate = {
        id: row.ID,
        title: row.post_title,
        type: row.post_type,
        content: row.post_content,
        originalContent: row.post_content,
        urlMatches: [],
        shortcodeMatches: [],
      };

      // Process URLs
      for (const { original, slug } of urlMatches) {
        const product = findProductBySlug(productMap, slug);

        if (product) {
          stats.urlsMatched++;
          const newUrl = `${NEW_PRODUCT_URL_BASE}${product.slug}`;
          post.urlMatches.push({
            original,
            slug,
            matched: true,
            newUrl,
            product,
          });
        } else {
          stats.urlsUnmatched++;
          post.urlMatches.push({
            original,
            slug,
            matched: false,
          });
          unmatchedUrls.push({
            postId: row.ID,
            postTitle: row.post_title,
            url: original,
            slug,
          });
        }
      }

      // Process shortcodes
      for (const { original, productId } of shortcodeMatches) {
        const product = findProductById(productMap, parseInt(productId, 10));

        if (product) {
          stats.shortcodesMatched++;
          // Convert to SKU-based shortcode or product link
          const newShortcode = product.sku
            ? `[add_to_cart sku="${product.sku}"]`
            : `<a href="${NEW_PRODUCT_URL_BASE}${product.slug}" class="button add-to-cart-link">Add to Cart</a>`;

          post.shortcodeMatches.push({
            original,
            productId,
            matched: true,
            newShortcode,
            product,
          });
        } else {
          stats.shortcodesUnmatched++;
          post.shortcodeMatches.push({
            original,
            productId,
            matched: false,
          });
          unmatchedShortcodes.push({
            postId: row.ID,
            postTitle: row.post_title,
            shortcode: original,
            productId,
          });
        }
      }

      // Check if anything needs updating
      const hasMatchedUrls = post.urlMatches.some(m => m.matched);
      const hasMatchedShortcodes = post.shortcodeMatches.some(m => m.matched);

      if (hasMatchedUrls || hasMatchedShortcodes) {
        post.content = updateContent(post);
        postsToUpdate.push(post);
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`Posts scanned:        ${stats.postsScanned}`);
    console.log(`Posts with links:     ${stats.postsWithLinks}`);
    console.log(`Posts to update:      ${postsToUpdate.length}`);
    console.log('');
    console.log(`URLs found:           ${stats.urlsFound}`);
    console.log(`URLs matched:         ${stats.urlsMatched} ✓`);
    console.log(`URLs unmatched:       ${stats.urlsUnmatched} ✗`);
    console.log('');
    console.log(`Shortcodes found:     ${stats.shortcodesFound}`);
    console.log(`Shortcodes matched:   ${stats.shortcodesMatched} ✓`);
    console.log(`Shortcodes unmatched: ${stats.shortcodesUnmatched} ✗`);

    // Show sample updates
    if (postsToUpdate.length > 0) {
      console.log('\n' + '='.repeat(50));
      console.log('📝 SAMPLE UPDATES (first 5)');
      console.log('='.repeat(50));

      for (const post of postsToUpdate.slice(0, 5)) {
        console.log(`\n[${post.type}] ID ${post.id}: ${post.title}`);

        for (const urlMatch of post.urlMatches.filter(m => m.matched).slice(0, 3)) {
          console.log(`   URL: ${urlMatch.original.substring(0, 50)}...`);
          console.log(`     -> ${urlMatch.newUrl}`);
        }

        for (const scMatch of post.shortcodeMatches.filter(m => m.matched).slice(0, 3)) {
          console.log(`   Shortcode: ${scMatch.original}`);
          console.log(`     -> ${scMatch.newShortcode?.substring(0, 60)}...`);
        }
      }
    }

    // Show unmatched items
    if (unmatchedUrls.length > 0 || unmatchedShortcodes.length > 0) {
      console.log('\n' + '='.repeat(50));
      console.log('⚠️  UNMATCHED ITEMS (need manual review)');
      console.log('='.repeat(50));

      if (unmatchedUrls.length > 0) {
        console.log(`\nUnmatched URLs (${unmatchedUrls.length}):`);
        const uniqueSlugs = [...new Set(unmatchedUrls.map(u => u.slug))];
        uniqueSlugs.slice(0, 20).forEach(slug => {
          console.log(`   - ${slug}`);
        });
        if (uniqueSlugs.length > 20) {
          console.log(`   ... and ${uniqueSlugs.length - 20} more`);
        }
      }

      if (unmatchedShortcodes.length > 0) {
        console.log(`\nUnmatched Shortcodes (${unmatchedShortcodes.length}):`);
        const uniqueIds = [...new Set(unmatchedShortcodes.map(s => s.productId))];
        uniqueIds.slice(0, 20).forEach(id => {
          console.log(`   - Product ID: ${id}`);
        });
        if (uniqueIds.length > 20) {
          console.log(`   ... and ${uniqueIds.length - 20} more`);
        }
      }
    }

    // Execute updates
    if (!dryRun && !reportOnly && postsToUpdate.length > 0) {
      console.log('\n' + '='.repeat(50));
      console.log('💾 APPLYING UPDATES');
      console.log('='.repeat(50));

      for (const post of postsToUpdate) {
        await connection.execute(
          'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
          [post.content, post.id]
        );
        stats.postsUpdated++;

        if (stats.postsUpdated % 50 === 0) {
          console.log(`   Updated ${stats.postsUpdated}/${postsToUpdate.length} posts...`);
        }
      }

      console.log(`\n✅ Updated ${stats.postsUpdated} posts`);
    }

    // Generate report file
    const reportPath = '/Volumes/Mac Mini M4 -2TB/MacMini-Data/Documents/web-dev/maleq-headless/docs/product-link-migration-report.md';
    const report = generateReport(stats, unmatchedUrls, unmatchedShortcodes, postsToUpdate);
    writeFileSync(reportPath, report);
    console.log(`\n📄 Report saved to: ${reportPath}`);

  } finally {
    await connection.end();
    console.log('\n✓ Database connection closed');
  }
}

function generateReport(
  stats: MigrationStats,
  unmatchedUrls: Array<{ postId: number; postTitle: string; url: string; slug: string }>,
  unmatchedShortcodes: Array<{ postId: number; postTitle: string; shortcode: string; productId: string }>,
  postsToUpdate: PostToUpdate[]
): string {
  const lines: string[] = [];

  lines.push('# Product Link Migration Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Posts Scanned | ${stats.postsScanned} |`);
  lines.push(`| Posts with Links | ${stats.postsWithLinks} |`);
  lines.push(`| Posts Updated | ${stats.postsUpdated} |`);
  lines.push(`| URLs Found | ${stats.urlsFound} |`);
  lines.push(`| URLs Matched | ${stats.urlsMatched} |`);
  lines.push(`| URLs Unmatched | ${stats.urlsUnmatched} |`);
  lines.push(`| Shortcodes Found | ${stats.shortcodesFound} |`);
  lines.push(`| Shortcodes Matched | ${stats.shortcodesMatched} |`);
  lines.push(`| Shortcodes Unmatched | ${stats.shortcodesUnmatched} |`);
  lines.push('');

  if (unmatchedUrls.length > 0) {
    lines.push('## Unmatched URLs (Need Manual Review)');
    lines.push('');
    lines.push('These product slugs could not be matched to existing products:');
    lines.push('');

    const slugGroups = new Map<string, Array<{ postId: number; postTitle: string }>>();
    for (const item of unmatchedUrls) {
      if (!slugGroups.has(item.slug)) {
        slugGroups.set(item.slug, []);
      }
      slugGroups.get(item.slug)!.push({ postId: item.postId, postTitle: item.postTitle });
    }

    for (const [slug, posts] of slugGroups) {
      lines.push(`### \`${slug}\``);
      lines.push('');
      lines.push('Found in:');
      for (const post of posts.slice(0, 5)) {
        lines.push(`- Post ID ${post.postId}: ${post.postTitle}`);
      }
      if (posts.length > 5) {
        lines.push(`- ... and ${posts.length - 5} more posts`);
      }
      lines.push('');
    }
  }

  if (unmatchedShortcodes.length > 0) {
    lines.push('## Unmatched Shortcodes (Need Manual Review)');
    lines.push('');
    lines.push('These product IDs could not be matched to existing products:');
    lines.push('');

    const idGroups = new Map<string, Array<{ postId: number; postTitle: string }>>();
    for (const item of unmatchedShortcodes) {
      if (!idGroups.has(item.productId)) {
        idGroups.set(item.productId, []);
      }
      idGroups.get(item.productId)!.push({ postId: item.postId, postTitle: item.postTitle });
    }

    for (const [productId, posts] of idGroups) {
      lines.push(`### Product ID: \`${productId}\``);
      lines.push('');
      lines.push('Found in:');
      for (const post of posts.slice(0, 5)) {
        lines.push(`- Post ID ${post.postId}: ${post.postTitle}`);
      }
      if (posts.length > 5) {
        lines.push(`- ... and ${posts.length - 5} more posts`);
      }
      lines.push('');
    }
  }

  if (postsToUpdate.length > 0) {
    lines.push('## Posts Updated');
    lines.push('');
    lines.push('| Post ID | Type | Title | URLs Updated | Shortcodes Updated |');
    lines.push('|---------|------|-------|--------------|-------------------|');

    for (const post of postsToUpdate) {
      const urlsUpdated = post.urlMatches.filter(m => m.matched).length;
      const shortcodesUpdated = post.shortcodeMatches.filter(m => m.matched).length;
      lines.push(`| ${post.id} | ${post.type} | ${post.title.substring(0, 40)} | ${urlsUpdated} | ${shortcodesUpdated} |`);
    }
  }

  return lines.join('\n');
}

main().catch(console.error);
