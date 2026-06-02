/**
 * scrape-brand-logos.ts — download, normalize, and stage brand logos.
 *
 * Source: Brandfetch Brand API (if BRANDFETCH_API_KEY is set) → manufacturer
 * homepage scrape fallback. Each logo is trimmed, resized, and written as WebP
 * to public/brand-logos/<slug>.webp. Then a contact sheet + report are written
 * to scripts/output/ for human review BEFORE the logos are wired into the UI.
 *
 * Usage:
 *   bun run scripts/scrape-brand-logos.ts                 # fetch all missing
 *   bun run scripts/scrape-brand-logos.ts --only doc-johnson-novelties,lelo
 *   bun run scripts/scrape-brand-logos.ts --limit 5       # first 5 (smoke test)
 *   bun run scripts/scrape-brand-logos.ts --force         # re-fetch existing
 *   bun run scripts/scrape-brand-logos.ts --finalize      # AFTER review: build
 *                                                         # lib/brand-logos.ts
 *                                                         # from approved files
 *
 * Review flow: run (no --finalize) → open scripts/output/brand-logos-review.html
 * → DELETE any bad public/brand-logos/*.webp → run --finalize → commit.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import {
  domainOf,
  brandApiCandidates,
  brandfetchCandidates,
  scrapeCandidates,
  fetchImageBuffer,
  type LogoCandidate,
} from './lib/logo-fetch';

const ROOT = join(import.meta.dir ?? __dirname, '..');
const INPUT = join(ROOT, 'scripts/brand-websites.json');
const OUT_DIR = join(ROOT, 'public/brand-logos');
const REPORT_DIR = join(ROOT, 'scripts/output');
const MANIFEST_TS = join(ROOT, 'lib/brand-logos.ts');

// Display target: logo sits on a white tile in BrandHero at ~80px tall.
// Render at 2x for retina, cap width so wide wordmarks stay reasonable.
const TARGET_H = 160;
const MAX_W = 520;
const MIN_USABLE_W = 48;
const WEBP_QUALITY = 90;

// 'light' = dark ink (sits on a white tile); 'dark' = light/white ink (needs a
// dark tile, rendered on the hero gradient).
type LogoTheme = 'light' | 'dark';

interface BrandEntry { slug: string; name?: string; website: string; verified?: boolean }
interface Report {
  slug: string;
  name: string;
  domain: string;
  status: 'ok' | 'failed' | 'skipped';
  source?: string;
  sourceUrl?: string;
  w?: number;
  h?: number;
  theme?: LogoTheme;
  note?: string;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (flag: string) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    finalize: a.includes('--finalize'),
    force: a.includes('--force'),
    limit: get('--limit') ? parseInt(get('--limit')!, 10) : undefined,
    only: get('--only')?.split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/**
 * Decide which tile background a logo needs. The failure mode we guard against
 * is a near-white logo vanishing on a white tile — but a mean-luminance test
 * misfires on thin/antialiased DARK logos (their soft gray edges read light).
 * So we use the dark tile ONLY when the logo has essentially no dark ink:
 * fraction of opaque pixels darker than ~110 luma is below 4%. Any logo with
 * real dark ink stays on the white tile (where dark ink reads correctly).
 */
async function computeTheme(img: sharp.Sharp): Promise<LogoTheme> {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let opaque = 0;
  let dark = 0;
  for (let i = 0; i < data.length; i += ch) {
    const a = ch === 4 ? data[i + 3] : 255;
    if (a < 40) continue; // ignore (near-)transparent pixels
    opaque++;
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (lum < 110) dark++;
  }
  if (opaque === 0) return 'light';
  return dark / opaque < 0.04 ? 'dark' : 'light';
}

