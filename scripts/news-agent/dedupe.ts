/**
 * Dedupe: skip any story we've already turned into a post. Source URLs are stored
 * in wp_postmeta (_maleq_news_source_url for the primary, _maleq_news_source_urls
 * for every cited source), so we drop a feed item if EITHER marker matches — this
 * also stops a story we covered via one outlet from being re-posted via another.
 * Same-story grouping across outlets is handled separately by cluster.ts.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { META } from './config';
import type { NewsItem } from './rss';

export async function filterUnseen(db: Connection, items: NewsItem[]): Promise<NewsItem[]> {
  if (items.length === 0) return [];

  const urls = items.map((i) => i.url);
  const placeholders = urls.map(() => '?').join(',');

  // Primary-source markers: exact match on a stored URL.
  const [primaryRows] = await db.query<RowDataPacket[]>(
    `SELECT meta_value FROM wp_postmeta WHERE meta_key = ? AND meta_value IN (${placeholders})`,
    [META.sourceUrl, ...urls],
  );
  const known = new Set(primaryRows.map((r) => String(r.meta_value)));

  // Multi-source markers are JSON arrays of URLs; pull them all and add any matches.
  const [multiRows] = await db.query<RowDataPacket[]>(
    `SELECT meta_value FROM wp_postmeta WHERE meta_key = ?`,
    [META.sourceUrls],
  );
  const urlSet = new Set(urls);
  for (const r of multiRows) {
    try {
      for (const u of JSON.parse(String(r.meta_value)) as string[]) {
        if (urlSet.has(u)) known.add(u);
      }
    } catch { /* ignore malformed */ }
  }

  return items.filter((it) => !known.has(it.url));
}
