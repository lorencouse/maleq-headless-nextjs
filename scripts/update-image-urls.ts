#!/usr/bin/env bun

/**
 * Update Image URLs Script
 *
 * Converts absolute image URLs in the WordPress database to relative paths
 * so they work across different environments (local, staging, production).
 *
 * Updates:
 * - post_content in posts and reusable blocks (wp_block)
 * - attachment GUIDs to use the local site URL
 *
 * Usage:
 *   bun scripts/update-image-urls.ts [options]
 *
 * Options:
 *   --dry-run       Show what would be updated without making changes
 *   --local-url     The local site URL (default: http://maleq-local.local)
 */

import { getConnection } from './lib/db';

const DEFAULT_LOCAL_URL = 'http://maleq-local.local';

// URL patterns to replace (will be converted to relative paths or local URL)
const URL_PATTERNS = [
  'https://www.maleq.com',
  'https://maleq.com',
  'http://www.maleq.com',
  'http://maleq.com',
  'https://www.maleq.org',
  'https://maleq.org',
  'http://www.maleq.org',
  'http://maleq.org',
  'https://staging.maleq.com',
  'http://staging.maleq.com',
];

interface UpdateOptions {
  dryRun: boolean;
  localUrl: string;
}

interface UpdateStats {
  postsUpdated: number;
  blocksUpdated: number;
  attachmentsUpdated: number;
  totalReplacements: number;
}

