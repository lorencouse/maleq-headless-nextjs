/**
 * Legal cover images via the Pexels API (free, commercial use, no attribution
 * legally required — we add a credit anyway as good practice).
 *
 * Stock photos are thematic, not the actual news event — that's the trade-off for
 * using imagery we're licensed to publish. Source-article photos are copyrighted
 * and are never used.
 *
 * Env: PEXELS_API_KEY
 */
import sharp from 'sharp';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY = process.env.PEXELS_API_KEY || '';

/** Max cover width in px; covers are downscaled (never upscaled) to this. */
const COVER_WIDTH = 1200;
const WEBP_QUALITY = 80;

export const imagesEnabled = Boolean(KEY);

export interface Cover {
  url: string;
  /** Photographer name for the credit line. */
  credit: string;
  /** Photographer's Pexels profile URL. */
  creditUrl: string;
  /** Alt text. */
  alt: string;
}

/** Thematic fallbacks when a tag-based search returns nothing. */
const FALLBACK_QUERIES = ['LGBTQ pride flag', 'rainbow pride community', 'pride parade celebration'];

async function search(query: string): Promise<Cover | null> {
  const url =
    'https://api.pexels.com/v1/search?orientation=landscape&size=large&per_page=15&query=' +
    encodeURIComponent(query);
  try {
    const res = await fetch(url, { headers: { Authorization: KEY }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const data: any = await res.json();
    const photos: any[] = data.photos || [];
    if (!photos.length) return null;
    const p = photos[0]; // Pexels returns by relevance
    const src = p.src?.large2x || p.src?.large || p.src?.original;
    if (!src) return null;
    return {
      url: src,
      credit: String(p.photographer || 'Pexels'),
      creditUrl: String(p.photographer_url || 'https://www.pexels.com'),
      alt: String(p.alt || query),
    };
  } catch {
    return null;
  }
}

/**
 * Pick a cover image from post keywords. Tries the combined top tags, then the
 * single top tag, then generic LGBTQ themes. Returns null only if all fail.
 */
export async function pickCover(keywords: string[]): Promise<Cover | null> {
  if (!imagesEnabled) return null;
  const queries: string[] = [];
  const clean = keywords.map((k) => k.trim()).filter(Boolean);
  if (clean.length) queries.push(clean.slice(0, 3).join(' '));
  if (clean.length) queries.push(clean[0]);
  queries.push(...FALLBACK_QUERIES);

  for (const q of queries) {
    const cover = await search(q);
    if (cover) return cover;
  }
  return null;
}

/**
 * Download a cover, resize to COVER_WIDTH, convert to optimized WebP, and write it
 * to a temp file named after the article slug (SEO). Returns the temp path, or null.
 * The caller imports the file (so WP keeps the slug filename) and then deletes it.
 */
export async function downloadWebp(url: string, slug: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const input = Buffer.from(await res.arrayBuffer());
    const safe = (slug || 'cover').replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').slice(0, 80) || 'cover';
    const out = join(tmpdir(), `${safe}.webp`);
    await sharp(input)
      .rotate() // honor EXIF orientation
      .resize({ width: COVER_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(out);
    return out;
  } catch {
    return null;
  }
}
