#!/usr/bin/env bun

/**
 * Update Product Links Script v2
 *
 * Updates product links and shortcodes in WordPress blog posts and reusable blocks.
 * For unmatched shortcodes, looks at nearby product links to identify the product.
 *
 * Usage:
 *   bun scripts/update-product-links-v2.ts [options]
 *
 * Options:
 *   --dry-run    Show what would be updated without making changes (default)
 *   --execute    Actually perform the updates
 */

import mysql from 'mysql2/promise';
import { writeFileSync } from 'fs';

// Configuration
const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

const NEW_PRODUCT_URL_BASE = '/product/';

interface Product {
  id: number;
  slug: string;
  sku: string | null;
  name: string;
}

interface ShortcodeMatch {
  original: string;
  productId: string;
  position: number;
  matched: boolean;
  matchMethod?: 'direct' | 'context' | 'none';
  newShortcode?: string;
  product?: Product;
  contextSlug?: string;
}

interface UrlMatch {
  original: string;
  slug: string;
  position: number;
  matched: boolean;
  newUrl?: string;
  product?: Product;
}

interface PostUpdate {
  id: number;
  title: string;
  type: string;
  originalContent: string;
  newContent: string;
  urlMatches: UrlMatch[];
  shortcodeMatches: ShortcodeMatch[];
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  console.log('🔗 Product Link Migration Script v2');
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

