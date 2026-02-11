/**
 * In-memory product cache with TTL and max size.
 * Caches GraphQL responses to avoid repeated queries for the same parameters.
 * Invalidated via /api/revalidate when products are updated in WooCommerce.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 500;

let ttl = DEFAULT_TTL;

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > ttl) {
    cache.delete(key);
    return null;
  }

  return entry.data as T;
}

export function setCache<T>(key: string, data: T): void {
  // Evict oldest entries if at capacity
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }

  cache.set(key, { data, timestamp: Date.now() });
}

export function invalidateAll(): void {
  cache.clear();
}

export function getCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return { size: cache.size, maxSize: MAX_ENTRIES, ttlMs: ttl };
}

export function setTTL(ms: number): void {
  ttl = ms;
}

export function makeCacheKey(prefix: string, params: Record<string, unknown>): string {
  // Sort keys for consistent cache keys regardless of parameter order
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      const val = params[key];
      if (val !== undefined && val !== null && val !== '') {
        acc[key] = val;
      }
      return acc;
    }, {} as Record<string, unknown>);

  return `${prefix}:${JSON.stringify(sorted)}`;
}
