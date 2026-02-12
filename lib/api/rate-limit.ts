/**
 * Simple in-memory rate limiter for API routes.
 *
 * Uses a sliding window approach with automatic cleanup.
 * Note: In a multi-instance deployment (e.g., Vercel serverless), each instance
 * has its own memory, so limits are per-instance. For stricter enforcement,
 * use Upstash Redis rate limiting.
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetTime) {
      store.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
}

/**
 * Check rate limit for a given identifier (typically IP + route).
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  cleanup();

  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const entry = store.get(identifier);

  // No existing entry or window expired - allow and start new window
  if (!entry || now > entry.resetTime) {
    const resetTime = now + windowMs;
    store.set(identifier, { count: 1, resetTime });
    return {
      allowed: true,
      limit: config.limit,
      remaining: config.limit - 1,
      resetTime,
    };
  }

  // Within window - check count
  entry.count++;
  store.set(identifier, entry);

  if (entry.count > config.limit) {
    return {
      allowed: false,
      limit: config.limit,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }

  return {
    allowed: true,
    limit: config.limit,
    remaining: config.limit - entry.count,
    resetTime: entry.resetTime,
  };
}

/** Rate limit presets */
export const RATE_LIMITS = {
  /** Auth endpoints: 10 requests per minute */
  auth: { limit: 10, windowSeconds: 60 } satisfies RateLimitConfig,
  /** Form submissions: 5 requests per minute */
  form: { limit: 5, windowSeconds: 60 } satisfies RateLimitConfig,
  /** General API: 60 requests per minute */
  api: { limit: 60, windowSeconds: 60 } satisfies RateLimitConfig,
} as const;
