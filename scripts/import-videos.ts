#!/usr/bin/env bun

/**
 * Import Videos Script
 *
 * Downloads video files from the production server, saves them to the local
 * WordPress uploads folder, and creates attachment records in the database
 * so they appear in the WP Media Library.
 *
 * Usage:
 *   bun scripts/import-videos.ts [options]
 *
 * Options:
 *   --limit <n>         Limit number of videos to import (default: all)
 *   --dry-run           Show what would be downloaded without actually downloading
 *   --no-skip-existing  Re-download videos that already exist locally
 *   --register-only     Only create DB attachments for videos already on disk (no download)
 */

import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import mysql from 'mysql2/promise';

// Configuration
const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

const LOCAL_UPLOADS_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/uploads';
const WP_SITE_URL = 'http://maleq-local.local';
const PRODUCTION_BASE_URL = 'https://www.maleq.com';

interface ImportOptions {
  limit?: number;
  dryRun: boolean;
  skipExisting: boolean;
  registerOnly: boolean;
}

interface ImportStats {
  total: number;
  downloaded: number;
  registered: number;
  skipped: number;
  alreadyRegistered: number;
  failed: number;
  totalSize: number;
  errors: Array<{ url: string; error: string }>;
}

function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const options: ImportOptions = {
    dryRun: false,
    skipExisting: true,
    registerOnly: false,
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
    } else if (arg === '--register-only') {
      options.registerOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Import Videos Script

Downloads video files from production server to local WordPress uploads
and registers them as attachments in the WP database.

Usage:
  bun scripts/import-videos.ts [options]

Options:
  --limit <n>         Limit number of videos to import (default: all)
  --dry-run           Show what would be done without making changes
  --no-skip-existing  Re-download videos that already exist locally
  --register-only     Only create DB attachments for existing files (no download)
  --help, -h          Show this help message

Examples:
  bun scripts/import-videos.ts --limit 10
  bun scripts/import-videos.ts --dry-run
  bun scripts/import-videos.ts --register-only
      `);
      process.exit(0);
    }
  }

  return options;
}

async function extractVideoUrls(connection: mysql.Connection): Promise<string[]> {
  console.log('Extracting video URLs from posts and reusable blocks...');

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
      if (match.toLowerCase().includes('maleq.com') || match.toLowerCase().includes('maleq.org')) {
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
  const match = videoUrl.match(/wp-content\/uploads\/(.+)$/i);
  if (match) {
    return join(LOCAL_UPLOADS_DIR, match[1]);
  }
  return '';
}

function getRelativePath(videoUrl: string): string {
  const match = videoUrl.match(/wp-content\/uploads\/(.+)$/i);
  return match ? match[1] : '';
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/avi',
    '.ogv': 'video/ogg',
  };
  return mimeMap[ext] || 'video/mp4';
}

async function createAttachment(
  connection: mysql.Connection,
  relativePath: string,
  localPath: string,
): Promise<number | null> {
  const filename = basename(localPath);
  const postName = filename.replace(/\.[^.]+$/, '');
  const title = postName.replace(/-/g, ' ');
  const mimeType = getMimeType(localPath);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const guid = `${WP_SITE_URL}/wp-content/uploads/${relativePath}`;

  // Check if attachment already exists for this file
  const [existing] = await connection.execute(
    `SELECT ID FROM wp_posts WHERE post_type = 'attachment' AND guid = ?`,
    [guid]
  );
  if ((existing as any[]).length > 0) {
    return null; // Already registered
  }

  // Also check with production URL in case it was registered with that
  const prodGuid = `${PRODUCTION_BASE_URL}/wp-content/uploads/${relativePath}`;
  const [existingProd] = await connection.execute(
    `SELECT ID FROM wp_posts WHERE post_type = 'attachment' AND guid = ?`,
    [prodGuid]
  );
  if ((existingProd as any[]).length > 0) {
    return null;
  }

  const [result] = await connection.execute(
    `INSERT INTO wp_posts (
      post_author, post_date, post_date_gmt, post_content, post_title,
      post_excerpt, post_status, comment_status, ping_status, post_password,
      post_name, to_ping, pinged, post_modified, post_modified_gmt,
      post_content_filtered, post_parent, guid, menu_order, post_type, post_mime_type
    ) VALUES (1, ?, ?, '', ?, '', 'inherit', 'open', 'closed', '', ?, '', '', ?, ?, '', 0, ?, 0, 'attachment', ?)`,
    [now, now, title, postName, now, now, guid, mimeType]
  );

  const attachmentId = (result as any).insertId;

  // Get file size
  let fileSize = 0;
  try {
    fileSize = statSync(localPath).size;
  } catch {}

  // Add _wp_attached_file meta
  await connection.execute(
    `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wp_attached_file', ?)`,
    [attachmentId, relativePath]
  );

  // Add basic attachment metadata
  const metadata = `a:2:{s:4:"file";s:${relativePath.length}:"${relativePath}";s:8:"filesize";i:${fileSize};}`;
  await connection.execute(
    `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wp_attachment_metadata', ?)`,
    [attachmentId, metadata]
  );

  return attachmentId;
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
    registered: 0,
    skipped: 0,
    alreadyRegistered: 0,
    failed: 0,
    totalSize: 0,
    errors: [],
  };

  console.log('\nVideo Import Script');
  console.log('===================\n');

  if (options.dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }
  if (options.registerOnly) {
    console.log('REGISTER ONLY MODE - Creating DB records for existing files\n');
  }

  // Connect to database
  console.log('Connecting to local MySQL...');
  const connection = await mysql.createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });
  console.log('Connected\n');

  try {
    // Extract video URLs
    const videoUrls = await extractVideoUrls(connection);
    stats.total = videoUrls.length;

    console.log(`Found ${stats.total} unique videos referenced in content\n`);

    if (stats.total === 0) {
      console.log('No videos found.');
      return;
    }

    const urlsToProcess = options.limit ? videoUrls.slice(0, options.limit) : videoUrls;

    if (options.limit) {
      console.log(`Limited to first ${options.limit} videos\n`);
    }

    console.log('Processing videos...\n');

    for (let i = 0; i < urlsToProcess.length; i++) {
      const url = urlsToProcess[i];
      const localPath = getLocalPath(url);
      const relativePath = getRelativePath(url);

      if (!localPath || !relativePath) {
        stats.failed++;
        stats.errors.push({ url, error: 'Could not determine local path' });
        continue;
      }

      const fileExists = existsSync(localPath);

      // Download if needed (skip in register-only mode)
      if (!options.registerOnly && !fileExists) {
        if (options.dryRun) {
          console.log(`  Would download: ${basename(localPath)}`);
          stats.downloaded++;
          continue;
        }

        try {
          const size = await downloadVideo(url, localPath);
          stats.downloaded++;
          stats.totalSize += size;
          console.log(`  Downloaded: ${basename(localPath)} (${formatBytes(size)})`);
        } catch (error: any) {
          stats.failed++;
          stats.errors.push({ url, error: error.message });
          console.log(`  Failed: ${basename(localPath)} - ${error.message}`);
          continue;
        }

        // Small delay to avoid overwhelming the server
        if (i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } else if (!options.registerOnly && fileExists && options.skipExisting) {
        // File exists, skip download but still register
      }

      // Register as WP attachment (for both downloaded and existing files)
      if (!fileExists && options.registerOnly) {
        stats.skipped++;
        continue;
      }

      if (options.dryRun) {
        console.log(`  Would register: ${basename(localPath)}`);
        stats.registered++;
        continue;
      }

      try {
        const attachmentId = await createAttachment(connection, relativePath, localPath);
        if (attachmentId) {
          stats.registered++;
          if (options.registerOnly || fileExists) {
            console.log(`  Registered: ${basename(localPath)} (ID: ${attachmentId})`);
          }
        } else {
          stats.alreadyRegistered++;
        }
      } catch (error: any) {
        console.log(`  Failed to register: ${basename(localPath)} - ${error.message}`);
      }
    }

    // Summary
    console.log('\n=== Import Summary ===');
    console.log(`Total videos found: ${stats.total}`);
    if (!options.registerOnly) {
      console.log(`Downloaded: ${stats.downloaded}`);
      if (!options.dryRun) {
        console.log(`Total download size: ${formatBytes(stats.totalSize)}`);
      }
    }
    console.log(`Attachments created: ${stats.registered}`);
    console.log(`Already registered: ${stats.alreadyRegistered}`);
    console.log(`Skipped: ${stats.skipped}`);
    console.log(`Failed: ${stats.failed}`);

    if (stats.errors.length > 0 && stats.errors.length <= 20) {
      console.log('\nFailed URLs:');
      for (const err of stats.errors) {
        console.log(`  ${basename(err.url)}: ${err.error}`);
      }
    }
  } finally {
    await connection.end();
  }

  console.log('\nDone!');
}

main().catch(console.error);