  try {
    // Load products
    console.log('📦 Loading products...');
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

    const productBySlug = new Map<string, Product>();
    const productById = new Map<number, Product>();

    for (const p of products) {
      const product: Product = {
        id: p.id,
        slug: p.slug,
        sku: p.sku,
        name: p.name,
      };
      if (p.slug) {
        productBySlug.set(p.slug.toLowerCase(), product);
      }
      productById.set(p.id, product);
    }

    console.log(`   Loaded ${products.length} products\n`);

    // Get posts with links
    console.log('📝 Loading posts with product links...');
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

    console.log(`   Found ${posts.length} posts to process\n`);

    const postsToUpdate: PostUpdate[] = [];
    const stats = {
      urlsFound: 0,
      urlsMatched: 0,
      shortcodesFound: 0,
      shortcodesMatchedDirect: 0,
      shortcodesMatchedContext: 0,
      shortcodesUnmatched: 0,
    };

    console.log('📊 Processing posts...\n');

    for (const post of posts) {
      const content = post.post_content || '';

      // Extract all URLs with positions
      const urlMatches: UrlMatch[] = [];
      const urlRegex = /https?:\/\/[^"'\s<>]*(?:maleq[^"'\s<>]*|maleq-local\.local)\/product\/([^"'\s<>\/\?#]+)[^"'\s<>]*/gi;
      let match;

      while ((match = urlRegex.exec(content)) !== null) {
        const slug = match[1].toLowerCase();
        const product = productBySlug.get(slug);

        stats.urlsFound++;

        urlMatches.push({
          original: match[0],
          slug,
          position: match.index,
          matched: !!product,
          newUrl: product ? `${NEW_PRODUCT_URL_BASE}${product.slug}` : undefined,
          product,
        });

        if (product) stats.urlsMatched++;
      }

      // Extract all shortcodes with positions
      const shortcodeMatches: ShortcodeMatch[] = [];
      const scRegex = /\[add_to_cart\s+id="?(\d*)"?\]/gi;

      while ((match = scRegex.exec(content)) !== null) {
        const productId = match[1];
        const position = match.index;

        stats.shortcodesFound++;

        // Try direct match by product ID
        let product = productId ? productById.get(parseInt(productId, 10)) : undefined;
        let matchMethod: 'direct' | 'context' | 'none' = 'none';
        let contextSlug: string | undefined;

        if (product) {
          matchMethod = 'direct';
          stats.shortcodesMatchedDirect++;
        } else {
          // Try to find a nearby product URL (look backwards up to 500 chars)
          const searchStart = Math.max(0, position - 500);
          const contextBefore = content.substring(searchStart, position);

          // Find the closest product URL before this shortcode
          const contextUrlRegex = /https?:\/\/[^"'\s<>]*(?:maleq[^"'\s<>]*|maleq-local\.local)\/product\/([^"'\s<>\/\?#]+)/gi;
          let contextMatch;
          let closestSlug: string | null = null;

          while ((contextMatch = contextUrlRegex.exec(contextBefore)) !== null) {
            closestSlug = contextMatch[1].toLowerCase();
          }

          if (closestSlug) {
            product = productBySlug.get(closestSlug);
            if (product) {
              matchMethod = 'context';
              contextSlug = closestSlug;
              stats.shortcodesMatchedContext++;
            }
          }
        }

        if (!product) {
          stats.shortcodesUnmatched++;
        }

        let newShortcode: string | undefined;
        if (product) {
          if (product.sku) {
            newShortcode = `[add_to_cart sku="${product.sku}"]`;
          } else {
            // No SKU, convert to a link
            newShortcode = `<a href="${NEW_PRODUCT_URL_BASE}${product.slug}" class="button">View Product</a>`;
          }
        }

        shortcodeMatches.push({
          original: match[0],
          productId: productId || '',
          position,
          matched: !!product,
          matchMethod,
          newShortcode,
          product,
          contextSlug,
        });
      }

      // Check if any updates needed
      const hasUrlUpdates = urlMatches.some(m => m.matched);
      const hasShortcodeUpdates = shortcodeMatches.some(m => m.matched);

      if (hasUrlUpdates || hasShortcodeUpdates) {
        let newContent = content;

        // Apply URL updates
        for (const urlMatch of urlMatches) {
          if (urlMatch.matched && urlMatch.newUrl) {
            newContent = newContent.split(urlMatch.original).join(urlMatch.newUrl);
          }
        }

        // Apply shortcode updates
        for (const scMatch of shortcodeMatches) {
          if (scMatch.matched && scMatch.newShortcode) {
            newContent = newContent.split(scMatch.original).join(scMatch.newShortcode);
          }
        }

        postsToUpdate.push({
          id: post.ID,
          title: post.post_title,
          type: post.post_type,
          originalContent: content,
          newContent,
          urlMatches,
          shortcodeMatches,
        });
      }
    }

    // Print summary
    console.log('='.repeat(50));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`Posts to update:              ${postsToUpdate.length}`);
    console.log('');
    console.log(`URLs found:                   ${stats.urlsFound}`);
    console.log(`URLs matched:                 ${stats.urlsMatched} ✓`);
    console.log('');
    console.log(`Shortcodes found:             ${stats.shortcodesFound}`);
    console.log(`  - Matched by ID:            ${stats.shortcodesMatchedDirect} ✓`);
    console.log(`  - Matched by context:       ${stats.shortcodesMatchedContext} ✓ (nearby URL)`);
    console.log(`  - Unmatched:                ${stats.shortcodesUnmatched} ✗`);

    // Show sample context matches
    const contextMatches = postsToUpdate
      .flatMap(p => p.shortcodeMatches)
      .filter(m => m.matchMethod === 'context')
      .slice(0, 10);

    if (contextMatches.length > 0) {
      console.log('\n' + '='.repeat(50));
      console.log('🔍 CONTEXT-MATCHED SHORTCODES (sample)');
      console.log('='.repeat(50));

      for (const match of contextMatches) {
        console.log(`\n  ${match.original}`);
        console.log(`    Context slug: ${match.contextSlug}`);
        console.log(`    Product: ${match.product?.name}`);
        console.log(`    New: ${match.newShortcode}`);
      }
    }

    // Show sample updates
    if (postsToUpdate.length > 0) {
      console.log('\n' + '='.repeat(50));
      console.log('📝 SAMPLE UPDATES (first 3 posts)');
      console.log('='.repeat(50));

      for (const post of postsToUpdate.slice(0, 3)) {
        console.log(`\n[${post.type}] ID ${post.id}: ${post.title}`);

        const matchedUrls = post.urlMatches.filter(m => m.matched).slice(0, 2);
        for (const m of matchedUrls) {
          console.log(`  URL: ${m.original.substring(0, 50)}...`);
          console.log(`    -> ${m.newUrl}`);
        }

        const matchedSc = post.shortcodeMatches.filter(m => m.matched).slice(0, 2);
        for (const m of matchedSc) {
          console.log(`  Shortcode: ${m.original} (${m.matchMethod})`);
          console.log(`    -> ${m.newShortcode}`);
        }
      }
    }

    // Execute updates
    if (!dryRun && postsToUpdate.length > 0) {
      console.log('\n' + '='.repeat(50));
      console.log('💾 APPLYING UPDATES');
      console.log('='.repeat(50));

      let updated = 0;
      for (const post of postsToUpdate) {
        await connection.execute(
          'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
          [post.newContent, post.id]
        );
        updated++;

        if (updated % 25 === 0) {
          console.log(`   Updated ${updated}/${postsToUpdate.length} posts...`);
        }
      }

      console.log(`\n✅ Updated ${updated} posts`);
    }

    // Generate detailed report
    const reportLines: string[] = [];
    reportLines.push('# Product Link Migration Report v2');
    reportLines.push('');
    reportLines.push(`Generated: ${new Date().toISOString()}`);
    reportLines.push(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTED'}`);
    reportLines.push('');
    reportLines.push('## Summary');
    reportLines.push('');
    reportLines.push(`| Metric | Count |`);
    reportLines.push(`|--------|-------|`);
    reportLines.push(`| Posts Updated | ${postsToUpdate.length} |`);
    reportLines.push(`| URLs Found | ${stats.urlsFound} |`);
    reportLines.push(`| URLs Matched | ${stats.urlsMatched} |`);
    reportLines.push(`| Shortcodes Found | ${stats.shortcodesFound} |`);
    reportLines.push(`| Shortcodes Matched (by ID) | ${stats.shortcodesMatchedDirect} |`);
    reportLines.push(`| Shortcodes Matched (by context) | ${stats.shortcodesMatchedContext} |`);
    reportLines.push(`| Shortcodes Unmatched | ${stats.shortcodesUnmatched} |`);
    reportLines.push('');

    // List all unmatched shortcodes
    const unmatchedShortcodes = postsToUpdate
      .flatMap(p => p.shortcodeMatches.map(s => ({ ...s, postId: p.id, postTitle: p.title })))
      .filter(s => !s.matched);

    const allUnmatchedShortcodes: Array<{ postId: number; postTitle: string; shortcode: ShortcodeMatch }> = [];
    for (const post of posts) {
      const content = post.post_content || '';
      const scRegex = /\[add_to_cart\s+id="?(\d*)"?\]/gi;
      let match;
      while ((match = scRegex.exec(content)) !== null) {
        const productId = match[1];
        const product = productId ? productById.get(parseInt(productId, 10)) : undefined;

        if (!product) {
          // Check context match
          const position = match.index;
          const searchStart = Math.max(0, position - 500);
          const contextBefore = content.substring(searchStart, position);
          const contextUrlRegex = /https?:\/\/[^"'\s<>]*(?:maleq[^"'\s<>]*|maleq-local\.local)\/product\/([^"'\s<>\/\?#]+)/gi;
          let contextMatch;
          let closestSlug: string | null = null;
          while ((contextMatch = contextUrlRegex.exec(contextBefore)) !== null) {
            closestSlug = contextMatch[1].toLowerCase();
          }

          const contextProduct = closestSlug ? productBySlug.get(closestSlug) : undefined;

          if (!contextProduct) {
            allUnmatchedShortcodes.push({
              postId: post.ID,
              postTitle: post.post_title,
              shortcode: {
                original: match[0],
                productId: productId || '',
                position: match.index,
                matched: false,
                matchMethod: 'none',
              },
            });
          }
        }
      }
    }

    if (allUnmatchedShortcodes.length > 0) {
      reportLines.push('## Still Unmatched Shortcodes');
      reportLines.push('');
      reportLines.push('These shortcodes could not be matched by ID or context:');
      reportLines.push('');
      reportLines.push('| Post ID | Post Title | Shortcode |');
      reportLines.push('|---------|------------|-----------|');

      for (const item of allUnmatchedShortcodes.slice(0, 100)) {
        const title = item.postTitle.length > 35
          ? item.postTitle.substring(0, 35) + '...'
          : item.postTitle;
        reportLines.push(`| ${item.postId} | ${title} | ${item.shortcode.original} |`);
      }

      if (allUnmatchedShortcodes.length > 100) {
        reportLines.push(`| ... | ... | (${allUnmatchedShortcodes.length - 100} more) |`);
      }
    }

    const reportPath = '/Volumes/Mac Mini M4 -2TB/MacMini-Data/Documents/web-dev/maleq-headless/docs/product-link-migration-v2-report.md';
    writeFileSync(reportPath, reportLines.join('\n'));
    console.log(`\n📄 Report saved to: ${reportPath}`);

  } finally {
    await connection.end();
    console.log('\n✓ Database connection closed');
  }
}

main().catch(console.error);
