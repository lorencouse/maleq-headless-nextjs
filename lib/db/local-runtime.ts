import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const LOCAL_RUN_ROOT = join(process.env.HOME || '', 'Library', 'Application Support', 'Local', 'run');
let cachedSocketPath: string | null = null;
let cacheCheckedAt = 0;
const CACHE_TTL_MS = 10_000;

/**
 * Detects the active Local (by Flywheel) MySQL socket.
 * Prefers an explicit env path, then scans Local run directories for mysql/mysqld.sock.
 */
export function detectLocalMysqlSocket(explicitPath?: string): string | null {
  if (explicitPath && existsSync(explicitPath)) return explicitPath;

  const now = Date.now();
  if (cachedSocketPath && now - cacheCheckedAt < CACHE_TTL_MS && existsSync(cachedSocketPath)) {
    return cachedSocketPath;
  }

  try {
    const entries = readdirSync(LOCAL_RUN_ROOT, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory() && entry.name !== 'router')
      .map((entry) => join(LOCAL_RUN_ROOT, entry.name, 'mysql', 'mysqld.sock'))
      .filter((sockPath) => existsSync(sockPath))
      .map((sockPath) => ({
        path: sockPath,
        mtimeMs: statSync(sockPath).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    cachedSocketPath = candidates[0]?.path ?? null;
    cacheCheckedAt = now;
    return cachedSocketPath;
  } catch {
    cacheCheckedAt = now;
    cachedSocketPath = null;
    return null;
  }
}
