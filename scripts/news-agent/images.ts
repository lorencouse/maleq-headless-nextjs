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
import opentype from 'opentype.js';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.PEXELS_API_KEY || '';

/** Max cover width in px; covers are downscaled (never upscaled) to this. */
const COVER_WIDTH = 1200;
const WEBP_QUALITY = 80;

/**
 * Bundled display font for the social text overlay (Anton, OFL-licensed). We render
 * the headline to vector glyph outlines with opentype.js and rasterize those paths
 * with sharp. This deliberately avoids libvips/Pango text rendering, which resolves
 * fonts through fontconfig — that silently ignores a bundled `fontfile` on macOS and
 * minimal containers and falls back to a generic face. Drawing the outlines ourselves
 * makes the result byte-identical on the dev Mac and the Linux cron.
 */
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'assets');
const FONT_PATH = join(ASSETS_DIR, 'Anton-Regular.ttf');

let _font: opentype.Font | null = null;
function loadFont(): opentype.Font {
  if (!_font) {
    const buf = readFileSync(FONT_PATH);
    _font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return _font;
}

/** Greedy word-wrap to a max pixel width, measuring with the actual font metrics. */
function wrapLines(font: opentype.Font, text: string, fontPx: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    // Keep at least one word per line even if a single word overruns maxWidth.
    if (!cur || font.getAdvanceWidth(trial, fontPx) <= maxWidth) cur = trial;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Fixed card size used for the vertical (portrait-source) split layout — standard OG ratio. */
const CARD_W = 1200;
const CARD_H = 630;
/** Below this width/height ratio a source image is treated as "vertical". */
const VERTICAL_ASPECT = 0.9;

/** Portrait pin size for Pinterest / Instagram (2:5… actually 4:5 — the platform sweet spot). */
const PIN_W = 1080;
const PIN_H = 1350;
const PIN_JPEG_QUALITY = 85;

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
 * Render a headline to a transparent RGBA image, wrapped to `maxWidth`, by drawing the
 * bundled font's glyph outlines as SVG paths and rasterizing with sharp. Returns the
 * PNG buffer plus its rendered pixel dimensions so the caller can position it. White
 * fill — legibility comes from the scrim composited beneath it.
 */
async function renderText(
  text: string,
  fontPx: number,
  maxWidth: number,
  align: 'left' | 'centre',
): Promise<{ data: Buffer; width: number; height: number }> {
  const font = loadFont();
  const lines = wrapLines(font, text, fontPx, maxWidth);
  const scale = fontPx / font.unitsPerEm;
  const ascent = font.ascender * scale;
  const descent = -font.descender * scale;
  const lineGap = Math.round(fontPx * 1.05);

  const widths = lines.map((l) => font.getAdvanceWidth(l, fontPx));
  const blockW = Math.max(1, Math.ceil(Math.max(...widths)));
  const blockH = Math.ceil(ascent + (lines.length - 1) * lineGap + descent);

  const paths = lines
    .map((line, i) => {
      const x = align === 'centre' ? (blockW - widths[i]) / 2 : 0;
      return font.getPath(line, x, ascent + i * lineGap, fontPx).toPathData(2);
    })
    .map((d) => `<path d="${d}"/>`)
    .join('');

  const svg =
    `<svg width="${blockW}" height="${blockH}" xmlns="http://www.w3.org/2000/svg">` +
    `<g fill="#ffffff">${paths}</g></svg>`;
  const data = await sharp(Buffer.from(svg)).png().toBuffer();
  return { data, width: blockW, height: blockH };
}

/**
 * Bottom-scrim layout (landscape/square sources): a dark bottom-to-transparent
 * gradient with the headline anchored bottom-left.
 */
async function composeBottomScrim(baseBuf: Buffer, W: number, H: number, headline: string): Promise<Buffer> {
  const pad = Math.round(W * 0.045);
  const fontPx = Math.round(W * 0.072);
  const txt = await renderText(headline, fontPx, W - pad * 2, 'left');
  const scrim = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0.4" stop-color="#000" stop-opacity="0"/>` +
      `<stop offset="1" stop-color="#000" stop-opacity="0.8"/>` +
      `</linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`,
  );
  return sharp(baseBuf)
    .composite([
      { input: scrim, top: 0, left: 0 },
      { input: txt.data, top: Math.max(0, H - txt.height - pad), left: pad },
    ])
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

/**
 * Vertical-source layout: the portrait photo is pushed flush-right at full card
 * height, a blurred/darkened copy fills the canvas behind it, and the headline sits
 * in the empty space on the left.
 */
async function composeRightImageLeftText(input: Buffer, headline: string): Promise<Buffer> {
  const rightW = Math.round(CARD_W * 0.46);
  const leftW = CARD_W - rightW;

  // Blurred, darkened full-bleed background so the left column isn't a flat block.
  const bg = await sharp(input)
    .rotate()
    .resize({ width: CARD_W, height: CARD_H, fit: 'cover' })
    .blur(40)
    .modulate({ brightness: 0.45 })
    .toBuffer();

  // The crisp photo, cover-cropped to the right column.
  const photo = await sharp(input)
    .rotate()
    .resize({ width: rightW, height: CARD_H, fit: 'cover' })
    .toBuffer();

  // Left-side scrim so white text stays legible over the blurred background.
  const fade = (leftW / CARD_W).toFixed(3);
  const scrim = Buffer.from(
    `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="#000" stop-opacity="0.82"/>` +
      `<stop offset="${fade}" stop-color="#000" stop-opacity="0.5"/>` +
      `<stop offset="1" stop-color="#000" stop-opacity="0"/>` +
      `</linearGradient></defs><rect width="${CARD_W}" height="${CARD_H}" fill="url(#g)"/></svg>`,
  );

  const pad = Math.round(CARD_W * 0.045);
  const fontPx = Math.round(leftW * 0.13);
  const txt = await renderText(headline, fontPx, leftW - pad * 2, 'left');

  return sharp(bg)
    .composite([
      { input: photo, top: 0, left: CARD_W - rightW },
      { input: scrim, top: 0, left: 0 },
      { input: txt.data, top: Math.max(0, Math.round((CARD_H - txt.height) / 2)), left: pad },
    ])
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

/**
 * Compose a portrait social PIN (1080×1350) for Pinterest / Instagram from any source
 * image: a blurred, darkened full-bleed background, the crisp photo as a top "card",
 * and the headline over a bottom scrim. The blurred background means a landscape cover
 * composes cleanly without harsh cropping, so pins reuse the same Pexels cover source.
 * Returns a JPEG buffer (Pinterest/IG don't accept WebP).
 */
export async function composePin(source: Buffer, headline?: string): Promise<Buffer> {
  // Blurred, darkened background fills the whole pin.
  const bg = await sharp(source)
    .rotate()
    .resize({ width: PIN_W, height: PIN_H, fit: 'cover' })
    .blur(40)
    .modulate({ brightness: 0.5 })
    .toBuffer();

  // Crisp photo occupies the top ~60% as a full-bleed card.
  const photoH = Math.round(PIN_H * 0.6);
  const photo = await sharp(source)
    .rotate()
    .resize({ width: PIN_W, height: photoH, fit: 'cover' })
    .toBuffer();

  const composites: sharp.OverlayOptions[] = [{ input: photo, top: 0, left: 0 }];

  const text = (headline || '').trim().toUpperCase();
  if (text) {
    // Scrim fading up from the bottom so the headline (sat in the lower third) reads.
    const scrim = Buffer.from(
      `<svg width="${PIN_W}" height="${PIN_H}" xmlns="http://www.w3.org/2000/svg">` +
        `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0.5" stop-color="#000" stop-opacity="0"/>` +
        `<stop offset="0.72" stop-color="#000" stop-opacity="0.55"/>` +
        `<stop offset="1" stop-color="#000" stop-opacity="0.85"/>` +
        `</linearGradient></defs><rect width="${PIN_W}" height="${PIN_H}" fill="url(#g)"/></svg>`,
    );
    const pad = Math.round(PIN_W * 0.06);
    const fontPx = Math.round(PIN_W * 0.078);
    const txt = await renderText(text, fontPx, PIN_W - pad * 2, 'left');
    composites.push({ input: scrim, top: 0, left: 0 });
    composites.push({ input: txt.data, top: Math.max(0, PIN_H - txt.height - pad), left: pad });
  }

  return sharp(bg).composite(composites).jpeg({ quality: PIN_JPEG_QUALITY }).toBuffer();
}

/**
 * Fetch an image URL and compose a portrait pin from it. Returns the JPEG buffer (and
 * its mime) ready to upload, or null on any fetch/compose failure.
 */
export async function renderPinFromUrl(
  url: string,
  headline?: string,
): Promise<{ data: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const source = Buffer.from(await res.arrayBuffer());
    const data = await composePin(source, headline);
    return { data, mime: 'image/jpeg' };
  } catch {
    return null;
  }
}

/**
 * Download a cover, resize, optionally overlay a punchy social headline, convert to
 * optimized WebP, and write it to a temp file named after the article slug (SEO).
 * Returns the temp path, or null. The caller imports the file (so WP keeps the slug
 * filename) and then deletes it.
 *
 * When `headline` is given, text is composited onto the image:
 *  - landscape/square sources → headline over a dark bottom scrim;
 *  - vertical (portrait) sources → photo pushed flush-right, headline in the left space.
 * Any failure in the overlay step falls back to the plain (text-free) cover so a font
 * or render issue can never block cover attachment.
 */
export async function downloadWebp(url: string, slug: string, headline?: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const input = Buffer.from(await res.arrayBuffer());
    const safe = (slug || 'cover').replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').slice(0, 80) || 'cover';
    const out = join(tmpdir(), `${safe}.webp`);

    // Resize once; we read back the dimensions to decide the overlay layout.
    const { data: baseBuf, info } = await sharp(input)
      .rotate() // honor EXIF orientation
      .resize({ width: COVER_WIDTH, withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });

    const text = (headline || '').trim().toUpperCase();
    if (text) {
      try {
        const aspect = info.width / info.height;
        const composed =
          aspect < VERTICAL_ASPECT
            ? await composeRightImageLeftText(input, text)
            : await composeBottomScrim(baseBuf, info.width, info.height, text);
        await sharp(composed).toFile(out);
        return out;
      } catch (e) {
        console.log(`      overlay render failed, using plain cover: ${(e as Error).message?.slice(0, 120)}`);
      }
    }

    // No headline (or overlay failed): plain optimized WebP.
    await sharp(baseBuf).webp({ quality: WEBP_QUALITY }).toFile(out);
    return out;
  } catch {
    return null;
  }
}
