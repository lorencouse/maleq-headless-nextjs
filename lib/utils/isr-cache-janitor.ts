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
 * Started from instrumentation.ts. Disable with ISR_JANITOR=false.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CACHE_EXTENSIONS = ['.html', '.rsc', '.meta'];
const CACHE_DIRS = ['.next/server/app', '.next/server/pages'];

const MAX_AGE_DAYS = Number(process.env.ISR_CACHE_MAX_AGE_DAYS ?? 14);
const MAX_BYTES = Number(process.env.ISR_CACHE_MAX_GB ?? 5) * 1024 ** 3;
/** Never delete very fresh files, so we can't race an in-flight render. */
const MIN_AGE_MS = 60 * 60 * 1000;

interface CacheFile {
  filePath: string;
  size: number;
  mtimeMs: number;
}

async function collectCacheFiles(root: string): Promise<CacheFile[]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  const files: CacheFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!CACHE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    const filePath = path.join(entry.parentPath, entry.name);
    try {
      const s = await stat(filePath);
      files.push({ filePath, size: s.size, mtimeMs: s.mtimeMs });
    } catch {
      // deleted or revalidated between readdir and stat — skip
    }
  }
  return files;
}

/** One prune pass. Exported for tests and manual runs. Returns a summary. */
export async function pruneIsrCache(baseDir = process.cwd()): Promise<{
  scanned: number;
  deleted: number;
  freedBytes: number;
  remainingBytes: number;
}> {
  const now = Date.now();
  const files: CacheFile[] = [];
  for (const dir of CACHE_DIRS) {
    const root = path.resolve(baseDir, dir);
    if (existsSync(root)) files.push(...(await collectCacheFiles(root)));
  }

  // Oldest first, so both the age pass and the size trim walk the same order.
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  let deleted = 0;
  let freedBytes = 0;
  for (const file of files) {
    const age = now - file.mtimeMs;
    if (age < MIN_AGE_MS) break; // everything after this is even fresher
    const overAge = age > maxAgeMs;
    const overSize = totalBytes - freedBytes > MAX_BYTES;
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

/** Start the recurring janitor: first pass shortly after boot, then every 6h. */
export function startIsrCacheJanitor(): void {
  const INITIAL_DELAY_MS = 2 * 60 * 1000;
  const INTERVAL_MS = 6 * 60 * 60 * 1000;

  const run = async () => {
    try {
      const started = Date.now();
      const result = await pruneIsrCache();
      console.log(
        `[isr-janitor] scanned ${result.scanned} files, deleted ${result.deleted} ` +
          `(freed ${(result.freedBytes / 1024 ** 3).toFixed(2)}GB, ` +
          `${(result.remainingBytes / 1024 ** 3).toFixed(2)}GB remain, ` +
          `${Date.now() - started}ms)`
      );
    } catch (err) {
      console.error('[isr-janitor] prune failed:', err);
    }
  };

  setTimeout(() => {
    void run();
    setInterval(() => void run(), INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();

  console.log(
    `[isr-janitor] enabled — cap ${(MAX_BYTES / 1024 ** 3).toFixed(0)}GB / max age ${MAX_AGE_DAYS}d, every 6h`
  );
}
