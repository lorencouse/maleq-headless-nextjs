#!/usr/bin/env bun
/**
 * Fix broken image URLs in post_content.
 *
 * Scans all published post_content for image URLs (both external maleq.com
 * and relative /wp-content/uploads/... paths), checks each against the local
 * filesystem, and fixes broken ones via:
 *   1. Extension swap: missing .jpg → existing .webp (or vice versa)
 *   2. Size suffix fallback: missing image-650x163.png → existing image.png
 *   3. Download from production: fetch from https://www.maleq.com and save locally
 *
 * Usage:
 *   bun scripts/fix-broken-content-images.ts --analyze     (report what's broken)
 *   bun scripts/fix-broken-content-images.ts --dry-run     (show what fixes would apply)
 *   bun scripts/fix-broken-content-images.ts --apply       (apply fixes + download missing)
 */

import { getConnection } from './lib/db';
import { existsSync, mkdirSync, writeFileSync, readdirSync, promises as fsp } from 'fs';
import { dirname, basename, extname, join } from 'path';

// ─── Constants ──────────────────────────────────────────────────────────────

const WP_ROOT = '/Users/lorencouse/Local Sites/maleq-local/app/public';
const UPLOADS_DIR = join(WP_ROOT, 'wp-content/uploads');
const PRODUCTION_ORIGIN = 'https://www.maleq.com';
const REPORT_PATH = 'data/broken-image-fix-report.json';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];
const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, '.mp4', '.m4v', '.webm', '.pdf'];

// Regex to extract wp-content/uploads image URLs from post_content
// Matches both external (https://www.maleq.com/wp-content/uploads/...) and
// relative (/wp-content/uploads/...) paths
const IMAGE_URL_PATTERNS = [
  // <img src="...">
  /(?:src|data-src)=["']((?:https?:\/\/(?:www\.)?maleq\.com)?\/wp-content\/uploads\/[^"'\s]+)["']/gi,
  // CSS background-image: url(...)
  /url\(["']?((?:https?:\/\/(?:www\.)?maleq\.com)?\/wp-content\/uploads\/[^"')\s]+)["']?\)/gi,
  // <a href="..."> pointing to image files
  /href=["']((?:https?:\/\/(?:www\.)?maleq\.com)?\/wp-content\/uploads\/[^"'\s]+\.(?:jpe?g|png|webp|gif|svg|mp4|m4v|webm|pdf))["']/gi,
  // srcset entries
  /(?:srcset)=["']([^"']+)["']/gi,
];

// WordPress size suffix pattern: -300x200, -1024x768, etc.
const WP_SIZE_SUFFIX = /-\d+x\d+/;

// ─── Types ──────────────────────────────────────────────────────────────────

type Mode = 'analyze' | 'dry-run' | 'apply';

interface BrokenImage {
  postId: number;
  postTitle: string;
  postType: string;
  originalUrl: string;        // URL as found in content
  uploadPath: string;         // relative path under wp-content/uploads/
  localPath: string;          // full filesystem path
  resolution: 'exists' | 'extension-swap' | 'size-fallback' | 'downloaded' | 'unresolvable';
  resolvedUrl?: string;       // new URL to use in content (relative)
  resolvedLocalPath?: string; // the file that was found/downloaded
  error?: string;
}

