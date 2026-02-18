#!/usr/bin/env bun

/**
 * Delete Products by Category Script
 *
 * Removes products belonging to specified categories, along with their:
 * - Product meta data
 * - Term relationships
 * - Image attachments (posts + meta + files on disk)
 * - Comments/reviews
 *
 * Also removes the categories themselves.
 *
 * Usage:
 *   bun scripts/delete-category-products.ts --local [--dry-run]
 *   MYSQL_DB=maleq-wp MYSQL_USER=maleq-wp MYSQL_PASS=... bun scripts/delete-category-products.ts [--dry-run]
 */

import { getConnection } from './lib/db';
import type { Connection } from 'mysql2/promise';

const CATEGORY_IDS = [1553, 1633, 1730]; // Meds & Supplements, Sex Pills, Sex Drinks

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Delete Category Products Script

Removes products in specified categories and their associated data.

Usage:
  bun scripts/delete-category-products.ts --local [--dry-run]

Options:
  --dry-run    Show what would be deleted without making changes
  --local      Use local database
  --help, -h   Show this help
    `);
    process.exit(0);
  }

  return { dryRun };
}

async function getProductIds(db: Connection): Promise<number[]> {
  const [rows] = await db.execute(`
    SELECT DISTINCT p.ID
    FROM wp_posts p
    JOIN wp_term_relationships tr ON p.ID = tr.object_id
    JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
    WHERE tt.taxonomy = 'product_cat'
    AND tt.term_id IN (${CATEGORY_IDS.join(',')})
    AND p.post_type = 'product'
  `) as [any[], any];

  return rows.map((r: any) => r.ID);
}

async function getAttachmentIds(db: Connection, productIds: number[]): Promise<number[]> {
  if (productIds.length === 0) return [];

  // Get featured images (thumbnail)
  const [thumbRows] = await db.execute(`
    SELECT DISTINCT meta_value AS attachment_id
    FROM wp_postmeta
    WHERE post_id IN (${productIds.join(',')})
    AND meta_key = '_thumbnail_id'
    AND meta_value > 0
  `) as [any[], any];

  // Get gallery images
  const [galleryRows] = await db.execute(`
    SELECT DISTINCT meta_value
    FROM wp_postmeta
    WHERE post_id IN (${productIds.join(',')})
    AND meta_key = '_product_image_gallery'
    AND meta_value != ''
  `) as [any[], any];

  const attachmentIds = new Set<number>();

  for (const row of thumbRows) {
    attachmentIds.add(Number(row.attachment_id));
  }

  for (const row of galleryRows) {
    const ids = String(row.meta_value).split(',').map(Number).filter(Boolean);
    ids.forEach((id) => attachmentIds.add(id));
  }

  // Also get child attachments (images uploaded as children of the product post)
  const [childRows] = await db.execute(`
    SELECT ID FROM wp_posts
    WHERE post_parent IN (${productIds.join(',')})
    AND post_type = 'attachment'
  `) as [any[], any];

  for (const row of childRows) {
    attachmentIds.add(row.ID);
  }

  return Array.from(attachmentIds);
}

async function getImageFilePaths(db: Connection, attachmentIds: number[]): Promise<string[]> {
  if (attachmentIds.length === 0) return [];

  const [rows] = await db.execute(`
    SELECT meta_value FROM wp_postmeta
    WHERE post_id IN (${attachmentIds.join(',')})
    AND meta_key = '_wp_attached_file'
  `) as [any[], any];

  return rows.map((r: any) => String(r.meta_value));
}

async function main() {
  const { dryRun } = parseArgs();

  console.log('🗑️  Delete Category Products Script');
  console.log('====================================\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  const db = await getConnection();

  // Show what categories we're targeting
  const [catRows] = await db.execute(`
    SELECT t.term_id, t.name, tt.count
    FROM wp_terms t
    JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
    WHERE t.term_id IN (${CATEGORY_IDS.join(',')})
  `) as [any[], any];

  console.log('📂 Target categories:');
  for (const cat of catRows) {
    console.log(`   - ${cat.name} (ID: ${cat.term_id}, ${cat.count} products)`);
  }

  // Get products
  const productIds = await getProductIds(db);
  console.log(`\n📦 Found ${productIds.length} products to delete`);

  if (productIds.length === 0) {
    console.log('Nothing to do.');
    await db.end();
    return;
  }

  // Get attachments
  const attachmentIds = await getAttachmentIds(db, productIds);
  console.log(`🖼️  Found ${attachmentIds.length} image attachments`);

  // Get file paths for reference
  const filePaths = await getImageFilePaths(db, attachmentIds);
  if (filePaths.length > 0) {
    console.log(`📁 Image files (relative to uploads dir):`);
    for (const fp of filePaths.slice(0, 10)) {
      console.log(`   - ${fp}`);
    }
    if (filePaths.length > 10) {
      console.log(`   ... and ${filePaths.length - 10} more`);
    }
  }

  // Count comments
  const [commentRows] = await db.execute(`
    SELECT COUNT(*) as cnt FROM wp_comments
    WHERE comment_post_ID IN (${productIds.join(',')})
  `) as [any[], any];
  const commentCount = commentRows[0].cnt;
  console.log(`💬 Found ${commentCount} comments/reviews to delete`);

  if (dryRun) {
    console.log('\n⚠️  Run without --dry-run to apply changes');
    await db.end();
    return;
  }

  // --- APPLY CHANGES ---
  console.log('\n🔧 Applying changes...\n');

  // 1. Delete comments/reviews
  if (commentCount > 0) {
    await db.execute(`DELETE FROM wp_commentmeta WHERE comment_id IN (SELECT comment_ID FROM wp_comments WHERE comment_post_ID IN (${productIds.join(',')}))`);
    await db.execute(`DELETE FROM wp_comments WHERE comment_post_ID IN (${productIds.join(',')})`);
    console.log(`   ✅ Deleted ${commentCount} comments and their meta`);
  }

  // 2. Delete attachment meta and posts
  if (attachmentIds.length > 0) {
    await db.execute(`DELETE FROM wp_postmeta WHERE post_id IN (${attachmentIds.join(',')})`);
    await db.execute(`DELETE FROM wp_posts WHERE ID IN (${attachmentIds.join(',')})`);
    console.log(`   ✅ Deleted ${attachmentIds.length} attachment records`);
  }

  // 3. Delete product meta
  await db.execute(`DELETE FROM wp_postmeta WHERE post_id IN (${productIds.join(',')})`);
  console.log(`   ✅ Deleted product meta`);

  // 4. Delete term relationships for products
  await db.execute(`DELETE FROM wp_term_relationships WHERE object_id IN (${productIds.join(',')})`);
  console.log(`   ✅ Deleted term relationships`);

  // 5. Delete product posts
  await db.execute(`DELETE FROM wp_posts WHERE ID IN (${productIds.join(',')})`);
  console.log(`   ✅ Deleted ${productIds.length} products`);

  // 6. Delete the categories themselves
  // Delete term_taxonomy entries
  await db.execute(`DELETE FROM wp_term_taxonomy WHERE term_id IN (${CATEGORY_IDS.join(',')})`);
  // Delete term_relationships pointing to these categories
  await db.execute(`
    DELETE tr FROM wp_term_relationships tr
    JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
    WHERE tt.term_id IN (${CATEGORY_IDS.join(',')})
  `);
  // Delete terms
  await db.execute(`DELETE FROM wp_terms WHERE term_id IN (${CATEGORY_IDS.join(',')})`);
  // Delete termmeta if any
  await db.execute(`DELETE FROM wp_termmeta WHERE term_id IN (${CATEGORY_IDS.join(',')})`);
  console.log(`   ✅ Deleted ${CATEGORY_IDS.length} categories`);

  await db.end();

  console.log('\n📊 Summary:');
  console.log(`   Products deleted: ${productIds.length}`);
  console.log(`   Attachments deleted: ${attachmentIds.length}`);
  console.log(`   Comments deleted: ${commentCount}`);
  console.log(`   Categories deleted: ${CATEGORY_IDS.length}`);
  console.log(`\n⚠️  Note: Physical image files on disk are NOT deleted by this script.`);
  console.log(`   You may want to clean up uploads/ on the server separately.`);
  console.log('\n✅ Done!');
}

main().catch(console.error);
