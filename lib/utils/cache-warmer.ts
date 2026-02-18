// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PageType = 'blog' | 'blog-category' | 'blog-tag' | 'category' | 'brand' | 'product';

interface WarmingConfig {
  types?: PageType[];
  concurrency?: number;
  delayMs?: number;
}

interface TypeProgress {
  total: number;
  done: number;
  errors: number;
}

interface WarmingStatus {
  running: boolean;
  startedAt: string | null;
  elapsedMs: number;
  pagesPerSec: number;
  estimatedRemainingSec: number;
  types: Record<string, TypeProgress>;
  totalPages: number;
  totalDone: number;
  totalErrors: number;
  recentErrors: string[];
}

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let running = false;
let abortController: AbortController | null = null;
let startedAt: Date | null = null;
let typeProgress: Record<string, TypeProgress> = {};
let recentErrors: string[] = [];

// Sliding window for pages/sec calculation (timestamps of completed pages)
const completionTimestamps: number[] = [];
const SLIDING_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// URL builders per type (all using SQL / product-index)
// ---------------------------------------------------------------------------

const TYPE_CONFIG: Record<
  PageType,
  {
    fetchSlugs: () => Promise<string[]>;
    pathPrefix: string;
  }
> = {
  blog: {
    fetchSlugs: async () => {
      const { getAllPostSlugs } = await import('@/lib/db/post-queries');
      return getAllPostSlugs();
    },
    pathPrefix: '/guides/',
  },
  'blog-category': {
    fetchSlugs: async () => {
      const { loadBlogCategories } = await import('@/lib/db/blog-loader');
      const cats = await loadBlogCategories();
      return cats.filter(c => (c.count ?? 1) > 0).map(c => c.slug);
    },
    pathPrefix: '/guides/category/',
  },
  'blog-tag': {
    fetchSlugs: async () => {
      const { loadBlogTags } = await import('@/lib/db/blog-loader');
      const tags = await loadBlogTags();
      return tags.filter(t => (t.count ?? 1) > 0).map(t => t.slug);
    },
    pathPrefix: '/guides/tag/',
  },
  category: {
    fetchSlugs: async () => {
      const { loadFlatCategories } = await import('@/lib/db/category-loader');
      const cats = await loadFlatCategories();
      return cats.filter(c => (c.count ?? 0) > 0).map(c => c.slug);
    },
    pathPrefix: '/sex-toys/',
  },
  brand: {
    fetchSlugs: async () => {
      const { loadBrands } = await import('@/lib/db/taxonomy-loader');
      const brands = await loadBrands();
      return brands.filter(b => b.count > 0).map(b => b.slug);
    },
    pathPrefix: '/brand/',
  },
  product: {
    fetchSlugs: async () => {
      const { getAllIndexEntries } = await import('@/lib/products/product-index');
      const entries = await getAllIndexEntries();
      return entries.map(e => e.slug);
    },
    pathPrefix: '/product/',
  },
};

// Priority order for warming (smallest/most important first)
const DEFAULT_TYPE_ORDER: PageType[] = [
  'blog',
  'blog-category',
  'blog-tag',
  'category',
  'brand',
  'product',
];

// ---------------------------------------------------------------------------
// Warming engine
// ---------------------------------------------------------------------------

function recordCompletion() {
  const now = Date.now();
  completionTimestamps.push(now);
  // Prune entries older than the sliding window
  const cutoff = now - SLIDING_WINDOW_MS;
  while (completionTimestamps.length > 0 && completionTimestamps[0] < cutoff) {
    completionTimestamps.shift();
  }
}

function getPagesPerSec(): number {
  if (completionTimestamps.length < 2) return 0;
  const now = Date.now();
  const cutoff = now - SLIDING_WINDOW_MS;
  const recentCount = completionTimestamps.filter((t) => t >= cutoff).length;
  const windowSec = Math.min(SLIDING_WINDOW_MS, now - completionTimestamps[0]) / 1000;
  return windowSec > 0 ? recentCount / windowSec : 0;
}

