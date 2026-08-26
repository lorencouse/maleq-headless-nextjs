/**
 * ISR Disk-Cache Janitor
 *
 * Next.js writes every ISR-rendered page (html/rsc/meta triple) under
 * .next/server/{app,pages} and never evicts them — with 31K products × locales
 * (plus the AUTO_WARM_CACHE warmer re-seeding after each deploy) the cache grew
 * unbounded until it filled the host's 75GB disk (Aug 2026 incident).
 *
 * This janitor enforces two limits on those cache files, oldest-first:
 *   1. Age:  anything older than ISR_CACHE_MAX_AGE_DAYS is deleted
 *            (stale past `revalidate` anyway — Next re-renders on next hit).
 *   2. Size: total is trimmed to ISR_CACHE_MAX_GB.
 *
 * Deleting a cached page is always safe: Next treats a cache miss as
 * "render again" — the exact recovery we exercised manually during the incident.
 * Only *.html / *.rsc / *.meta files are touched; build artifacts (.js,
 * manifests) never match.
 *
 * It also prunes .next/cache/images on the same schedule, under its own cap —
 * see IMAGE_CACHE_DIRS below. Next 16.1.6 never evicts that directory either,
 * and it reached 980K files / 15GB in Aug 2026.
 *
 * Started from instrumentation.ts. Disable with ISR_JANITOR=false.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CACHE_EXTENSIONS = ['.html', '.rsc', '.meta'];
const CACHE_DIRS = ['.next/server/app', '.next/server/pages'];

/**
 * next/image variant cache. Separate target, separate budget: it is a
 * different directory, on this deployment a different disk (a mounted volume,
 * while .next/server sits in the container layer), and it grows for a
 * different reason — one file per (src, width, quality, format) tuple.
 *
 * Next 16.1.6 has NO cap and NO eviction for this directory, so nothing
 * removes these files but us. (16.2+ adds images.maximumDiskCacheSize; when
 * this project upgrades, prefer that and drop this pass.) Everything under
 * the directory is disposable — a miss just re-encodes — so unlike the ISR
 * pass this one matches ALL files rather than an extension list.
 */
const IMAGE_CACHE_DIRS = ['.next/cache/images'];

const MAX_AGE_DAYS = Number(process.env.ISR_CACHE_MAX_AGE_DAYS ?? 14);
const MAX_BYTES = Number(process.env.ISR_CACHE_MAX_GB ?? 5) * 1024 ** 3;
const IMAGE_MAX_AGE_DAYS = Number(process.env.IMAGE_CACHE_MAX_AGE_DAYS ?? 30);
const IMAGE_MAX_BYTES = Number(process.env.IMAGE_CACHE_MAX_GB ?? 3) * 1024 ** 3;
/** Never delete very fresh files, so we can't race an in-flight render. */
const MIN_AGE_MS = 60 * 60 * 1000;

interface CacheFile {
  filePath: string;
  size: number;
  mtimeMs: number;
}

// Appends into `files` rather than returning an array: with 400K+ cache files,
// merging via `push(...spread)` overflows the call stack (each element becomes
// a call argument) — that RangeError silently disabled the janitor for days
// while the cache regrew to 30GB.
async function collectCacheFiles(
  root: string,
  files: CacheFile[],
  extensions: readonly string[] | null
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (extensions && !extensions.some((ext) => entry.name.endsWith(ext))) continue;
    const filePath = path.join(entry.parentPath, entry.name);
    try {
      const s = await stat(filePath);
      files.push({ filePath, size: s.size, mtimeMs: s.mtimeMs });
    } catch {
      // deleted or revalidated between readdir and stat — skip
    }
  }
}

interface PruneResult {
  scanned: number;
  deleted: number;
  freedBytes: number;
  remainingBytes: number;
}

/**
 * Shared oldest-first prune. Both callers below enforce the same two limits
 * (age, then total size) over a different set of directories.
 */
async function pruneTree(
  baseDir: string,
  dirs: readonly string[],
  extensions: readonly string[] | null,
  maxBytes: number,
  maxAgeDays: number
): Promise<PruneResult> {
  const now = Date.now();
  const files: CacheFile[] = [];
  for (const dir of dirs) {
    const root = path.resolve(baseDir, dir);
    if (existsSync(root)) await collectCacheFiles(root, files, extensions);
  }

  // Oldest first, so both the age pass and the size trim walk the same order.
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  let deleted = 0;
  let freedBytes = 0;
  for (const file of files) {
    const age = now - file.mtimeMs;
    if (age < MIN_AGE_MS) break; // everything after this is even fresher
    const overAge = age > maxAgeMs;
    const overSize = totalBytes - freedBytes > maxBytes;
    if (!overAge && !overSize) break;
    try {
      await unlink(file.filePath);
      deleted++;
      freedBytes += file.size;
    } catch {
      // already gone — fine
    }
  }

  return { scanned: files.length, deleted, freedBytes, remainingBytes: totalBytes - freedBytes };
}

/** One ISR prune pass. Exported for tests and manual runs. */
export async function pruneIsrCache(baseDir = process.cwd()): Promise<PruneResult> {
  return pruneTree(baseDir, CACHE_DIRS, CACHE_EXTENSIONS, MAX_BYTES, MAX_AGE_DAYS);
}

/** One next/image variant-cache prune pass. Exported for tests and manual runs. */
export async function pruneImageCache(baseDir = process.cwd()): Promise<PruneResult> {
  return pruneTree(baseDir, IMAGE_CACHE_DIRS, null, IMAGE_MAX_BYTES, IMAGE_MAX_AGE_DAYS);
}

/** Start the recurring janitor: first pass shortly after boot, then hourly. */
export function startIsrCacheJanitor(): void {
  const INITIAL_DELAY_MS = 2 * 60 * 1000;
  // Hourly by default: the Aug 2026 regrowth hit ~1.3GB/hour, so a 6h cadence
  // let usage overshoot the cap by many GB between passes.
  const INTERVAL_MS = Number(process.env.ISR_JANITOR_INTERVAL_HOURS ?? 1) * 60 * 60 * 1000;

  const summarise = (label: string, r: PruneResult, ms: number) =>
    `[isr-janitor] ${label}: scanned ${r.scanned} files, deleted ${r.deleted} ` +
    `(freed ${(r.freedBytes / 1024 ** 3).toFixed(2)}GB, ` +
    `${(r.remainingBytes / 1024 ** 3).toFixed(2)}GB remain, ${ms}ms)`;

  const run = async () => {
    // The two passes are independent and each is wrapped separately: the image
    // cache can hold ~1M files, and a failure walking it must not stop the ISR
    // pass from running (that one is what filled the disk in Aug 2026).
    try {
      const started = Date.now();
      const result = await pruneIsrCache();
      console.log(summarise('isr', result, Date.now() - started));
    } catch (err) {
      console.error('[isr-janitor] isr prune failed:', err);
    }
    try {
      const started = Date.now();
      const result = await pruneImageCache();
      console.log(summarise('images', result, Date.now() - started));
    } catch (err) {
      console.error('[isr-janitor] image prune failed:', err);
    }
  };

  setTimeout(() => {
    void run();
    setInterval(() => void run(), INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();

  console.log(
    `[isr-janitor] enabled — isr ${(MAX_BYTES / 1024 ** 3).toFixed(0)}GB/${MAX_AGE_DAYS}d, ` +
      `images ${(IMAGE_MAX_BYTES / 1024 ** 3).toFixed(0)}GB/${IMAGE_MAX_AGE_DAYS}d, ` +
      `every ${INTERVAL_MS / 3600000}h`
  );
}
