/**
 * logo-fetch.ts — locate a brand logo candidate from Brandfetch (preferred)
 * or by scraping the manufacturer homepage (fallback).
 *
 * Pure fetch/HTML parsing; no image processing (that's the caller's job via
 * sharp). Returns ordered candidates (best first); the caller downloads them
 * in order until one decodes into a usable image.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type LogoSource =
  | 'brandfetch'
  | 'jsonld'
  | 'header-img'
  | 'apple-touch-icon'
  | 'og-image'
  | 'favicon';

export interface LogoCandidate {
  url: string; // absolute URL of the logo asset
  source: LogoSource;
  note?: string; // format/theme/type hints
}

/** Bare registrable host (drops protocol + leading www). */
export function domainOf(siteUrl: string): string {
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, '');
  } catch {
    return siteUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

async function timedFetch(url: string, timeoutMs = 12000): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: '*/*' },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchImageBuffer(
  url: string
): Promise<{ buf: Buffer; contentType: string } | null> {
  const res = await timedFetch(url, 15000);
  if (!res || !res.ok) return null;
  const contentType = res.headers.get('content-type') || '';
  const ab = await res.arrayBuffer();
  if (ab.byteLength < 128) return null; // too tiny to be a real logo
  return { buf: Buffer.from(ab), contentType };
}

/* ─── Brandfetch Brand API ─────────────────────────────────────────────────
 * GET https://api.brandfetch.io/v2/brands/{domain}  (Bearer apiKey)
 * Returns { logos: [{ type, theme, formats: [{ src, format, width, height }] }] }
 * Preference: type logo > symbol > icon; theme light/null (dark ink, sits on a
 * white tile in BrandHero); format svg > largest raster. */
export async function brandfetchCandidates(
  domain: string,
  apiKey: string
): Promise<LogoCandidate[]> {
  const res = await timedFetch(`https://api.brandfetch.io/v2/brands/${domain}`, 12000);
  if (!res || !res.ok) return [];
  let data: any;
  try {
    data = await res.json();
  } catch {
    return [];
  }
  const logos: any[] = Array.isArray(data?.logos) ? data.logos : [];

  const typeRank: Record<string, number> = { logo: 0, symbol: 1, icon: 2 };
  const themeRank = (t: string | null) => (t === 'light' || t == null ? 0 : 1);

  const scored = logos
    .flatMap((l) =>
      (Array.isArray(l.formats) ? l.formats : []).map((f: any) => ({
        url: f.src as string,
        format: f.format as string,
        area: (Number(f.width) || 0) * (Number(f.height) || 0),
        typeR: typeRank[l.type] ?? 3,
        themeR: themeRank(l.theme ?? null),
        type: l.type,
        theme: l.theme ?? 'any',
      }))
    )
    .filter((x) => typeof x.url === 'string' && x.url.startsWith('http'))
    .sort((a, b) => {
      if (a.typeR !== b.typeR) return a.typeR - b.typeR;
      if (a.themeR !== b.themeR) return a.themeR - b.themeR;
      // svg beats raster; otherwise larger raster wins
      const aSvg = a.format === 'svg' ? 1 : 0;
      const bSvg = b.format === 'svg' ? 1 : 0;
      if (aSvg !== bSvg) return bSvg - aSvg;
      return b.area - a.area;
    });

  return scored.map((s) => ({
    url: s.url,
    source: 'brandfetch' as const,
    note: `${s.type}/${s.theme}/${s.format}`,
  }));
}

/* ─── Homepage scrape fallback ───────────────────────────────────────────── */
export async function scrapeCandidates(siteUrl: string): Promise<LogoCandidate[]> {
  const res = await timedFetch(siteUrl, 12000);
  if (!res || !res.ok) return [];
  const finalUrl = res.url || siteUrl;
  const html = await res.text();
  const out: LogoCandidate[] = [];
  const abs = (u: string) => {
    try {
      return new URL(u.trim().replace(/&amp;/g, '&'), finalUrl).href;
    } catch {
      return null;
    }
  };
  const push = (u: string | null | undefined, source: LogoSource, note?: string) => {
    if (!u) return;
    const a = abs(u);
    if (a && !out.some((c) => c.url === a)) out.push({ url: a, source, note });
  };

  // 1) JSON-LD Organization logo (string or { url })
  for (const m of html.matchAll(
    /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      const json = JSON.parse(m[1].trim());
      const nodes = Array.isArray(json) ? json : json['@graph'] ? json['@graph'] : [json];
      for (const n of nodes) {
        const logo = n?.logo;
        if (typeof logo === 'string') push(logo, 'jsonld');
        else if (logo?.url) push(logo.url, 'jsonld');
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  // 2) <img> in markup whose src/class/alt/id mentions "logo"
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/logo/i.test(tag)) continue;
    const src =
      /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1] ||
      /\bdata-src=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src && !/\.(gif)(\?|$)/i.test(src)) push(src, 'header-img');
  }

  // 3) apple-touch-icon (square app icon — decent, often a symbol)
  for (const m of html.matchAll(/<link\b[^>]*rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi)) {
    push(/\bhref=["']([^"']+)["']/i.exec(m[0])?.[1], 'apple-touch-icon');
  }
  // 3b) any rel*="icon" with a non-ico href (often a hi-res png/svg)
  for (const m of html.matchAll(/<link\b[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/gi)) {
    const href = /\bhref=["']([^"']+)["']/i.exec(m[0])?.[1];
    if (href && /\.(png|svg)(\?|$)/i.test(href)) push(href, 'favicon');
  }

  // 4) og:image (usually a hero, last resort before favicon)
  push(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1],
    'og-image'
  );

  // 5) /favicon.ico
  push('/favicon.ico', 'favicon');

  return out;
}
