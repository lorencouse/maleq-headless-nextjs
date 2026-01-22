#!/usr/bin/env bun

/**
 * Delete Duplicate Comments Script
 *
 * Finds and removes duplicate comments from the WordPress database.
 * Keeps the original comment (lowest ID) and removes duplicates.
 *
 * Usage:
 *   bun scripts/delete-duplicate-comments.ts [options]
 *
 * Options:
 *   --dry-run    Show duplicates without deleting
 *   --delete     Actually delete the duplicates
 */

import mysql from 'mysql2/promise';

// Configuration - LocalWP MySQL connection
const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

interface DuplicateGroup {
  comment_content: string;
  comment_author: string;
  comment_post_ID: number;
  count: number;
  ids: number[];
  keepId: number;
  deleteIds: number[];
}

function parseArgs(): { dryRun: boolean; delete: boolean } {
  const args = process.argv.slice(2);
  let dryRun = true;
  let deleteMode = false;

  for (const arg of args) {
    if (arg === '--delete') {
      deleteMode = true;
      dryRun = false;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Delete Duplicate Comments Script

Finds and removes duplicate comments from the WordPress database.

Usage:
  bun scripts/delete-duplicate-comments.ts [options]

Options:
  --dry-run    Show duplicates without deleting (default)
  --delete     Actually delete the duplicates
  --help, -h   Show this help message
      `);
      process.exit(0);
    }
  }

  return { dryRun, delete: deleteMode };
}

async function main() {
  const { dryRun, delete: deleteMode } = parseArgs();

  console.log('🔧 Delete Duplicate Comments Script');
  console.log('====================================\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made');
    console.log('   Use --delete flag to remove duplicates\n');
  } else {
    console.log('⚠️  DELETE MODE - Duplicates will be removed!\n');
  }

  // Connect to database
  console.log('🔌 Connecting to local MySQL...');
  const connection = await mysql.createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });
  console.log('✅ Connected\n');

  // Get total comment count
  const [totalResult] = await connection.execute(
    'SELECT COUNT(*) as total FROM wp_comments'
  ) as [any[], any];
  console.log(`📊 Total comments in database: ${totalResult[0].total}\n`);

  // Find duplicate comments
  // Duplicates are identified by same content, author, and post ID
  console.log('🔍 Finding duplicate comments...\n');

  const [duplicates] = await connection.execute(`
    SELECT
      comment_content,
      comment_author,
      comment_post_ID,
      COUNT(*) as count,
      GROUP_CONCAT(comment_ID ORDER BY comment_ID) as ids
    FROM wp_comments
    GROUP BY comment_content, comment_author, comment_post_ID
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `) as [any[], any];

  if (duplicates.length === 0) {
    console.log('✅ No duplicate comments found!');
    await connection.end();
    return;
  }

  // Process duplicates
  const duplicateGroups: DuplicateGroup[] = duplicates.map((row: any) => {
    const ids = row.ids.split(',').map((id: string) => parseInt(id, 10));
    return {
      comment_content: row.comment_content,
      comment_author: row.comment_author,
      comment_post_ID: row.comment_post_ID,
      count: row.count,
      ids,
      keepId: ids[0], // Keep the first (oldest) comment
      deleteIds: ids.slice(1), // Delete all others
    };
  });

  const totalDuplicateGroups = duplicateGroups.length;
  const totalDuplicatesToDelete = duplicateGroups.reduce(
    (sum, group) => sum + group.deleteIds.length,
    0
  );

  console.log(`📝 Found ${totalDuplicateGroups} groups of duplicate comments`);
  console.log(`🗑️  Total duplicate comments to delete: ${totalDuplicatesToDelete}\n`);

  // Show some examples
  console.log('📋 Sample duplicates:\n');
  const samplesToShow = Math.min(10, duplicateGroups.length);
  for (let i = 0; i < samplesToShow; i++) {
    const group = duplicateGroups[i];
    const contentPreview = group.comment_content.substring(0, 80).replace(/\n/g, ' ');
    console.log(`   ${i + 1}. "${contentPreview}${group.comment_content.length > 80 ? '...' : ''}"`);
    console.log(`      Author: ${group.comment_author} | Post ID: ${group.comment_post_ID}`);
    console.log(`      Copies: ${group.count} | Keep ID: ${group.keepId} | Delete IDs: ${group.deleteIds.join(', ')}\n`);
  }

  if (duplicateGroups.length > samplesToShow) {
    console.log(`   ... and ${duplicateGroups.length - samplesToShow} more groups\n`);
  }

  // Delete duplicates if not in dry-run mode
  if (deleteMode) {
    console.log('🗑️  Deleting duplicate comments...\n');

    // Collect all IDs to delete
    const allIdsToDelete = duplicateGroups.flatMap(group => group.deleteIds);

    // Delete in batches of 100 to avoid query size limits
    const batchSize = 100;
    let deletedCount = 0;

    for (let i = 0; i < allIdsToDelete.length; i += batchSize) {
      const batch = allIdsToDelete.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');

      await connection.execute(
        `DELETE FROM wp_comments WHERE comment_ID IN (${placeholders})`,
        batch
      );

      // Also delete comment meta for these comments
      await connection.execute(
        `DELETE FROM wp_commentmeta WHERE comment_id IN (${placeholders})`,
        batch
      );

      deletedCount += batch.length;
      console.log(`   Deleted ${deletedCount}/${allIdsToDelete.length} comments...`);
    }

    console.log(`\n✅ Successfully deleted ${deletedCount} duplicate comments!`);

    // Get new total
    const [newTotalResult] = await connection.execute(
      'SELECT COUNT(*) as total FROM wp_comments'
    ) as [any[], any];
    console.log(`📊 New total comments in database: ${newTotalResult[0].total}`);
  } else {
    console.log('ℹ️  To delete these duplicates, run with --delete flag:');
    console.log('   bun scripts/delete-duplicate-comments.ts --delete\n');
  }

  await connection.end();
  console.log('\n✅ Done!');
}

main().catch(console.error);