function parseArgs(): UpdateOptions {
  const args = process.argv.slice(2);
  const options: UpdateOptions = {
    dryRun: false,
    localUrl: DEFAULT_LOCAL_URL,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--local-url' && i + 1 < args.length) {
      options.localUrl = args[i + 1];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Update Image URLs Script

Converts absolute image URLs in WordPress database to relative paths.

Usage:
  bun scripts/update-image-urls.ts [options]

Options:
  --dry-run          Show what would be updated without making changes
  --local-url <url>  The local site URL (default: ${DEFAULT_LOCAL_URL})
  --help, -h         Show this help message

Examples:
  bun scripts/update-image-urls.ts --dry-run
  bun scripts/update-image-urls.ts
  bun scripts/update-image-urls.ts --local-url http://mysite.local
      `);
      process.exit(0);
    }
  }

  return options;
}

function countReplacements(content: string): number {
  let count = 0;
  for (const pattern of URL_PATTERNS) {
    const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = content.match(regex);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

function replaceUrls(content: string, replacement: string): string {
  let result = content;
  for (const pattern of URL_PATTERNS) {
    const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, replacement);
  }
  return result;
}

async function updatePostContent(
  connection: mysql.Connection,
  options: UpdateOptions,
  stats: UpdateStats
): Promise<void> {
  console.log('\n📝 Updating post_content in posts...');

  // Get all posts with content containing our URL patterns
  const [posts] = await connection.execute(`
    SELECT ID, post_content, post_type, post_title
    FROM wp_posts
    WHERE post_type = 'post'
    AND post_status = 'publish'
    AND (
      post_content LIKE '%maleq.com%'
      OR post_content LIKE '%maleq.org%'
      OR post_content LIKE '%staging.maleq%'
    )
  `) as [any[], any];

  console.log(`   Found ${posts.length} posts with URLs to update`);

  for (const post of posts) {
    const replacements = countReplacements(post.post_content);
    if (replacements === 0) continue;

    stats.totalReplacements += replacements;

    if (options.dryRun) {
      console.log(`   Would update: "${post.post_title.substring(0, 50)}..." (${replacements} URLs)`);
    } else {
      const newContent = replaceUrls(post.post_content, options.localUrl);
      await connection.execute(
        'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
        [newContent, post.ID]
      );
      stats.postsUpdated++;
    }
  }

  if (!options.dryRun) {
    console.log(`   ✅ Updated ${stats.postsUpdated} posts`);
  }
}

async function updateReusableBlocks(
  connection: mysql.Connection,
  options: UpdateOptions,
  stats: UpdateStats
): Promise<void> {
  console.log('\n📦 Updating post_content in reusable blocks...');

  // Get all reusable blocks with content containing our URL patterns
  const [blocks] = await connection.execute(`
    SELECT ID, post_content, post_title
    FROM wp_posts
    WHERE post_type = 'wp_block'
    AND (
      post_content LIKE '%maleq.com%'
      OR post_content LIKE '%maleq.org%'
      OR post_content LIKE '%staging.maleq%'
    )
  `) as [any[], any];

  console.log(`   Found ${blocks.length} reusable blocks with URLs to update`);

  for (const block of blocks) {
    const replacements = countReplacements(block.post_content);
    if (replacements === 0) continue;

    stats.totalReplacements += replacements;

    if (options.dryRun) {
      console.log(`   Would update: "${block.post_title.substring(0, 50)}..." (${replacements} URLs)`);
    } else {
      const newContent = replaceUrls(block.post_content, options.localUrl);
      await connection.execute(
        'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
        [newContent, block.ID]
      );
      stats.blocksUpdated++;
    }
  }

  if (!options.dryRun) {
    console.log(`   ✅ Updated ${stats.blocksUpdated} reusable blocks`);
  }
}

async function updateAttachmentGuids(
  connection: mysql.Connection,
  options: UpdateOptions,
  stats: UpdateStats
): Promise<void> {
  console.log('\n🖼️  Updating attachment GUIDs...');

  // Get all attachments with GUIDs containing our URL patterns
  const [attachments] = await connection.execute(`
    SELECT ID, guid, post_title
    FROM wp_posts
    WHERE post_type = 'attachment'
    AND (
      guid LIKE '%maleq.com%'
      OR guid LIKE '%maleq.org%'
      OR guid LIKE '%staging.maleq%'
    )
  `) as [any[], any];

  console.log(`   Found ${attachments.length} attachments with GUIDs to update`);

  for (const attachment of attachments) {
    const replacements = countReplacements(attachment.guid);
    if (replacements === 0) continue;

    stats.totalReplacements += replacements;

    if (options.dryRun) {
      if (stats.attachmentsUpdated < 5) {
        console.log(`   Would update: ${attachment.guid.substring(0, 70)}...`);
      }
      stats.attachmentsUpdated++;
    } else {
      const newGuid = replaceUrls(attachment.guid, options.localUrl);
      await connection.execute(
        'UPDATE wp_posts SET guid = ? WHERE ID = ?',
        [newGuid, attachment.ID]
      );
      stats.attachmentsUpdated++;
    }
  }

  if (options.dryRun && stats.attachmentsUpdated > 5) {
    console.log(`   ... and ${stats.attachmentsUpdated - 5} more`);
  }

  if (!options.dryRun) {
    console.log(`   ✅ Updated ${stats.attachmentsUpdated} attachment GUIDs`);
  }
}

async function main() {
  const options = parseArgs();
  const stats: UpdateStats = {
    postsUpdated: 0,
    blocksUpdated: 0,
    attachmentsUpdated: 0,
    totalReplacements: 0,
  };

  console.log('🔄 Update Image URLs Script');
  console.log('===========================\n');

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  console.log(`Target URL: ${options.localUrl}`);
  console.log(`Replacing patterns from: ${URL_PATTERNS.slice(0, 3).join(', ')}...`);

  // Connect to database
  console.log('\n🔌 Connecting to local MySQL...');
  const connection = await getConnection();
  console.log('✅ Connected');

  // Update each content type
  await updatePostContent(connection, options, stats);
  await updateReusableBlocks(connection, options, stats);
  await updateAttachmentGuids(connection, options, stats);

  await connection.end();

  // Summary
  console.log('\n📊 Summary:');
  if (options.dryRun) {
    console.log(`   Posts to update: ${stats.postsUpdated || 'checking...'}`);
    console.log(`   Reusable blocks to update: ${stats.blocksUpdated || 'checking...'}`);
    console.log(`   Attachments to update: ${stats.attachmentsUpdated}`);
    console.log(`   Total URL replacements: ${stats.totalReplacements}`);
  } else {
    console.log(`   ✅ Posts updated: ${stats.postsUpdated}`);
    console.log(`   ✅ Reusable blocks updated: ${stats.blocksUpdated}`);
    console.log(`   ✅ Attachments updated: ${stats.attachmentsUpdated}`);
    console.log(`   ✅ Total URL replacements: ${stats.totalReplacements}`);
  }

  console.log('\n✅ Done!');
}

main().catch(console.error);
