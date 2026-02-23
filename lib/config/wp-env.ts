/**
 * Auto-switching WordPress environment config.
 *
 * Detects whether Local by Flywheel is actually running by probing the
 * local WordPress URL. Falls back to production if local is down.
 *
 * The detection is async (probes HTTP), but results are cached so subsequent
 * calls are instant. Use `ensureWpEnv()` early in your app to warm the cache.
 *
 * Environment variables:
 *   WP_LOCAL_URL, WP_LOCAL_GRAPHQL  — local WordPress (Local by Flywheel)
 *   WP_PROD_URL, WP_PROD_GRAPHQL   — production WordPress
 *   MYSQL_LOCAL_SOCKET              — socket path used as quick pre-check
 */
import { existsSync } from 'fs';

let detected: 'local' | 'prod' | null = null;
let detecting: Promise<'local' | 'prod'> | null = null;

function stripGraphqlSuffix(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace(/\/graphql$/, '');
}

function getProdWordPressBaseUrl(): string {
  return (
    process.env.WP_PROD_URL ||
    process.env.WOOCOMMERCE_URL ||
    stripGraphqlSuffix(process.env.WP_PROD_GRAPHQL) ||
    stripGraphqlSuffix(process.env.NEXT_PUBLIC_WORDPRESS_API_URL) ||
    stripGraphqlSuffix(process.env.WORDPRESS_API_URL) ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://wp.maleq.com'
  );
}

function getProdGraphqlUrl(): string {
  return (
    process.env.WP_PROD_GRAPHQL ||
    process.env.NEXT_PUBLIC_WORDPRESS_API_URL ||
    process.env.WORDPRESS_API_URL ||
    `${getProdWordPressBaseUrl().replace(/\/$/, '')}/graphql`
  );
}

function hasLocalConfig(): boolean {
  return !!(process.env.WP_LOCAL_URL && process.env.WP_LOCAL_GRAPHQL);
}

function socketExists(): boolean {
  const socket = process.env.MYSQL_LOCAL_SOCKET;
  if (!socket) return false;
  try { return existsSync(socket); } catch { return false; }
}

/** Probe the local WordPress to see if it's actually responding */
async function probeLocal(): Promise<boolean> {
  if (!hasLocalConfig() || !socketExists()) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(process.env.WP_LOCAL_URL!, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok || res.status === 301 || res.status === 302;
  } catch {
    return false;
  }
}

/** Async detection — probes local WP, caches result */
async function detectMode(): Promise<'local' | 'prod'> {
  if (detected) return detected;

  if (await probeLocal()) {
    detected = 'local';
    console.log(`🟢 Local WordPress (${process.env.WP_LOCAL_URL})`);
  } else {
    detected = 'prod';
    console.log(`🟠 Production WordPress (${getProdWordPressBaseUrl()})`);
  }
  return detected;
}

/** Get mode, kick off async detection if not cached yet */
function getModeSyncFallback(): 'local' | 'prod' {
  if (detected) return detected;
  // If async detection hasn't completed yet, do a quick sync check
  // (socket exists = likely local, but may be stale — async will correct)
  if (!detecting) {
    detecting = detectMode();
  }
  // Quick sync heuristic: if socket doesn't exist, definitely prod
  if (!hasLocalConfig() || !socketExists()) {
    detected = 'prod';
    return 'prod';
  }
  // Socket exists but we haven't confirmed yet — optimistically use prod
  // (safer default; async detection will update for subsequent calls)
  return 'prod';
}

/** Warm up detection — call early (e.g. in layout or middleware) */
export async function ensureWpEnv(): Promise<void> {
  if (!detecting) {
    detecting = detectMode();
  }
  await detecting;
}

/** WordPress base URL (no trailing slash) */
export function getWordPressUrl(): string {
  const mode = getModeSyncFallback();
  return mode === 'local'
    ? process.env.WP_LOCAL_URL!
    : getProdWordPressBaseUrl();
}

/** WPGraphQL endpoint */
export function getGraphqlUrl(): string {
  const mode = getModeSyncFallback();
  return mode === 'local'
    ? process.env.WP_LOCAL_GRAPHQL!
    : getProdGraphqlUrl();
}

/** WooCommerce base URL (same as WordPress base) */
export function getWooCommerceUrl(): string {
  return process.env.WOOCOMMERCE_URL || getWordPressUrl();
}

/** Returns which WordPress environment is active */
export function getWpMode(): 'local' | 'prod' {
  return getModeSyncFallback();
}

/** Reset cached detection (useful for tests) */
export function resetWpEnv(): void {
  detected = null;
  detecting = null;
}
