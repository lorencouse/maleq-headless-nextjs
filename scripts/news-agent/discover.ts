/**
 * Discovery: pull all configured feeds, drop stale/empty items, sort newest-first.
 * Network failures on a single feed are logged and skipped — never fatal.
 */
import { SOURCES, FRESHNESS_HOURS, MAX_PER_FEED } from './config';
import { fetchFeed, type NewsItem } from './rss';

/** Normalize a URL for dedupe/comparison: drop tracking params, trailing slash, fragment. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    // strip common tracking params
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$)/i.test(k)) u.searchParams.delete(k);
    }
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export interface DiscoverResult {
  items: NewsItem[];
  /** Per-feed outcome for the --check-feeds report. */
  feedStatus: { name: string; feed: string; ok: boolean; count: number; error?: string }[];
}

export async function discover(): Promise<DiscoverResult> {
  const cutoff = Date.now() - FRESHNESS_HOURS * 3600_000;
  const feedStatus: DiscoverResult['feedStatus'] = [];

  const settled = await Promise.allSettled(
    SOURCES.map((s) => fetchFeed(s.name, s.feed)),
  );

  const all: NewsItem[] = [];
  settled.forEach((r, i) => {
    const src = SOURCES[i];
    if (r.status === 'fulfilled') {
      const fresh = r.value
        .filter((it) => it.url && it.title)
        .filter((it) => !it.publishedAt || it.publishedAt.getTime() >= cutoff)
        .slice(0, MAX_PER_FEED)
        .map((it) => ({ ...it, url: normalizeUrl(it.url) }));
      all.push(...fresh);
      feedStatus.push({ name: src.name, feed: src.feed, ok: true, count: fresh.length });
    } else {
      feedStatus.push({
        name: src.name,
        feed: src.feed,
        ok: false,
        count: 0,
        error: r.reason?.message || String(r.reason),
      });
    }
  });

  // Dedupe by normalized URL across feeds, then sort newest-first.
  const seen = new Set<string>();
  const items = all
    .filter((it) => (seen.has(it.url) ? false : (seen.add(it.url), true)))
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  return { items, feedStatus };
}