/** Decode (rasterizing SVG crisply), trim borders, fit to target, encode WebP. */
async function processToWebp(
  buf: Buffer,
  isSvg: boolean
): Promise<{ out: Buffer; w: number; h: number; theme: LogoTheme } | null> {
  try {
    const input = isSvg ? sharp(buf, { density: 384 }) : sharp(buf);
    const fitted = input
      .trim() // strip uniform border (whitespace / solid bg)
      .resize({ height: TARGET_H, width: MAX_W, fit: 'inside', withoutEnlargement: !isSvg });
    const out = await fitted.clone().webp({ quality: WEBP_QUALITY }).toBuffer();
    const meta = await sharp(out).metadata();
    if (!meta.width || meta.width < MIN_USABLE_W) return null;
    const theme = await computeTheme(fitted.clone());
    return { out, w: meta.width, h: meta.height ?? TARGET_H, theme };
  } catch {
    return null;
  }
}

function isSvgCandidate(c: LogoCandidate, contentType: string): boolean {
  return /svg/i.test(contentType) || /\.svg(\?|$)/i.test(c.url);
}

interface ApiKeys { brandApi?: string; search?: string }

async function fetchOneBrand(brand: BrandEntry, keys: ApiKeys): Promise<Report> {
  const name = brand.name ?? brand.slug;
  const domain = domainOf(brand.website);
  const base: Report = { slug: brand.slug, name, domain, status: 'failed' };

  // Tier 1: Brand API (Bearer) — best quality. Tier 2: Search API (client id).
  // Tier 3: homepage scrape.
  const candidates: LogoCandidate[] = [];
  if (keys.brandApi) {
    try { candidates.push(...(await brandApiCandidates(domain, keys.brandApi))); } catch { /* fall through */ }
  }
  if (keys.search) {
    try { candidates.push(...(await brandfetchCandidates(domain, keys.search, name))); } catch { /* fall through */ }
  }
  try { candidates.push(...(await scrapeCandidates(brand.website))); } catch { /* none */ }

  for (const c of candidates) {
    const dl = await fetchImageBuffer(c.url);
    if (!dl) continue;
    if (/text\/html/i.test(dl.contentType)) continue; // got an error page, not an image
    const processed = await processToWebp(dl.buf, isSvgCandidate(c, dl.contentType));
    if (!processed) continue;
    writeFileSync(join(OUT_DIR, `${brand.slug}.webp`), processed.out);
    return { ...base, status: 'ok', source: c.source, sourceUrl: c.url, w: processed.w, h: processed.h, theme: processed.theme, note: c.note };
  }
  return { ...base, note: candidates.length ? 'no candidate decoded' : 'no candidates found' };
}

function writeContactSheet(reports: Report[]) {
  const ok = reports.filter((r) => r.status === 'ok');
  const failed = reports.filter((r) => r.status === 'failed');
  // Preview each logo on the tile background it will actually use, so the
  // reviewer sees what visitors see (white-ink logos on a dark tile).
  const card = (r: Report) => `
    <div style="border:1px solid #ddd;border-radius:8px;padding:10px;width:220px;font:13px sans-serif">
      <div style="background:${r.theme === 'dark' ? '#4a2a52' : '#fff'};height:90px;display:flex;align-items:center;justify-content:center;border:1px solid #eee;border-radius:6px">
        <img src="../../public/brand-logos/${r.slug}.webp" style="max-height:72px;max-width:200px;object-fit:contain" alt="${r.name}">
      </div>
      <div style="margin-top:8px;font-weight:600">${r.name}</div>
      <div style="color:#666">${r.slug} · ${r.w}×${r.h} · ${r.theme}</div>
      <div style="color:#999;font-size:11px">${r.source} · ${r.note ?? ''}</div>
      <a href="${r.sourceUrl}" style="font-size:11px;word-break:break-all" target="_blank">${r.sourceUrl}</a>
    </div>`;
  const html = `<!doctype html><meta charset="utf-8"><title>Brand logos review</title>
    <body style="font:14px sans-serif;padding:20px;background:#f7f7f7">
    <h1>Brand logo review</h1>
    <p>${ok.length} fetched · ${failed.length} failed. <b>Delete any bad <code>public/brand-logos/*.webp</code></b>, then run <code>--finalize</code>.</p>
    <div style="display:flex;flex-wrap:wrap;gap:14px">${ok.map(card).join('')}</div>
    <h2 style="margin-top:30px">Failed (${failed.length})</h2>
    <ul>${failed.map((r) => `<li>${r.name} (${r.slug}) — ${r.note}</li>`).join('')}</ul>`;
  writeFileSync(join(REPORT_DIR, 'brand-logos-review.html'), html);
  writeFileSync(join(REPORT_DIR, 'brand-logos.report.json'), JSON.stringify(reports, null, 2));
}

