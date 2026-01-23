#!/usr/bin/env bun

/**
 * Update URL Format Script
 *
 * Updates URLs from /shop/product/ format to /product/ format
 * and /shop/category/ to /product-category/
 *
 * Usage:
 *   bun scripts/update-url-format.ts [options]
 *
 * Options:
 *   --dry-run    Show what would be updated without making changes (default)
 *   --execute    Actually perform the updates
 */

import mysql from 'mysql2/promise';

const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  console.log('🔗 URL Format Update Script');
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
    // Get posts with /shop/product/ or /shop/category/ URLs
    const [posts] = await connection.execute(`
      SELECT ID, post_title, post_content
      FROM wp_posts
      WHERE post_status = 'publish'
      AND (
        post_content LIKE '%/shop/product/%'
        OR post_content LIKE '%/shop/category/%'
      )
    `) as [any[], any];

    console.log(`📝 Found ${posts.length} posts with old URL format\n`);

    let updatedPosts = 0;
    let productUrlCount = 0;
    let categoryUrlCount = 0;

    for (const post of posts) {
      let content = post.post_content;
      let modified = false;

      // Count and replace /shop/product/ -> /product/
      const productMatches = content.match(/\/shop\/product\//g);
      if (productMatches) {
        productUrlCount += productMatches.length;
        content = content.replace(/\/shop\/product\//g, '/product/');
        modified = true;
      }

      // Count and replace /shop/category/ -> /product-category/
      const categoryMatches = content.match(/\/shop\/category\//g);
      if (categoryMatches) {
        categoryUrlCount += categoryMatches.length;
        content = content.replace(/\/shop\/category\//g, '/product-category/');
        modified = true;
      }

      if (modified) {
        updatedPosts++;
        if (!dryRun) {
          await connection.execute(
            'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
            [content, post.ID]
          );
        }
      }
    }

    console.log('='.repeat(50));
    console.log('📊 SUMMARY');
    console.log('='.repeat(50));
    console.log(`Posts to update:        ${updatedPosts}`);
    console.log(`Product URLs changed:   ${productUrlCount} (/shop/product/ -> /product/)`);
    console.log(`Category URLs changed:  ${categoryUrlCount} (/shop/category/ -> /product-category/)`);

    if (!dryRun && updatedPosts > 0) {
      console.log('\n✅ Changes applied to database');
    } else if (dryRun && updatedPosts > 0) {
      console.log('\n💡 Run with --execute to apply these changes');
    } else {
      console.log('\n✓ No changes needed');
    }

  } finally {
    await connection.end();
    console.log('\n✓ Database connection closed');
  }
}

main().catch(console.error);
