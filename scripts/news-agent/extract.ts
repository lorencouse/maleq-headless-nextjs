/**
 * Article-text extraction. Feed summaries are often headline-only, which starves
 * the drafter. This fetches the article page and pulls the paragraph text so the
 * model has real material to write 400–550 words and to corroborate across sources.
 *
 * Best-effort: network/parse failures return '' and the caller falls back to feed
 * content. No heavy readability dependency — just <p> extraction with a noise filter.
 */
import sanitizeHtml from 'sanitize-html';
import type { NewsItem } from './rss';

const UA = 'Mozilla/5.0 (compatible; MaleQ-NewsAgent/1.0; +https://maleq.com)';

function stripTags(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain text of the feed-provided content (content:encoded or description). */
function feedText(item: NewsItem): string {
  const content = stripTags(item.contentHtml);
  return content.length >= item.summary.length ? content : item.summary;
}

/** Fetch the article page and extract its paragraph text. Returns '' on any failure. */
export async function extractArticleText(url: string, maxChars = 5000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(12_000),
      redirect: 'follow',
    });
    if (!res.ok) return '';
    const html = await res.text();

    // Prefer the <article> region when present; otherwise scan the whole document.
    const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
    const region = articleMatch ? articleMatch[0] : html;

    // Collect <p> blocks, strip inner tags, keep substantial paragraphs (filters
    // out nav/footer/caption cruft, which is usually short).
    const paras = [...region.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)]
      .map((m) => stripTags(m[0]))
      .filter((t) => t.length > 40);

    return paras.join('\n\n').slice(0, maxChars);
  } catch {
    return '';
  }
}

/** Richest available material for an item: fetched article text, else feed content. */
export async function gatherMaterial(item: NewsItem, maxChars = 5000): Promise<string> {
  const fed = feedText(item);
  const fetched = await extractArticleText(item.url, maxChars);
  return (fetched.length > fed.length ? fetched : fed).slice(0, maxChars);
}

// ── Social / video embeds ─────────────────────────────────────────────────
// We render embeds as plain <iframe>s pointing at each platform's /embed
// endpoint — no API token, no client script, and it keeps the post on the
// reliable SQL render path. The frontend sanitizer must allow these hostnames.

export interface Embed { platform: string; html: string; }

const figure = (inner: string) => `<figure class="wp-block-embed news-embed">${inner}</figure>`;
const iframe = (src: string, title: string, height: number, extra = '') =>
  `<iframe src="${src}" title="${title}" width="100%" height="${height}" loading="lazy" ${extra}></iframe>`;

const BUILDERS: Record<string, (id: string) => string> = {
  instagram: (c) => figure(iframe(`https://www.instagram.com/p/${c}/embed`, 'Instagram post', 680, 'allowfullscreen')),
  youtube: (id) => figure(iframe(`https://www.youtube.com/embed/${id}`, 'YouTube video', 420, 'allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen')),
  twitter: (id) => figure(iframe(`https://platform.twitter.com/embed/Tweet.html?id=${id}`, 'X post', 600)),
  tiktok: (id) => figure(iframe(`https://www.tiktok.com/embed/v2/${id}`, 'TikTok video', 740, 'allowfullscreen')),
  vimeo: (id) => figure(iframe(`https://player.vimeo.com/video/${id}`, 'Vimeo video', 420, 'allowfullscreen')),
};

/**
 * Find social/video embeds in a source article and return ready-to-insert iframe
 * HTML. Scans the WHOLE document (embeds often sit outside any <article> tag, and
 * post-specific social URLs only appear in real embed widgets — teaser/nav links
 * point at the outlet's own articles, not at instagram/x/tiktok posts). Matches
 * post-specific URLs (not profile pages), dedupes, then interleaves platforms so a
 * capped result shows variety (e.g. one IG + one X + one TikTok) rather than all IG.
 */
export async function extractEmbeds(url: string, max = 3): Promise<Embed[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    });
    if (!res.ok) return [];
    const html = await res.text();

    const byPlatform: Record<string, Embed[]> = {};
    const seen = new Set<string>();
    const collect = (platform: string, re: RegExp) => {
      const arr: Embed[] = (byPlatform[platform] = []);
      for (const m of html.matchAll(re)) {
        const id = m[1];
        const key = `${platform}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        arr.push({ platform, html: BUILDERS[platform](id) });
      }
    };

    collect('instagram', /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/gi);
    collect('youtube', /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/gi);
    collect('tiktok', /tiktok\.com\/@[A-Za-z0-9_.]+\/video\/(\d+)/gi);
    collect('vimeo', /(?:player\.)?vimeo\.com\/(?:video\/)?(\d{6,})/gi);
    // X/Twitter intentionally omitted: its only supported embed is the widgets.js
    // script (blocked by our sanitizer/CSP), and the bare-iframe endpoint renders
    // "not found" unreliably. Re-add if a script-free embed path becomes viable.

    // Round-robin across platforms up to `max`.
    const order = ['instagram', 'youtube', 'tiktok', 'vimeo'];
    const out: Embed[] = [];
    for (let i = 0; out.length < max; i++) {
      let added = false;
      for (const p of order) {
        const e = byPlatform[p]?.[i];
        if (e) { out.push(e); added = true; if (out.length >= max) break; }
      }
      if (!added) break;
    }
    return out;
  } catch {
    return [];
  }
}
