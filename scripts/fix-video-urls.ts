#!/usr/bin/env bun

/**
 * Fix Video URLs in Database Content
 *
 * Converts absolute video URLs (https://www.maleq.com/wp-content/uploads/...)
 * to relative paths (/wp-content/uploads/...) in posts, reusable blocks,
 * and revisions.
 *
 * Usage:
 *   bun scripts/fix-video-urls.ts --dry-run
 *   bun scripts/fix-video-urls.ts --execute
 */

import mysql from 'mysql2/promise';

const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

// All domain variants that might appear in video URLs
const DOMAINS_TO_STRIP = [
  'https://www.maleq.com',
  'https://maleq.com',
  'http://www.maleq.com',
  'http://maleq.com',
  'https://www.maleq.org',
  'https://maleq.org',
  'http://www.maleq.org',
  'http://maleq.org',
  'http://maleq-local.local',
  'https://maleq-local.local',
];

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'ogv'];

interface FixStats {
  postsScanned: number;
  postsUpdated: number;
  urlsFixed: number;
  byPostType: Record<string, number>;
  samples: Array<{ id: number; old: string; new: string }>;
}

function parseArgs(): { execute: boolean } {
  const args = process.argv.slice(2);
  let execute = false;

  for (const arg of args) {
    if (arg === '--execute') execute = true;
    else if (arg === '--dry-run') execute = false;
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Fix Video URLs in Database Content

Converts absolute video URLs to relative paths (/wp-content/uploads/...).

Usage:
  bun scripts/fix-video-urls.ts --dry-run    Preview changes (default)
  bun scripts/fix-video-urls.ts --execute    Apply changes
      `);
      process.exit(0);
    }
  }

  return { execute };
}

function fixVideoUrls(content: string): { content: string; fixCount: number; samples: string[][] } {
  let fixCount = 0;
  const samples: string[][] = [];
  let result = content;

  for (const domain of DOMAINS_TO_STRIP) {
    // Build pattern: domain + /wp-content/uploads/path/to/file.{video_ext}
    const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const extPattern = VIDEO_EXTENSIONS.join('|');
    const regex = new RegExp(
      `${escaped}(/wp-content/uploads/[^"'\\s<>]+\\.(?:${extPattern}))`,
      'gi'
    );

    result = result.replace(regex, (match, relativePath) => {
      fixCount++;
      if (samples.length < 3) {
        samples.push([match, relativePath]);
      }
      return relativePath;
    });
  }

  return { content: result, fixCount, samples };
}

async function main() {
  const { execute } = parseArgs();

  console.log('\nFix Video URLs');
  console.log('==============\n');
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}\n`);

  const connection = await mysql.createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });

  console.log('Connected to database\n');

  const stats: FixStats = {
    postsScanned: 0,
    postsUpdated: 0,
    urlsFixed: 0,
    byPostType: {},
    samples: [],
  };

  try {
    // Get all posts that might contain video URLs
    const videoLikePatterns = VIDEO_EXTENSIONS
      .map(ext => `p.post_content LIKE '%.${ext}%'`)
      .join(' OR ');

    const [rows] = await connection.execute(`
      SELECT p.ID, p.post_type, p.post_content
      FROM wp_posts p
      WHERE p.post_type IN ('post', 'wp_block', 'revision', 'product', 'wp_template', 'wp_template_part', 'wp_navigation')
        AND (${videoLikePatterns})
      ORDER BY p.ID ASC
    `);

    const posts = rows as any[];
    console.log(`Found ${posts.length} posts with video references\n`);

    for (const post of posts) {
      stats.postsScanned++;
      const { content: fixedContent, fixCount, samples } = fixVideoUrls(post.post_content);

      if (fixCount === 0) continue;

      stats.postsUpdated++;
      stats.urlsFixed += fixCount;
      stats.byPostType[post.post_type] = (stats.byPostType[post.post_type] || 0) + 1;

      // Collect samples for display
      for (const [oldUrl, newUrl] of samples) {
        if (stats.samples.length < 10) {
          stats.samples.push({ id: post.ID, old: oldUrl, new: newUrl });
        }
      }

      console.log(`  [#${post.ID}] ${post.post_type} — ${fixCount} URL(s) fixed`);

      if (execute) {
        await connection.execute(
          `UPDATE wp_posts SET post_content = ? WHERE ID = ?`,
          [fixedContent, post.ID]
        );
      }
    }

    // Summary
    console.log('\n=== Summary ===');
    console.log(`Posts scanned: ${stats.postsScanned}`);
    console.log(`Posts ${execute ? 'updated' : 'to update'}: ${stats.postsUpdated}`);
    console.log(`URLs ${execute ? 'fixed' : 'to fix'}: ${stats.urlsFixed}`);

    if (Object.keys(stats.byPostType).length > 0) {
      console.log('\nBy post type:');
      for (const [type, count] of Object.entries(stats.byPostType)) {
        console.log(`  ${type}: ${count}`);
      }
    }

    if (stats.samples.length > 0) {
      console.log('\nSample conversions:');
      for (const s of stats.samples) {
        console.log(`  [#${s.id}] ${s.old}`);
        console.log(`       → ${s.new}`);
      }
    }

    if (!execute && stats.postsUpdated > 0) {
      console.log('\nRun with --execute to apply changes.');
    }
  } finally {
    await connection.end();
  }

  console.log('\nDone!');
}

main().catch(console.error);
