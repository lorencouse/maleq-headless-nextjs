#!/usr/bin/env bun

/**
 * Remove Leading Line Breaks from Review Blocks
 *
 * Removes <br> tags and whitespace at the beginning of .review content.
 *
 * Usage:
 *   bun scripts/remove-review-linebreaks.ts [options]
 *
 * Options:
 *   --dry-run    Show what would be changed without making changes
 */

import { getConnection } from './lib/db';

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
Remove Leading Line Breaks from Review Blocks

Removes <br> tags and whitespace at the beginning of .review content.

Usage:
  bun scripts/remove-review-linebreaks.ts [options]

Options:
  --dry-run    Show what would be changed without making changes
  --help, -h   Show this help message
      `);
      process.exit(0);
    }
  }

  return { dryRun };
}

function removeLeadingLinebreaks(content: string): { newContent: string; replacements: number } {
  let replacements = 0;
  let newContent = content;

  // Pattern to match .review class elements with leading <br> tags or whitespace
  // Captures: opening tag, leading breaks/whitespace, actual content
  const patterns = [
    // Direct content after review class tag: <p class="review">   <br>   text
    /(<[^>]*class="[^"]*review[^"]*"[^>]*>)(\s*(?:<br\s*\/?>\s*)+)/gi,
    // Nested content: <p class="review"><span>   <br>   text
    /(<[^>]*class="[^"]*review[^"]*"[^>]*>\s*<[^>]+>)(\s*(?:<br\s*\/?>\s*)+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(newContent)) !== null) {
      replacements++;
    }
    // Reset regex
    pattern.lastIndex = 0;
    newContent = newContent.replace(pattern, '$1');
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

  console.log('🔧 Remove Leading Line Breaks from Reviews');
  console.log('==========================================\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Connect to database
  console.log('🔌 Connecting to local MySQL...');
  const connection = await getConnection();
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
    const { newContent, replacements } = removeLeadingLinebreaks(post.post_content);

    if (replacements > 0) {
      stats.totalReplacements += replacements;
      stats.postsUpdated++;

      console.log(`   ✏️  Post: "${post.post_title}" - ${replacements} linebreak(s) removed`);

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
    const { newContent, replacements } = removeLeadingLinebreaks(block.post_content);

    if (replacements > 0) {
      stats.totalReplacements += replacements;
      stats.blocksUpdated++;

      console.log(`   ✏️  Block: "${block.post_title}" - ${replacements} linebreak(s) removed`);

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
  console.log(`   Total linebreaks removed: ${stats.totalReplacements}`);

  if (dryRun && stats.totalReplacements > 0) {
    console.log('\n⚠️  Run without --dry-run to apply changes');
  }

  console.log('\n✅ Done!');
}

main().catch(console.error);
