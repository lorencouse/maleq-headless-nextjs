#!/usr/bin/env bun

/**
 * Remove Review Labels Script
 *
 * Removes "MQ Reader Review:" text (and variations) from content with the .review class.
 * The label will be displayed via CSS ::before instead.
 *
 * Usage:
 *   bun scripts/remove-review-labels.ts [options]
 *
 * Options:
 *   --dry-run    Show what would be changed without making changes
 */

import mysql from 'mysql2/promise';

// Configuration
const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

interface UpdateStats {
  postsChecked: number;
  postsUpdated: number;
  blocksChecked: number;
  blocksUpdated: number;
  totalReplacements: number;
}

function parseArgs(): { dryRun: boolean } {
  const args = process.argv.slice(2);
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Remove Review Labels Script

Removes "MQ Reader Review:" text (and variations) from content with the .review class.

Usage:
  bun scripts/remove-review-labels.ts [options]

Options:
  --dry-run    Show what would be changed without making changes
  --help, -h   Show this help message
      `);
      process.exit(0);
    }
  }

  return { dryRun };
}

function removeReviewLabels(content: string): { newContent: string; replacements: number } {
  let replacements = 0;
  let newContent = content;

  // Patterns to match review labels inside .review class elements
  // These patterns look for the label text that appears at the start of review content
  const patterns = [
    // Various formats of "MQ Reader Review:" with optional quotes and whitespace
    /(<[^>]*class="[^"]*review[^"]*"[^>]*>)\s*"?\s*MQ\s+Reader\s+Review:?\s*"?\s*/gi,
    /(<[^>]*class="[^"]*review[^"]*"[^>]*>)\s*"?\s*MQ\s+Reader:?\s*"?\s*/gi,
    /(<[^>]*class="[^"]*review[^"]*"[^>]*>)\s*"?\s*Reader\s+Review:?\s*"?\s*/gi,
    // Handle cases where there's a paragraph or span wrapper
    /(<[^>]*class="[^"]*review[^"]*"[^>]*>\s*<[^>]+>)\s*"?\s*MQ\s+Reader\s+Review:?\s*"?\s*/gi,
    /(<[^>]*class="[^"]*review[^"]*"[^>]*>\s*<[^>]+>)\s*"?\s*MQ\s+Reader:?\s*"?\s*/gi,
    /(<[^>]*class="[^"]*review[^"]*"[^>]*>\s*<[^>]+>)\s*"?\s*Reader\s+Review:?\s*"?\s*/gi,
  ];

  for (const pattern of patterns) {
    const matches = newContent.match(pattern);
    if (matches) {
      replacements += matches.length;
      newContent = newContent.replace(pattern, '$1');
    }
  }

  // Also handle standalone label text that might be in a separate element
  // e.g., <strong>MQ Reader Review:</strong>
  const standalonePatterns = [
    /<strong>\s*"?\s*MQ\s+Reader\s+Review:?\s*"?\s*<\/strong>\s*/gi,
    /<em>\s*"?\s*MQ\s+Reader\s+Review:?\s*"?\s*<\/em>\s*/gi,
    /<b>\s*"?\s*MQ\s+Reader\s+Review:?\s*"?\s*<\/b>\s*/gi,
    /<span[^>]*>\s*"?\s*MQ\s+Reader\s+Review:?\s*"?\s*<\/span>\s*/gi,
  ];

  // Only apply standalone patterns if content has .review class
  if (content.includes('class="review"') || content.includes("class='review'") || content.includes('class="review ') || content.includes(" review\"") || content.includes(" review'")) {
    for (const pattern of standalonePatterns) {
      const matches = newContent.match(pattern);
      if (matches) {
        replacements += matches.length;
        newContent = newContent.replace(pattern, '');
      }
    }
  }

  return { newContent, replacements };
}

async function main() {
  const { dryRun } = parseArgs();
  const stats: UpdateStats = {
    postsChecked: 0,
    postsUpdated: 0,
    blocksChecked: 0,
    blocksUpdated: 0,
    totalReplacements: 0,
  };

  console.log('🔧 Remove Review Labels Script');
  console.log('==============================\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
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

  // Find posts with .review class
  console.log('🔍 Searching for posts with .review class...');
  const [posts] = await connection.execute(`
    SELECT ID, post_title, post_content
    FROM wp_posts
    WHERE post_type IN ('post', 'page')
    AND post_status = 'publish'
    AND post_content LIKE '%class="review%'
  `) as [any[], any];

  stats.postsChecked = posts.length;
  console.log(`📝 Found ${posts.length} posts with .review class\n`);

  // Process posts
  for (const post of posts) {
    const { newContent, replacements } = removeReviewLabels(post.post_content);

    if (replacements > 0) {
      stats.totalReplacements += replacements;
      stats.postsUpdated++;

      console.log(`   ✏️  Post: "${post.post_title}" - ${replacements} replacement(s)`);

      if (!dryRun) {
        await connection.execute(
          'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
          [newContent, post.ID]
        );
      }
    }
  }

  // Find reusable blocks with .review class
  console.log('\n🔍 Searching for reusable blocks with .review class...');
  const [blocks] = await connection.execute(`
    SELECT ID, post_title, post_content
    FROM wp_posts
    WHERE post_type = 'wp_block'
    AND post_content LIKE '%class="review%'
  `) as [any[], any];

  stats.blocksChecked = blocks.length;
  console.log(`📦 Found ${blocks.length} reusable blocks with .review class\n`);

  // Process blocks
  for (const block of blocks) {
    const { newContent, replacements } = removeReviewLabels(block.post_content);

    if (replacements > 0) {
      stats.totalReplacements += replacements;
      stats.blocksUpdated++;

      console.log(`   ✏️  Block: "${block.post_title}" - ${replacements} replacement(s)`);

      if (!dryRun) {
        await connection.execute(
          'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
          [newContent, block.ID]
        );
      }
    }
  }

  await connection.end();

  // Summary
  console.log('\n📊 Summary:');
  console.log(`   Posts checked: ${stats.postsChecked}`);
  console.log(`   Posts updated: ${stats.postsUpdated}`);
  console.log(`   Blocks checked: ${stats.blocksChecked}`);
  console.log(`   Blocks updated: ${stats.blocksUpdated}`);
  console.log(`   Total replacements: ${stats.totalReplacements}`);

  if (dryRun && stats.totalReplacements > 0) {
    console.log('\n⚠️  Run without --dry-run to apply changes');
  }

  console.log('\n✅ Done!');
}

main().catch(console.error);