interface Report {
  timestamp: string;
  mode: Mode;
  summary: {
    totalImagesScanned: number;
    alreadyValid: number;
    fixedExtensionSwap: number;
    fixedSizeFallback: number;
    fixedDownloaded: number;
    unresolvable: number;
    postsUpdated: number;
  };
  fixes: BrokenImage[];
  unresolvable: BrokenImage[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseArgs(): { mode: Mode } {
  const arg = process.argv[2];
  if (arg === '--analyze') return { mode: 'analyze' };
  if (arg === '--dry-run') return { mode: 'dry-run' };
  if (arg === '--apply') return { mode: 'apply' };

  console.log(`Usage: bun scripts/fix-broken-content-images.ts --analyze|--dry-run|--apply

  --analyze   Report broken images without changing anything
  --dry-run   Show what fixes would be applied
  --apply     Apply fixes to database + download missing files`);
  process.exit(1);
}

/** Extract the /wp-content/uploads/... relative path from a URL */
function toRelativeUploadPath(url: string): string {
  return url.replace(/^https?:\/\/(?:www\.)?maleq\.com/, '');
}

/** Get all unique image URLs from post_content */
function extractImageUrls(content: string): Set<string> {
  const urls = new Set<string>();

  for (const pattern of IMAGE_URL_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const raw = match[1];

      // Handle srcset (comma-separated list of "url size" pairs)
      if (match[0].startsWith('srcset')) {
        const entries = raw.split(',');
        for (const entry of entries) {
          const srcUrl = entry.trim().split(/\s+/)[0];
          if (srcUrl && srcUrl.includes('/wp-content/uploads/')) {
            urls.add(srcUrl);
          }
        }
      } else if (raw.includes('/wp-content/uploads/')) {
        urls.add(raw);
      }
    }
  }

  return urls;
}

/** Check if a file exists locally, returning the full path */
function localFileExists(relativePath: string): boolean {
  const fullPath = join(WP_ROOT, relativePath);
  return existsSync(fullPath);
}

/**
 * Try to resolve a broken image by swapping extensions.
 * E.g. missing .jpg → try .webp, .png, .jpeg
 */
function tryExtensionSwap(uploadPath: string): string | null {
  const ext = extname(uploadPath).toLowerCase();
  const base = uploadPath.slice(0, -ext.length);

  for (const altExt of IMAGE_EXTENSIONS) {
    if (altExt === ext) continue;
    const altPath = base + altExt;
    if (existsSync(join(WP_ROOT, altPath))) {
      return altPath;
    }
  }
  return null;
}

/**
 * Try to resolve by removing WordPress size suffix.
 * E.g. image-650x163.png → image.png
 * Also tries extension swaps on the unsized version.
 */
function trySizeFallback(uploadPath: string): string | null {
  const ext = extname(uploadPath);
  const base = uploadPath.slice(0, -ext.length);

  if (!WP_SIZE_SUFFIX.test(base)) return null;

  // Remove the size suffix
  const unsized = base.replace(WP_SIZE_SUFFIX, '') + ext;
  if (existsSync(join(WP_ROOT, unsized))) {
    return unsized;
  }

  // Try extension swaps on unsized version
  const unsizedBase = base.replace(WP_SIZE_SUFFIX, '');
  for (const altExt of IMAGE_EXTENSIONS) {
    const altPath = unsizedBase + altExt;
    if (existsSync(join(WP_ROOT, altPath))) {
      return altPath;
    }
  }

  return null;
}

/**
 * Try to find a case-insensitive match in the same directory.
 * Handles cases where filename case differs from URL.
 */
function tryCaseInsensitiveMatch(uploadPath: string): string | null {
  const dir = dirname(join(WP_ROOT, uploadPath));
  const file = basename(uploadPath).toLowerCase();

  if (!existsSync(dir)) return null;

  try {
    const files = readdirSync(dir);
    const match = files.find(f => f.toLowerCase() === file);
    if (match) {
      const relDir = dirname(uploadPath);
      return join(relDir, match);
    }
  } catch {
    // Directory not readable
  }
  return null;
}

/**
 * Download a file from production maleq.com and save locally.
 */
async function downloadFromProduction(uploadPath: string): Promise<boolean> {
  const url = PRODUCTION_ORIGIN + uploadPath;
  const localPath = join(WP_ROOT, uploadPath);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'MaleQ-Image-Fix/1.0' },
      redirect: 'follow',
    });

    if (!response.ok) {
      return false;
    }

    const contentType = response.headers.get('content-type') || '';
    // Reject HTML responses (404 pages that return 200)
    if (contentType.includes('text/html')) {
      return false;
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 100) {
      return false; // Too small to be a real image
    }

    // Ensure directory exists
    const dir = dirname(localPath);
    mkdirSync(dir, { recursive: true });

    // Write file
    await fsp.writeFile(localPath, Buffer.from(buffer));
    return true;
  } catch {
    return false;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { mode } = parseArgs();
  const conn = await getConnection();

  console.log(`Mode: ${mode.toUpperCase()}`);
  console.log(`WP Root: ${WP_ROOT}`);
  console.log(`Uploads: ${UPLOADS_DIR}\n`);

  try {
    // Query all published content that might contain image URLs
    const [rows] = await conn.query<any[]>(`
      SELECT ID, post_title, post_type, post_content
      FROM wp_posts
      WHERE post_status IN ('publish', 'draft')
        AND post_type IN ('post', 'page', 'wp_block')
        AND (
          post_content LIKE '%/wp-content/uploads/%'
          OR post_content LIKE '%maleq.com/wp-content/uploads/%'
        )
      ORDER BY ID
    `);

    console.log(`Found ${rows.length} posts/blocks with upload URLs\n`);

    let totalScanned = 0;
    let alreadyValid = 0;
    const fixes: BrokenImage[] = [];
    const unresolvable: BrokenImage[] = [];
    const postUpdates = new Map<number, { content: string; title: string; type: string }>();

    for (const row of rows) {
      const urls = extractImageUrls(row.post_content as string);
      if (urls.size === 0) continue;

      for (const originalUrl of urls) {
        totalScanned++;
        const relativePath = toRelativeUploadPath(originalUrl);
        const localPath = join(WP_ROOT, relativePath);

        // Step 1: Already exists?
        if (localFileExists(relativePath)) {
          alreadyValid++;

          // If it was an external URL, still needs converting to relative
          if (originalUrl.startsWith('http')) {
            fixes.push({
              postId: row.ID,
              postTitle: row.post_title,
              postType: row.post_type,
              originalUrl,
              uploadPath: relativePath,
              localPath,
              resolution: 'exists',
              resolvedUrl: relativePath,
              resolvedLocalPath: localPath,
            });
          }
          continue;
        }

        // Build the broken image entry
        const entry: BrokenImage = {
          postId: row.ID,
          postTitle: row.post_title,
          postType: row.post_type,
          originalUrl,
          uploadPath: relativePath,
          localPath,
          resolution: 'unresolvable',
        };

        // Step 2: Case-insensitive match?
        const caseMatch = tryCaseInsensitiveMatch(relativePath);
        if (caseMatch) {
          entry.resolution = 'extension-swap'; // close enough category
          entry.resolvedUrl = caseMatch;
          entry.resolvedLocalPath = join(WP_ROOT, caseMatch);
          fixes.push(entry);
          continue;
        }

        // Step 3: Extension swap?
        const extSwap = tryExtensionSwap(relativePath);
        if (extSwap) {
          entry.resolution = 'extension-swap';
          entry.resolvedUrl = extSwap;
          entry.resolvedLocalPath = join(WP_ROOT, extSwap);
          fixes.push(entry);
          continue;
        }

        // Step 4: Size suffix fallback?
        const sizeFallback = trySizeFallback(relativePath);
        if (sizeFallback) {
          entry.resolution = 'size-fallback';
          entry.resolvedUrl = sizeFallback;
          entry.resolvedLocalPath = join(WP_ROOT, sizeFallback);
          fixes.push(entry);
          continue;
        }

        // Step 5: Download from production (only in apply/dry-run modes)
        if (mode === 'apply') {
          const downloaded = await downloadFromProduction(relativePath);
          if (downloaded) {
            entry.resolution = 'downloaded';
            entry.resolvedUrl = relativePath;
            entry.resolvedLocalPath = localPath;
            fixes.push(entry);
            continue;
          }
        } else if (mode === 'dry-run') {
          // In dry-run, mark as "would download" without actually downloading
          entry.resolution = 'downloaded';
          entry.resolvedUrl = relativePath;
          entry.resolvedLocalPath = localPath;
          fixes.push(entry);
          continue;
        }

        // Unresolvable
        entry.error = `File not found locally and ${mode === 'analyze' ? 'not attempted' : 'failed'} download`;
        unresolvable.push(entry);
      }
    }

    // ─── Apply replacements ─────────────────────────────────────────────

    // Only fixes that actually change the URL need DB updates
    const replacementFixes = fixes.filter(f =>
      f.resolvedUrl && f.originalUrl !== f.resolvedUrl
    );

    // Group by post ID
    const fixesByPost = new Map<number, BrokenImage[]>();
    for (const fix of replacementFixes) {
      const existing = fixesByPost.get(fix.postId) || [];
      existing.push(fix);
      fixesByPost.set(fix.postId, existing);
    }

    let postsUpdated = 0;

    for (const [postId, postFixes] of fixesByPost) {
      const row = rows.find((r: any) => r.ID === postId);
      if (!row) continue;

      let content = row.post_content as string;
      let changed = false;

      // Sort by URL length descending to avoid partial replacement conflicts
      const sorted = [...postFixes].sort((a, b) => b.originalUrl.length - a.originalUrl.length);

      for (const fix of sorted) {
        if (fix.resolvedUrl && content.includes(fix.originalUrl)) {
          content = content.replaceAll(fix.originalUrl, fix.resolvedUrl);
          changed = true;
        }
      }

      if (changed) {
        if (mode === 'apply') {
          await conn.query('UPDATE wp_posts SET post_content = ? WHERE ID = ?', [content, postId]);
          console.log(`Updated [${row.post_type}] ${postId}: ${row.post_title} (${postFixes.length} images)`);
        } else if (mode === 'dry-run') {
          console.log(`[${row.post_type}] Post ${postId}: ${row.post_title}`);
          for (const fix of sorted) {
            if (fix.resolvedUrl && fix.originalUrl !== fix.resolvedUrl) {
              console.log(`  ${fix.originalUrl}`);
              console.log(`  → ${fix.resolvedUrl} [${fix.resolution}]`);
            }
          }
          console.log();
        }
        postsUpdated++;
      }
    }

    // ─── Summary ────────────────────────────────────────────────────────

    const summary = {
      totalImagesScanned: totalScanned,
      alreadyValid,
      fixedExtensionSwap: fixes.filter(f => f.resolution === 'extension-swap').length,
      fixedSizeFallback: fixes.filter(f => f.resolution === 'size-fallback').length,
      fixedDownloaded: fixes.filter(f => f.resolution === 'downloaded').length,
      unresolvable: unresolvable.length,
      postsUpdated,
    };

    console.log('───────────────────────────────────');
    console.log(`Mode: ${mode.toUpperCase()}`);
    console.log(`Total image URLs scanned: ${summary.totalImagesScanned}`);
    console.log(`Already valid (file exists): ${summary.alreadyValid}`);
    console.log(`Fixed via extension swap: ${summary.fixedExtensionSwap}`);
    console.log(`Fixed via size fallback: ${summary.fixedSizeFallback}`);
    console.log(`Fixed via download: ${summary.fixedDownloaded}`);
    console.log(`Unresolvable: ${summary.unresolvable}`);
    console.log(`Posts updated: ${summary.postsUpdated}`);

    if (unresolvable.length > 0) {
      console.log(`\nUnresolvable images:`);
      const seen = new Set<string>();
      for (const u of unresolvable) {
        if (seen.has(u.uploadPath)) continue;
        seen.add(u.uploadPath);
        console.log(`  ${u.uploadPath} (post ${u.postId})`);
      }
    }

    // ─── Write report ───────────────────────────────────────────────────

    const report: Report = {
      timestamp: new Date().toISOString(),
      mode,
      summary,
      fixes: replacementFixes,
      unresolvable,
    };

    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`\nReport written to: ${REPORT_PATH}`);

  } finally {
    await conn.end();
  }
}

main().catch(console.error);
