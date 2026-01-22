#!/usr/bin/env bun

/**
 * Import Featured Images Script
 *
 * Downloads featured images from the production server and imports them
 * into the local WordPress installation, creating proper attachment records
 * and linking them to posts via _thumbnail_id postmeta.
 *
 * Usage:
 *   bun scripts/import-featured-images.ts [options]
 *
 * Options:
 *   --limit <n>     Limit number of posts to process (default: all)
 *   --dry-run       Show what would be imported without actually importing
 *   --skip-existing Skip posts that already have a featured image locally
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join, basename, extname } from 'path';
import mysql from 'mysql2/promise';

// Configuration
const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

const LOCAL_UPLOADS_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/uploads';
const SOURCE_GRAPHQL_URL = 'https://staging.maleq.com/graphql';
const IMAGE_BASE_URL = 'https://www.maleq.com'; // Use production for images (staging may be missing some)
const LOCAL_SITE_URL = 'http://maleq-local.local';

interface ImportOptions {
  limit?: number;
  dryRun: boolean;
  skipExisting: boolean;
}

interface FeaturedImageData {
  postId: number;
  postSlug: string;
  postTitle: string;
  imageUrl: string;
  imageAlt: string;
  width: number;
  height: number;
}

interface ImportStats {
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
  alreadyHasFeatured: number;
  errors: Array<{ postTitle: string; error: string }>;
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
Import Featured Images Script

Downloads featured images from production and imports them into local WordPress.

Usage:
  bun scripts/import-featured-images.ts [options]

Options:
  --limit <n>        Limit number of posts to process (default: all)
  --dry-run          Show what would be imported without importing
  --no-skip-existing Re-import images for posts that already have featured images
  --help, -h         Show this help message

Examples:
  bun scripts/import-featured-images.ts --limit 10
  bun scripts/import-featured-images.ts --dry-run
      `);
      process.exit(0);
    }
  }

  return options;
}

async function fetchPostsWithFeaturedImages(): Promise<FeaturedImageData[]> {
  console.log('🌐 Fetching posts with featured images from production...');

  const allPosts: FeaturedImageData[] = [];
  let hasNextPage = true;
  let afterCursor: string | null = null;

  while (hasNextPage) {
    const query = `
      query GetPostsWithFeaturedImages($first: Int!, $after: String) {
        posts(first: $first, after: $after) {
          nodes {
            databaseId
            slug
            title
            featuredImage {
              node {
                sourceUrl
                altText
                mediaDetails {
                  width
                  height
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const response = await fetch(SOURCE_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          first: 100,
          after: afterCursor,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    const posts = data.data.posts.nodes;
    const pageInfo = data.data.posts.pageInfo;

    for (const post of posts) {
      if (post.featuredImage?.node?.sourceUrl) {
        allPosts.push({
          postId: post.databaseId,
          postSlug: post.slug,
          postTitle: post.title,
          imageUrl: post.featuredImage.node.sourceUrl,
          imageAlt: post.featuredImage.node.altText || '',
          width: post.featuredImage.node.mediaDetails?.width || 0,
          height: post.featuredImage.node.mediaDetails?.height || 0,
        });
      }
    }

    hasNextPage = pageInfo.hasNextPage;
    afterCursor = pageInfo.endCursor;

    process.stdout.write(`\r   Fetched ${allPosts.length} posts with featured images...`);
  }

  console.log(''); // New line after progress
  return allPosts;
}

function getLocalPath(imageUrl: string): { fullPath: string; relativePath: string } | null {
  // Extract the path after wp-content/uploads/
  const match = imageUrl.match(/wp-content\/uploads\/(.+)$/i);
  if (match) {
    const relativePath = match[1];
    return {
      fullPath: join(LOCAL_UPLOADS_DIR, relativePath),
      relativePath: relativePath,
    };
  }
  return null;
}

function getProductionImageUrl(imageUrl: string): string {
  // Convert staging URL to production URL for downloading
  const match = imageUrl.match(/wp-content\/uploads\/(.+)$/i);
  if (match) {
    return `${IMAGE_BASE_URL}/wp-content/uploads/${match[1]}`;
  }
  return imageUrl;
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

function getMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return mimeTypes[ext] || 'image/jpeg';
}

async function createAttachmentAndLink(
  connection: mysql.Connection,
  postId: number,
  imageData: FeaturedImageData,
  relativePath: string
): Promise<number> {
  const filename = basename(imageData.imageUrl);
  const mimeType = getMimeType(filename);
  const guid = `${LOCAL_SITE_URL}/wp-content/uploads/${relativePath}`;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Create attachment post
  const [attachmentResult] = await connection.execute(
    `INSERT INTO wp_posts (
      post_author, post_date, post_date_gmt, post_content, post_title,
      post_excerpt, post_status, comment_status, ping_status, post_password,
      post_name, to_ping, pinged, post_modified, post_modified_gmt,
      post_content_filtered, post_parent, guid, menu_order, post_type,
      post_mime_type, comment_count
    ) VALUES (
      1, ?, ?, '', ?,
      '', 'inherit', 'open', 'closed', '',
      ?, '', '', ?, ?,
      '', ?, ?, 0, 'attachment',
      ?, 0
    )`,
    [
      now,
      now,
      imageData.imageAlt || filename,
      filename.replace(/\.[^.]+$/, ''), // post_name without extension
      now,
      now,
      postId, // post_parent
      guid,
      mimeType,
    ]
  ) as [mysql.ResultSetHeader, any];

  const attachmentId = attachmentResult.insertId;

  // Add attachment metadata
  const attachedFile = relativePath;
  await connection.execute(
    `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wp_attached_file', ?)`,
    [attachmentId, attachedFile]
  );

  // Add image metadata if we have dimensions
  if (imageData.width && imageData.height) {
    const imageMetadata = {
      width: imageData.width,
      height: imageData.height,
      file: relativePath,
      sizes: {},
      image_meta: {
        aperture: '0',
        credit: '',
        camera: '',
        caption: '',
        created_timestamp: '0',
        copyright: '',
        focal_length: '0',
        iso: '0',
        shutter_speed: '0',
        title: '',
        orientation: '0',
        keywords: [],
      },
    };

    // PHP serialize the metadata
    const serialized = phpSerialize(imageMetadata);
    await connection.execute(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wp_attachment_metadata', ?)`,
      [attachmentId, serialized]
    );
  }

  // Set featured image on the post
  // First check if _thumbnail_id already exists
  const [existingMeta] = await connection.execute(
    `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = '_thumbnail_id'`,
    [postId]
  ) as [any[], any];

  if (existingMeta.length > 0) {
    await connection.execute(
      `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_thumbnail_id'`,
      [attachmentId, postId]
    );
  } else {
    await connection.execute(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_thumbnail_id', ?)`,
      [postId, attachmentId]
    );
  }

  return attachmentId;
}

// Simple PHP serialization for the metadata
function phpSerialize(obj: any): string {
  if (obj === null) return 'N;';
  if (typeof obj === 'boolean') return `b:${obj ? 1 : 0};`;
  if (typeof obj === 'number') {
    if (Number.isInteger(obj)) return `i:${obj};`;
    return `d:${obj};`;
  }
  if (typeof obj === 'string') return `s:${obj.length}:"${obj}";`;
  if (Array.isArray(obj)) {
    const items = obj.map((v, i) => `${phpSerialize(i)}${phpSerialize(v)}`).join('');
    return `a:${obj.length}:{${items}}`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    const items = keys.map(k => `${phpSerialize(k)}${phpSerialize(obj[k])}`).join('');
    return `a:${keys.length}:{${items}}`;
  }
  return 'N;';
}

async function getPostsWithExistingFeaturedImages(connection: mysql.Connection): Promise<Set<number>> {
  // Only count posts where the _thumbnail_id references an attachment that actually exists
  const [rows] = await connection.execute(
    `SELECT pm.post_id
     FROM wp_postmeta pm
     INNER JOIN wp_posts att ON att.ID = pm.meta_value AND att.post_type = 'attachment'
     WHERE pm.meta_key = '_thumbnail_id'`
  ) as [any[], any];

  return new Set(rows.map((r: any) => r.post_id));
}

async function getLocalPostIds(connection: mysql.Connection): Promise<Set<number>> {
  const [rows] = await connection.execute(
    `SELECT ID FROM wp_posts WHERE post_type = 'post' AND post_status = 'publish'`
  ) as [any[], any];

  return new Set(rows.map((r: any) => r.ID));
}

async function main() {
  const options = parseArgs();
  const stats: ImportStats = {
    total: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    alreadyHasFeatured: 0,
    errors: [],
  };

  console.log('🖼️  Import Featured Images Script');
  console.log('==================================\n');

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be downloaded\n');
  }

  // Fetch posts with featured images from production
  const postsWithImages = await fetchPostsWithFeaturedImages();
  stats.total = postsWithImages.length;

  console.log(`\n📦 Found ${stats.total} posts with featured images on production\n`);

  if (stats.total === 0) {
    console.log('No posts with featured images found.');
    return;
  }

  // Connect to local database
  console.log('🔌 Connecting to local MySQL...');
  const connection = await mysql.createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });
  console.log('✅ Connected\n');

  // Get local post IDs and posts that already have featured images
  const localPostIds = await getLocalPostIds(connection);
  const postsWithExistingFeatured = await getPostsWithExistingFeaturedImages(connection);

  console.log(`📋 Local posts: ${localPostIds.size}`);
  console.log(`📋 Posts already with featured images: ${postsWithExistingFeatured.size}\n`);

  // Apply limit if specified
  const postsToProcess = options.limit ? postsWithImages.slice(0, options.limit) : postsWithImages;

  if (options.limit) {
    console.log(`⚠️  Limited to first ${options.limit} posts\n`);
  }

  // Process posts
  console.log('📥 Importing featured images...\n');

  for (let i = 0; i < postsToProcess.length; i++) {
    const post = postsToProcess[i];

    // Check if post exists locally
    if (!localPostIds.has(post.postId)) {
      stats.skipped++;
      continue;
    }

    // Check if post already has featured image
    if (options.skipExisting && postsWithExistingFeatured.has(post.postId)) {
      stats.alreadyHasFeatured++;
      continue;
    }

    const pathInfo = getLocalPath(post.imageUrl);
    if (!pathInfo) {
      stats.failed++;
      stats.errors.push({ postTitle: post.postTitle, error: 'Could not determine local path' });
      continue;
    }

    // Convert to production URL for downloading (staging may be missing some images)
    const downloadUrl = getProductionImageUrl(post.imageUrl);

    if (options.dryRun) {
      console.log(`Would import: ${post.postTitle}`);
      console.log(`   Image: ${downloadUrl}`);
      console.log(`   To: ${pathInfo.fullPath}\n`);
      stats.downloaded++;
      continue;
    }

    try {
      // Download image if it doesn't exist
      if (!existsSync(pathInfo.fullPath)) {
        await downloadImage(downloadUrl, pathInfo.fullPath);
      }

      // Create attachment and link to post
      await createAttachmentAndLink(connection, post.postId, post, pathInfo.relativePath);

      stats.downloaded++;

      // Progress indicator
      if (stats.downloaded % 10 === 0 || stats.downloaded === 1) {
        console.log(`   Imported ${stats.downloaded} featured images...`);
      }
    } catch (error: any) {
      stats.failed++;
      stats.errors.push({ postTitle: post.postTitle, error: error.message });

      // Show first few errors
      if (stats.failed <= 5) {
        console.log(`   ❌ Failed: ${post.postTitle.substring(0, 50)}... - ${error.message}`);
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
  console.log(`   Total posts with featured images (production): ${stats.total}`);
  console.log(`   ✅ Imported: ${stats.downloaded}`);
  console.log(`   ⏭️  Skipped (post not in local DB): ${stats.skipped}`);
  console.log(`   ⏭️  Skipped (already has featured image): ${stats.alreadyHasFeatured}`);
  console.log(`   ❌ Failed: ${stats.failed}`);

  if (stats.errors.length > 0 && stats.errors.length <= 20) {
    console.log('\n❌ Failed imports:');
    for (const err of stats.errors) {
      console.log(`   ${err.postTitle}`);
      console.log(`      Error: ${err.error}`);
    }
  } else if (stats.errors.length > 20) {
    console.log(`\n❌ ${stats.errors.length} failures (showing first 10):`);
    for (const err of stats.errors.slice(0, 10)) {
      console.log(`   ${err.postTitle.substring(0, 50)}...`);
    }
  }

  console.log('\n✅ Done!');
}

main().catch(console.error);