/** Rebuild lib/brand-logos.ts from whatever WebP files survive review. */
async function finalize() {
  const files = existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter((f) => f.endsWith('.webp')) : [];
  const entries: string[] = [];
  for (const f of files.sort()) {
    const slug = f.replace(/\.webp$/, '');
    const path = join(OUT_DIR, f);
    const meta = await sharp(path).metadata();
    const theme = await computeTheme(sharp(path));
    entries.push(`  ${JSON.stringify(slug)}: { w: ${meta.width}, h: ${meta.height}, theme: ${JSON.stringify(theme)} },`);
  }
  const ts = `// AUTO-GENERATED by scripts/scrape-brand-logos.ts --finalize. Do not edit by hand.
// Maps a product_brand slug to its logo dimensions + tile theme; the asset is
// public/brand-logos/<slug>.webp. Presence here = approved for display.
// theme 'light' = dark ink on a white tile; 'dark' = light ink on the dark hero tile.
export const BRAND_LOGOS: Record<string, { w: number; h: number; theme: 'light' | 'dark' }> = {
${entries.join('\n')}
};
`;
  writeFileSync(MANIFEST_TS, ts);
  console.log(`Finalized: ${files.length} logo(s) → lib/brand-logos.ts`);
}

async function main() {
  const args = parseArgs();
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });

  if (args.finalize) {
    await finalize();
    return;
  }

  // BRANDFETCH_API holds the Brand Data API key in this project, so it's used
  // for the Brand API (Bearer) AND as the Search client id (?c=). A dedicated
  // BRANDFETCH_BRAND_API_KEY, if set, takes precedence for the Bearer tier.
  const keys: ApiKeys = {
    brandApi: process.env.BRANDFETCH_BRAND_API_KEY || process.env.BRANDFETCH_API,
    search: process.env.BRANDFETCH_API_KEY || process.env.BRANDFETCH_API,
  };
  const tiers = [
    keys.brandApi && 'Brand API (Bearer)',
    keys.search && 'Search API (client id)',
    'homepage scrape',
  ].filter(Boolean);
  console.log(`Logo sources, in order: ${tiers.join(' → ')}.`);

  const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { brands: BrandEntry[] };
  let brands = raw.brands.filter((b) => b.slug && b.website);
  if (args.only) brands = brands.filter((b) => args.only!.includes(b.slug));
  if (!args.force) brands = brands.filter((b) => !existsSync(join(OUT_DIR, `${b.slug}.webp`)));
  if (args.limit) brands = brands.slice(0, args.limit);

  console.log(`Processing ${brands.length} brand(s)...`);
  const reports: Report[] = [];
  for (const b of brands) {
    const r = await fetchOneBrand(b, keys);
    reports.push(r);
    console.log(`  ${r.status === 'ok' ? '✓' : '✗'} ${r.slug}${r.status === 'ok' ? ` (${r.source}, ${r.w}×${r.h})` : ` — ${r.note}`}`);
  }

  writeContactSheet(reports);
  const ok = reports.filter((r) => r.status === 'ok').length;
  console.log(`\nDone: ${ok}/${reports.length} fetched.`);
  console.log(`Review: open scripts/output/brand-logos-review.html, delete bad public/brand-logos/*.webp, then run:`);
  console.log(`  bun run scripts/scrape-brand-logos.ts --finalize`);
}

main();
