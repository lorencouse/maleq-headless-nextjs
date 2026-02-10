#!/usr/bin/env bun

/**
 * Selective Image Import Script
 *
 * Downloads images used in posts and reusable blocks from the live server
 * and imports them into the local WordPress installation.
 *
 * Usage:
 *   bun scripts/import-post-images.ts [options]
 *
 * Options:
 *   --limit <n>     Limit number of images to import (default: all)
 *   --dry-run       Show what would be downloaded without actually downloading
 *   --skip-existing Skip images that already exist locally
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { getConnection } from '../lib/db';

const LOCAL_UPLOADS_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/uploads';
const V1_IMAGES_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/v1-images';
const LIVE_BASE_URL = 'https://www.maleq.com';

// Set to true to use v1-images folder instead of uploads
const USE_V1_IMAGES_DIR = true;

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
Selective Image Import Script

Downloads images used in posts and reusable blocks from the live server.

Usage:
  bun scripts/import-post-images.ts [options]

Options:
  --limit <n>        Limit number of images to import (default: all)
  --dry-run          Show what would be downloaded without downloading
  --no-skip-existing Re-download images that already exist locally
  --help, -h         Show this help message

Examples:
  bun scripts/import-post-images.ts --limit 50
  bun scripts/import-post-images.ts --dry-run
      `);
      process.exit(0);
    }
  }

  return options;
}

async function extractImageUrls(connection: mysql.Connection): Promise<string[]> {
  console.log('📝 Extracting image URLs from posts and reusable blocks...');

  const [rows] = await connection.execute(`
    SELECT post_content
    FROM wp_posts
    WHERE post_type IN ('post', 'wp_block')
    AND post_status = 'publish'
    AND post_content != ''
  `) as [any[], any];

  const imageUrls = new Set<string>();
  const imageRegex = /https?:\/\/[^"'\s<>]+\.(?:jpg|jpeg|png|gif|webp)/gi;

  for (const row of rows) {
    const content = row.post_content || '';
    const matches = content.match(imageRegex) || [];
    for (const match of matches) {
      // Only include maleq.com/maleq.org URLs
      if (match.toLowerCase().includes('maleq.com') || match.toLowerCase().includes('maleq.org')) {
        // Normalize URL to https://www.maleq.com
        let normalizedUrl = match
          .replace(/^http:\/\//i, 'https://')
          .replace(/maleq\.org/i, 'maleq.com')
          .replace(/\/\/maleq\.com/i, '//www.maleq.com')
          .replace(/\/\/MaleQ\.com/i, '//www.maleq.com');

        imageUrls.add(normalizedUrl);
      }
    }
  }

  return Array.from(imageUrls).sort();
}

function getLocalPath(imageUrl: string): string {
  const baseDir = USE_V1_IMAGES_DIR ? V1_IMAGES_DIR : LOCAL_UPLOADS_DIR;

  // Extract the path after wp-content/uploads/
  const match = imageUrl.match(/wp-content\/uploads\/(.+)$/i);
  if (match) {
    return join(baseDir, match[1]);
  }

  // Handle other paths (e.g., plugins)
  const pluginMatch = imageUrl.match(/wp-content\/(.+)$/i);
  if (pluginMatch) {
    return join(baseDir, pluginMatch[1]);
  }

  // Fallback: use the full path after domain
  const pathMatch = imageUrl.match(/maleq\.com\/(.+)$/i);
  if (pathMatch) {
    return join(baseDir, 'imported', pathMatch[1]);
  }

  return '';
}

async function downloadImage(url: string, localPath: string): Promise<boolean> {
  try {
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
    return true;
  } catch (error: any) {
    throw new Error(error.message);
  }
}

async function main() {
  const options = parseArgs();
  const stats: ImportStats = {
    total: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  console.log('🖼️  Selective Image Import Script');
  console.log('================================\n');

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be downloaded\n');
  }

  // Connect to database
  console.log('🔌 Connecting to local MySQL...');
  const connection = await getConnection();
  console.log('✅ Connected\n');

  // Extract image URLs
  const imageUrls = await extractImageUrls(connection);
  stats.total = imageUrls.length;

  console.log(`📦 Found ${stats.total} unique images to import\n`);

  // Apply limit if specified
  const urlsToProcess = options.limit ? imageUrls.slice(0, options.limit) : imageUrls;

  if (options.limit) {
    console.log(`⚠️  Limited to first ${options.limit} images\n`);
  }

  // Process images
  console.log('📥 Downloading images...\n');

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
      console.log(`Would download: ${url}`);
      console.log(`           to: ${localPath}\n`);
      stats.downloaded++;
      continue;
    }

    try {
      await downloadImage(url, localPath);
      stats.downloaded++;

      // Progress indicator
      if (stats.downloaded % 50 === 0 || stats.downloaded === 1) {
        console.log(`   Downloaded ${stats.downloaded}/${urlsToProcess.length - stats.skipped}...`);
      }
    } catch (error: any) {
      stats.failed++;
      stats.errors.push({ url, error: error.message });

      // Show first few errors
      if (stats.failed <= 5) {
        console.log(`   ❌ Failed: ${url.substring(0, 60)}... - ${error.message}`);
      }
    }

    // Small delay to avoid overwhelming the server
    if (!options.dryRun && i % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  await connection.end();

  // Summary
  console.log('\n📊 Import Summary:');
  console.log(`   Total images found: ${stats.total}`);
  console.log(`   ✅ Downloaded: ${stats.downloaded}`);
  console.log(`   ⏭️  Skipped (existing): ${stats.skipped}`);
  console.log(`   ❌ Failed: ${stats.failed}`);

  if (stats.errors.length > 0 && stats.errors.length <= 20) {
    console.log('\n❌ Failed URLs:');
    for (const err of stats.errors) {
      console.log(`   ${err.url}`);
      console.log(`      Error: ${err.error}`);
    }
  } else if (stats.errors.length > 20) {
    console.log(`\n❌ ${stats.errors.length} failures (showing first 10):`);
    for (const err of stats.errors.slice(0, 10)) {
      console.log(`   ${err.url.substring(0, 70)}...`);
    }
  }

  console.log('\n✅ Done!');
}

main().catch(console.error);
