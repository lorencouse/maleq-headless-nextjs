#!/usr/bin/env bun

/**
 * Convert URLs to Relative Paths
 *
 * Converts absolute internal URLs to relative paths in the WordPress database.
 * This makes the database portable across different environments.
 *
 * What it converts:
 * - Internal page/post links: http://domain.com/slug -> /slug
 * - Preserves image URLs (needed for Next.js image optimization)
 * - Preserves external URLs (YouTube, etc.)
 *
 * Usage:
 *   bun scripts/convert-urls-to-relative.ts [options]
 *
 * Options:
 *   --dry-run       Show what would be updated without making changes (default)
 *   --execute       Actually perform the updates
 *   --include-images  Also convert image URLs to relative (not recommended)
 */

import { getConnection } from './lib/db';

// Domains to strip from URLs
const DOMAINS_TO_STRIP = [
  'http://maleq-local.local',
  'https://maleq-local.local',
  'http://maleq.com',
  'https://maleq.com',
  'http://www.maleq.com',
  'https://www.maleq.com',
  'http://staging.maleq.com',
  'https://staging.maleq.com',
];

interface ConversionStats {
  postsProcessed: number;
  postsUpdated: number;
  urlsConverted: number;
  imagesSkipped: number;
  externalSkipped: number;
}

function convertToRelativeUrls(content: string, includeImages: boolean = false): { content: string; stats: { converted: number; imagesSkipped: number } } {
  let converted = 0;
  let imagesSkipped = 0;

  let newContent = content;

  for (const domain of DOMAINS_TO_STRIP) {
    // Match URLs with this domain
    const regex = new RegExp(
      domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(/[^"\'<>\\s]*)',
      'gi'
    );

    newContent = newContent.replace(regex, (match, path) => {
      // Check if it's an image URL
      if (path.includes('/wp-content/uploads/')) {
        if (includeImages) {
          converted++;
          return path;
        } else {
          imagesSkipped++;
          return match; // Keep the full URL for images
        }
      }

      converted++;
      return path;
    });
  }

  return { content: newContent, stats: { converted, imagesSkipped } };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const includeImages = args.includes('--include-images');

  console.log('🔗 Convert URLs to Relative Paths');
  console.log('='.repeat(50));

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made');
    console.log('   Use --execute to perform actual updates\n');
  } else {
    console.log('⚠️  EXECUTE MODE - Changes will be made to the database\n');
  }

  if (includeImages) {
    console.log('⚠️  Including image URLs (--include-images)\n');
  } else {
    console.log('ℹ️  Preserving image URLs (recommended for Next.js)\n');
  }

  const connection = await getConnection();

  console.log('✓ Connected to database\n');

  const stats: ConversionStats = {
    postsProcessed: 0,
    postsUpdated: 0,
    urlsConverted: 0,
    imagesSkipped: 0,
    externalSkipped: 0,
  };

  try {
    // Build domain pattern for SQL LIKE
    const domainPatterns = DOMAINS_TO_STRIP.map(d => `post_content LIKE '%${d}%'`).join(' OR ');

    // Get all posts with internal URLs
    const [posts] = await connection.execute(`
      SELECT ID, post_title, post_type, post_content, post_excerpt
      FROM wp_posts
      WHERE post_status = 'publish'
      AND (${domainPatterns})
    `) as [any[], any];

    console.log(`📝 Found ${posts.length} posts with internal URLs\n`);
    stats.postsProcessed = posts.length;

    for (const post of posts) {
      let contentResult = convertToRelativeUrls(post.post_content || '', includeImages);
      let excerptResult = convertToRelativeUrls(post.post_excerpt || '', includeImages);

      const totalConverted = contentResult.stats.converted + excerptResult.stats.converted;
      const totalImagesSkipped = contentResult.stats.imagesSkipped + excerptResult.stats.imagesSkipped;

      if (totalConverted > 0) {
        stats.postsUpdated++;
        stats.urlsConverted += totalConverted;
        stats.imagesSkipped += totalImagesSkipped;

        if (!dryRun) {
          await connection.execute(
            'UPDATE wp_posts SET post_content = ?, post_excerpt = ? WHERE ID = ?',
            [contentResult.content, excerptResult.content, post.ID]
          );
        }

        if (dryRun) {
          console.log(`  [${post.post_type}] ID ${post.ID}: ${totalConverted} URLs (${totalImagesSkipped} images preserved)`);
        }
      }
    }

    // Also check wp_postmeta for URLs (like custom fields)
    const [metaRows] = await connection.execute(`
      SELECT meta_id, post_id, meta_key, meta_value
      FROM wp_postmeta
      WHERE (${domainPatterns.replace(/post_content/g, 'meta_value')})
    `) as [any[], any];

    let metaUpdated = 0;
    let metaUrlsConverted = 0;

    for (const meta of metaRows) {
      const result = convertToRelativeUrls(meta.meta_value || '', includeImages);
      if (result.stats.converted > 0) {
        metaUpdated++;
        metaUrlsConverted += result.stats.converted;

        if (!dryRun) {
          await connection.execute(
            'UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?',
            [result.content, meta.meta_id]
          );
        }
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 SUMMARY');
    console.log('='.repeat(50));
    console.log(`Posts processed:     ${stats.postsProcessed}`);
    console.log(`Posts updated:       ${stats.postsUpdated}`);
    console.log(`URLs converted:      ${stats.urlsConverted}`);
    console.log(`Images preserved:    ${stats.imagesSkipped}`);
    console.log(`Meta rows updated:   ${metaUpdated} (${metaUrlsConverted} URLs)`);

    if (!dryRun && (stats.postsUpdated > 0 || metaUpdated > 0)) {
      console.log('\n✅ Changes applied to database');
    } else if (dryRun && (stats.postsUpdated > 0 || metaUpdated > 0)) {
      console.log('\n💡 Run with --execute to apply these changes');
    } else {
      console.log('\n✓ No changes needed - URLs are already relative');
    }

  } finally {
    await connection.end();
    console.log('\n✓ Database connection closed');
  }
}

main().catch(console.error);