function addError(message: string) {
  recentErrors.push(message);
  if (recentErrors.length > 50) {
    recentErrors.shift();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function warmUrl(
  path: string,
  signal: AbortSignal,
  timeoutMs = 30_000,
): Promise<boolean> {
  const url = `http://localhost:3000${path}`;
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

    const res = await fetch(url, {
      headers: { 'X-Cache-Warmer': '1' },
      signal: combinedSignal,
    });

    return res.ok;
  } catch (err) {
    if (signal.aborted) return false;
    const message = err instanceof Error ? err.message : String(err);
    addError(`${path}: ${message}`);
    return false;
  }
}

async function warmBatch(
  paths: string[],
  concurrency: number,
  delayMs: number,
  typeName: string,
  signal: AbortSignal,
): Promise<void> {
  for (let i = 0; i < paths.length; i += concurrency) {
    if (signal.aborted) return;

    const batch = paths.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((path) => warmUrl(path, signal)),
    );

    for (const ok of results) {
      typeProgress[typeName].done++;
      recordCompletion();
      if (!ok && !signal.aborted) {
        typeProgress[typeName].errors++;
      }
    }

    if (i + concurrency < paths.length && !signal.aborted) {
      await sleep(delayMs);
    }
  }
}

async function runWarming(config: WarmingConfig): Promise<void> {
  const types = config.types ?? DEFAULT_TYPE_ORDER;
  const concurrency = config.concurrency ?? 3;
  const delayMs = config.delayMs ?? 200;

  const ac = new AbortController();
  abortController = ac;

  try {
    for (const typeName of types) {
      if (ac.signal.aborted) break;

      const cfg = TYPE_CONFIG[typeName];
      if (!cfg) continue;

      console.log(`[cache-warmer] Fetching slugs for ${typeName}...`);
      let slugs: string[];
      try {
        slugs = await cfg.fetchSlugs();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        addError(`Failed to fetch slugs for ${typeName}: ${message}`);
        console.error(`[cache-warmer] Failed to fetch slugs for ${typeName}:`, err);
        continue;
      }

      const paths = slugs.map((slug) => `${cfg.pathPrefix}${slug}`);
      typeProgress[typeName] = { total: paths.length, done: 0, errors: 0 };
      console.log(`[cache-warmer] Warming ${paths.length} ${typeName} pages (concurrency: ${concurrency}, delay: ${delayMs}ms)...`);

      await warmBatch(paths, concurrency, delayMs, typeName, ac.signal);

      if (!ac.signal.aborted) {
        console.log(
          `[cache-warmer] Finished ${typeName}: ${typeProgress[typeName].done}/${typeProgress[typeName].total} (${typeProgress[typeName].errors} errors)`,
        );
      }
    }
  } finally {
    const elapsed = startedAt ? Date.now() - startedAt.getTime() : 0;
    const totalDone = Object.values(typeProgress).reduce((s, t) => s + t.done, 0);
    const totalErrors = Object.values(typeProgress).reduce((s, t) => s + t.errors, 0);
    console.log(
      `[cache-warmer] ${ac.signal.aborted ? 'Stopped' : 'Completed'} in ${Math.round(elapsed / 1000)}s — ${totalDone} pages warmed, ${totalErrors} errors`,
    );
    running = false;
    abortController = null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startWarming(config: WarmingConfig = {}): {
  started: boolean;
  message: string;
} {
  if (running) {
    return { started: false, message: 'Warming is already running' };
  }

  running = true;
  startedAt = new Date();
  typeProgress = {};
  recentErrors = [];
  completionTimestamps.length = 0;

  // Fire-and-forget — the promise runs in the background
  runWarming(config).catch((err) => {
    console.error('[cache-warmer] Unexpected error:', err);
    running = false;
    abortController = null;
  });

  return { started: true, message: 'Cache warming started' };
}

export function stopWarming(): { stopped: boolean; message: string } {
  if (!running || !abortController) {
    return { stopped: false, message: 'Warming is not running' };
  }

  abortController.abort();
  return { stopped: true, message: 'Warming stop requested' };
}

export function getWarmingStatus(): WarmingStatus {
  const now = Date.now();
  const elapsedMs = startedAt && running ? now - startedAt.getTime() : 0;
  const pagesPerSec = running ? getPagesPerSec() : 0;

  const totalPages = Object.values(typeProgress).reduce((s, t) => s + t.total, 0);
  const totalDone = Object.values(typeProgress).reduce((s, t) => s + t.done, 0);
  const totalErrors = Object.values(typeProgress).reduce((s, t) => s + t.errors, 0);

  const remaining = totalPages - totalDone;
  const estimatedRemainingSec =
    pagesPerSec > 0 ? Math.round(remaining / pagesPerSec) : 0;

  return {
    running,
    startedAt: startedAt?.toISOString() ?? null,
    elapsedMs,
    pagesPerSec: Math.round(pagesPerSec * 100) / 100,
    estimatedRemainingSec,
    types: { ...typeProgress },
    totalPages,
    totalDone,
    totalErrors,
    recentErrors: [...recentErrors],
  };
}
