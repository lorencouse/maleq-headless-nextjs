#!/usr/bin/env bun

/**
 * Import Videos Script
 *
 * Downloads video files from the production server and saves them
 * to the local WordPress uploads folder.
 *
 * Usage:
 *   bun scripts/import-videos.ts [options]
 *
 * Options:
 *   --limit <n>     Limit number of videos to import (default: all)
 *   --dry-run       Show what would be downloaded without actually downloading
 *   --skip-existing Skip videos that already exist locally
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import mysql from 'mysql2/promise';

// Configuration
const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

const LOCAL_UPLOADS_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/uploads';
const PRODUCTION_BASE_URL = 'https://www.maleq.com';

interface ImportOptions {
  limit?: number;
  dryRun: boolean;
  skipExisting: boolean;
}

interface ImportStats {
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
  totalSize: number;
  errors: Array<{ url: string; error: string }>;
}

function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const options: ImportOptions = {
    dryRun: false,
    skipExisting: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--no-skip-existing') {
      options.skipExisting = false;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Import Videos Script

Downloads video files from production server to local WordPress uploads.

Usage:
  bun scripts/import-videos.ts [options]

Options:
  --limit <n>        Limit number of videos to import (default: all)
  --dry-run          Show what would be downloaded without downloading
  --no-skip-existing Re-download videos that already exist locally
  --help, -h         Show this help message

Examples:
  bun scripts/import-videos.ts --limit 10
  bun scripts/import-videos.ts --dry-run
      `);
      process.exit(0);
    }
  }

  return options;
}

async function extractVideoUrls(connection: mysql.Connection): Promise<string[]> {
  console.log('📝 Extracting video URLs from posts and reusable blocks...');

  const [rows] = await connection.execute(`
    SELECT post_content
    FROM wp_posts
    WHERE post_type IN ('post', 'wp_block')
    AND (
      post_content LIKE '%maleq%.mp4%'
      OR post_content LIKE '%maleq%.webm%'
      OR post_content LIKE '%maleq%.mov%'
    )
  `) as [any[], any];

  const videoUrls = new Set<string>();
  const videoRegex = /https?:\/\/[^"'\s<>]+\.(mp4|webm|mov)/gi;

  for (const row of rows) {
    const content = row.post_content || '';
    const matches = content.match(videoRegex) || [];
    for (const match of matches) {
      // Only include maleq.com/maleq.org URLs
      if (match.toLowerCase().includes('maleq.com') || match.toLowerCase().includes('maleq.org')) {
        // Normalize URL to https://www.maleq.com
        let normalizedUrl = match
          .replace(/^http:\/\//i, 'https://')
          .replace(/maleq\.org/i, 'maleq.com')
          .replace(/\/\/maleq\.com/i, '//www.maleq.com')
          .replace(/\/\/MaleQ\.com/i, '//www.maleq.com');

        videoUrls.add(normalizedUrl);
      }
    }
  }

  return Array.from(videoUrls).sort();
}

function getLocalPath(videoUrl: string): string {
  // Extract the path after wp-content/uploads/
  const match = videoUrl.match(/wp-content\/uploads\/(.+)$/i);
  if (match) {
    return join(LOCAL_UPLOADS_DIR, match[1]);
  }
  return '';
}

async function downloadVideo(url: string, localPath: string): Promise<number> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();

  // Create directory if it doesn't exist
  const dir = dirname(localPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(localPath, Buffer.from(buffer));
  return buffer.byteLength;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function main() {
  const options = parseArgs();
  const stats: ImportStats = {
    total: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    totalSize: 0,
    errors: [],
  };

  console.log('🎬 Video Import Script');
  console.log('======================\n');

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be downloaded\n');
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

  // Extract video URLs
  const videoUrls = await extractVideoUrls(connection);
  stats.total = videoUrls.length;

  console.log(`📦 Found ${stats.total} unique videos to import\n`);

  await connection.end();

  if (stats.total === 0) {
    console.log('No videos found.');
    return;
  }

  // Apply limit if specified
  const urlsToProcess = options.limit ? videoUrls.slice(0, options.limit) : videoUrls;

  if (options.limit) {
    console.log(`⚠️  Limited to first ${options.limit} videos\n`);
  }

  // Process videos
  console.log('📥 Downloading videos...\n');

  for (let i = 0; i < urlsToProcess.length; i++) {
    const url = urlsToProcess[i];
    const localPath = getLocalPath(url);

    if (!localPath) {
      stats.failed++;
      stats.errors.push({ url, error: 'Could not determine local path' });
      continue;
    }

    // Check if file exists
    if (options.skipExisting && existsSync(localPath)) {
      stats.skipped++;
      continue;
    }

    if (options.dryRun) {
      console.log(`Would download: ${url.substring(url.lastIndexOf('/') + 1)}`);
      stats.downloaded++;
      continue;
    }

    try {
      const size = await downloadVideo(url, localPath);
      stats.downloaded++;
      stats.totalSize += size;

      // Progress indicator
      console.log(`   ✅ [${stats.downloaded}/${urlsToProcess.length - stats.skipped}] ${url.substring(url.lastIndexOf('/') + 1)} (${formatBytes(size)})`);
    } catch (error: any) {
      stats.failed++;
      stats.errors.push({ url, error: error.message });
      console.log(`   ❌ Failed: ${url.substring(url.lastIndexOf('/') + 1)} - ${error.message}`);
    }

    // Small delay to avoid overwhelming the server
    if (!options.dryRun && i % 5 === 0) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Summary
  console.log('\n📊 Import Summary:');
  console.log(`   Total videos found: ${stats.total}`);
  console.log(`   ✅ Downloaded: ${stats.downloaded}`);
  if (!options.dryRun) {
    console.log(`   💾 Total size: ${formatBytes(stats.totalSize)}`);
  }
  console.log(`   ⏭️  Skipped (existing): ${stats.skipped}`);
  console.log(`   ❌ Failed: ${stats.failed}`);

  if (stats.errors.length > 0 && stats.errors.length <= 20) {
    console.log('\n❌ Failed URLs:');
    for (const err of stats.errors) {
      console.log(`   ${err.url.substring(err.url.lastIndexOf('/') + 1)}`);
      console.log(`      Error: ${err.error}`);
    }
  }

  console.log('\n✅ Done!');
}

main().catch(console.error);
