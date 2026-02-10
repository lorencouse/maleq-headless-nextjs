#!/usr/bin/env bun

/**
 * Convert Videos to WebM Script
 *
 * Converts MP4/MOV videos to WebM (VP9) format for better compression.
 * Original files are kept as fallback.
 *
 * Usage:
 *   bun scripts/convert-videos-to-webm.ts [options]
 *
 * Options:
 *   --limit <n>     Limit number of videos to convert (default: all)
 *   --dry-run       Show what would be converted without converting
 *   --skip-existing Skip videos that already have WebM versions
 *   --quality <n>   CRF quality (0-63, lower=better, default: 30)
 */

import { existsSync, statSync, readdirSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { $ } from 'bun';

// Configuration
const LOCAL_UPLOADS_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/uploads';
const VIDEO_EXTENSIONS = ['.mp4', '.mov'];

interface ConvertOptions {
  limit?: number;
  dryRun: boolean;
  skipExisting: boolean;
  quality: number;
}

interface ConvertStats {
  total: number;
  converted: number;
  skipped: number;
  failed: number;
  originalSize: number;
  convertedSize: number;
  errors: Array<{ file: string; error: string }>;
}

function parseArgs(): ConvertOptions {
  const args = process.argv.slice(2);
  const options: ConvertOptions = {
    dryRun: false,
    skipExisting: true,
    quality: 30, // CRF 30 is good balance of quality/size for web
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
    } else if (arg === '--quality' && i + 1 < args.length) {
      options.quality = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Convert Videos to WebM Script

Converts MP4/MOV videos to WebM (VP9) format for better compression.
Original files are kept as fallback for browsers that don't support WebM.

Usage:
  bun scripts/convert-videos-to-webm.ts [options]

Options:
  --limit <n>        Limit number of videos to convert (default: all)
  --dry-run          Show what would be converted without converting
  --no-skip-existing Re-convert videos that already have WebM versions
  --quality <n>      CRF quality 0-63, lower=better (default: 30)
  --help, -h         Show this help message

Examples:
  bun scripts/convert-videos-to-webm.ts --limit 10
  bun scripts/convert-videos-to-webm.ts --dry-run
  bun scripts/convert-videos-to-webm.ts --quality 25
      `);
      process.exit(0);
    }
  }

  return options;
}

function findVideoFiles(dir: string): string[] {
  const videos: string[] = [];

  function walkDir(currentDir: string) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (VIDEO_EXTENSIONS.includes(ext)) {
            videos.push(fullPath);
          }
        }
      }
    } catch (err) {
      // Skip directories we can't read
    }
  }

  walkDir(dir);
  return videos.sort();
}

function getWebmPath(videoPath: string): string {
  const dir = dirname(videoPath);
  const name = basename(videoPath, extname(videoPath));
  return join(dir, `${name}.webm`);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function convertToWebm(
  inputPath: string,
  outputPath: string,
  quality: number
): Promise<void> {
  // VP9 encoding with good quality/speed balance
  // -c:v libvpx-vp9 = VP9 video codec
  // -crf = Constant Rate Factor (quality)
  // -b:v 0 = Let CRF control bitrate
  // -c:a libopus = Opus audio codec
  // -b:a 128k = Audio bitrate
  // -deadline good = Balance between speed and quality
  // -cpu-used 2 = Speed/quality tradeoff (0-5, higher=faster)

  const result = await $`ffmpeg -i ${inputPath} \
    -c:v libvpx-vp9 \
    -crf ${quality} \
    -b:v 0 \
    -c:a libopus \
    -b:a 96k \
    -deadline good \
    -cpu-used 2 \
    -y \
    ${outputPath} 2>&1`.quiet();

  if (result.exitCode !== 0) {
    throw new Error(`FFmpeg failed: ${result.stderr.toString()}`);
  }
}

async function main() {
  const options = parseArgs();
  const stats: ConvertStats = {
    total: 0,
    converted: 0,
    skipped: 0,
    failed: 0,
    originalSize: 0,
    convertedSize: 0,
    errors: [],
  };

  console.log('🎬 Convert Videos to WebM Script');
  console.log('=================================\n');

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be converted\n');
  }

  console.log(`Quality: CRF ${options.quality} (lower = better quality, larger file)`);
  console.log(`Codec: VP9 video + Opus audio\n`);

  // Find all video files
  console.log('🔍 Scanning for video files...');
  const videoFiles = findVideoFiles(LOCAL_UPLOADS_DIR);
  stats.total = videoFiles.length;

  console.log(`📦 Found ${stats.total} video files\n`);

  if (stats.total === 0) {
    console.log('No videos found.');
    return;
  }

  // Apply limit if specified
  const filesToProcess = options.limit ? videoFiles.slice(0, options.limit) : videoFiles;

  if (options.limit) {
    console.log(`⚠️  Limited to first ${options.limit} videos\n`);
  }

  // Process videos
  console.log('🔄 Converting videos...\n');

  for (let i = 0; i < filesToProcess.length; i++) {
    const inputPath = filesToProcess[i];
    const outputPath = getWebmPath(inputPath);
    const filename = basename(inputPath);

    // Check if WebM already exists
    if (options.skipExisting && existsSync(outputPath)) {
      stats.skipped++;
      continue;
    }

    const inputSize = statSync(inputPath).size;
    stats.originalSize += inputSize;

    if (options.dryRun) {
      console.log(`Would convert: ${filename} (${formatBytes(inputSize)})`);
      stats.converted++;
      continue;
    }

    try {
      process.stdout.write(`   [${i + 1}/${filesToProcess.length}] ${filename}...`);

      await convertToWebm(inputPath, outputPath, options.quality);

      const outputSize = statSync(outputPath).size;
      stats.convertedSize += outputSize;
      stats.converted++;

      const savings = ((1 - outputSize / inputSize) * 100).toFixed(1);
      console.log(` ✅ ${formatBytes(inputSize)} → ${formatBytes(outputSize)} (${savings}% smaller)`);
    } catch (error: any) {
      stats.failed++;
      stats.errors.push({ file: filename, error: error.message });
      console.log(` ❌ Failed`);
    }
  }

  // Summary
  console.log('\n📊 Conversion Summary:');
  console.log(`   Total videos found: ${stats.total}`);
  console.log(`   ✅ Converted: ${stats.converted}`);
  console.log(`   ⏭️  Skipped (existing): ${stats.skipped}`);
  console.log(`   ❌ Failed: ${stats.failed}`);

  if (!options.dryRun && stats.converted > 0) {
    const totalSavings = stats.originalSize - stats.convertedSize;
    const savingsPercent = ((totalSavings / stats.originalSize) * 100).toFixed(1);
    console.log(`\n💾 Size Comparison:`);
    console.log(`   Original: ${formatBytes(stats.originalSize)}`);
    console.log(`   WebM: ${formatBytes(stats.convertedSize)}`);
    console.log(`   Saved: ${formatBytes(totalSavings)} (${savingsPercent}%)`);
  }

  if (stats.errors.length > 0 && stats.errors.length <= 10) {
    console.log('\n❌ Failed conversions:');
    for (const err of stats.errors) {
      console.log(`   ${err.file}`);
    }
  }

  console.log('\n✅ Done!');
}

main().catch(console.error);
