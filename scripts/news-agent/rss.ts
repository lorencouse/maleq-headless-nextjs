/**
 * Minimal RSS/Atom fetcher + parser built on the already-installed `xml2js`.
 * Normalizes either feed dialect into a flat list of NewsItem.
 */
import { parseStringPromise } from 'xml2js';
import sanitizeHtml from 'sanitize-html';

export interface NewsItem {
  sourceName: string;
  title: string;
  url: string;
  /** Plain-text summary (HTML stripped) — context for the drafter, never published verbatim. */
  summary: string;
  /** Raw HTML body from the feed, if present (content:encoded / atom content). */
  contentHtml: string;
  /** First image URL found in the entry (enclosure / media:content / inline <img>). */
  imageUrl: string | null;
  /** Publish date, or null if unparseable. */
  publishedAt: Date | null;
  /** Feed-provided unique id, falls back to url. */
  guid: string;
}

const UA =
  'Mozilla/5.0 (compatible; MaleQ-NewsAgent/1.0; +https://maleq.com)';

function first<T>(v: T | T[] | undefined): T | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** xml2js wraps text nodes and attributes; pull the text content out of either shape. */
function text(node: any): string {
  const n = first(node);
  if (n == null) return '';
  if (typeof n === 'string') return n;
  if (typeof n === 'object' && '_' in n) return String(n._ ?? '');
  return '';
}

function stripToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

function findImage(itemHtml: string, raw: any): string | null {
  // 1) RSS <enclosure url="..." type="image/*">
  const enclosure = first<any>(raw.enclosure);
  if (enclosure?.$?.url && /image\//i.test(enclosure.$.type || '')) {
    return enclosure.$.url;
  }
  // 2) media:content / media:thumbnail
  const media = first<any>(raw['media:content']) || first<any>(raw['media:thumbnail']);
  if (media?.$?.url) return media.$.url;
  // 3) first inline <img src>
  const m = itemHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Fetch one feed and normalize to NewsItem[]. Throws on network/parse failure. */
export async function fetchFeed(sourceName: string, feedUrl: string): Promise<NewsItem[]> {
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const xml = await res.text();
  const parsed = await parseStringPromise(xml, { explicitArray: true, trim: true });

  // ── RSS 2.0 ──
  if (parsed.rss?.channel) {
    const channel = first<any>(parsed.rss.channel);
    const items: any[] = channel.item || [];
    return items.map((it) => {
      const contentHtml = text(it['content:encoded']) || text(it.description);
      const url = (text(it.link) || '').trim();
      return {
        sourceName,
        title: stripToText(text(it.title)),
        url,
        summary: stripToText(text(it.description) || contentHtml).slice(0, 1500),
        contentHtml,
        imageUrl: findImage(contentHtml, it),
        publishedAt: parseDate(text(it.pubDate)),
        guid: text(it.guid) || url,
      } as NewsItem;
    });
  }

  // ── Atom ──
  if (parsed.feed?.entry) {
    const entries: any[] = parsed.feed.entry || [];
    return entries.map((e) => {
      const contentHtml = text(e.content) || text(e.summary);
      // Atom link is an array of { $: { href, rel } }; prefer rel="alternate".
      const links: any[] = e.link || [];
      const alt = links.find((l) => l?.$?.rel === 'alternate') || links[0];
      const url = (alt?.$?.href || '').trim();
      return {
        sourceName,
        title: stripToText(text(e.title)),
        url,
        summary: stripToText(text(e.summary) || contentHtml).slice(0, 1500),
        contentHtml,
        imageUrl: findImage(contentHtml, e),
        publishedAt: parseDate(text(e.published) || text(e.updated)),
        guid: text(e.id) || url,
      } as NewsItem;
    });
  }

  throw new Error('Unrecognized feed format (neither RSS <channel> nor Atom <feed>)');
}
