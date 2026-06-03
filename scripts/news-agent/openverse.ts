/**
 * Secondary free portrait source: Openverse (WordPress.org's CC search), used
 * only when Wikimedia Commons has no usable portrait. Openverse indexes 800M+
 * openly-licensed images from Flickr, Wikimedia, museums, etc. — so it reaches
 * Flickr's Creative Commons photos WITHOUT a Flickr Pro/API key.
 *
 * We request only licenses that allow BOTH commercial use AND modification
 * (license_type=commercial,modification) — that excludes NC and ND automatically,
 * matching what a commercial editorial blog that resizes images may reuse. Each
 * result carries creator + license + links, which we turn into attribution.
 *
 * Anonymous access works (low rate limit). For higher limits set the optional
 * OPENVERSE_CLIENT_ID / OPENVERSE_CLIENT_SECRET (free, instant, no Pro:
 * https://api.openverse.org/v1/auth_tokens/register/). Best-effort matching like
 * any name search: we require the queried name to appear in the result title.
 */
import type { Cover } from './images';

const API = 'https://api.openverse.org/v1';
const UA = 'MaleQ-NewsAgent/1.0 (https://maleq.com; editorial cover images)';
const CLIENT_ID = process.env.OPENVERSE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.OPENVERSE_CLIENT_SECRET || '';

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Optional OAuth (client-credentials) for higher rate limits. Null = anonymous. */
async function getToken(): Promise<string | null> {
  if (!CLIENT_ID || !CLIENT_SECRET) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  try {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    const res = await fetch(`${API}/auth_tokens/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body,
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    if (!j.access_token) return null;
    cachedToken = { token: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    return cachedToken.token;
  } catch {
    return null;
  }
}

/**
 * Does `title` actually name this person? Substring matching is too loose — e.g.
 * an aircraft titled "G-ARON Piper Colt" contains "aron piper". We require the
 * full name bounded by start/whitespace on the left (so "G-ARON" can't match) and
 * whitespace/punctuation/end on the right. Cuts the common false positives; can't
 * catch a genuinely mislabeled photo, so this source stays a best-effort fallback.
 */
function titleNamesPerson(title: string, name: string): boolean {
  const esc = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|\\s)${esc}(\\s|[.,;:!?'"\\)\\]]|$)`, 'i').test(title);
}

/** Human license label, e.g. "by-sa"/"2.0" → "CC BY-SA 2.0"; "cc0" → "CC0". */
function licenseLabel(code: string, version: string): string {
  const c = (code || '').toLowerCase();
  if (c === 'cc0') return 'CC0 1.0';
  if (c === 'pdm') return 'Public Domain Mark';
  return `CC ${c.toUpperCase()}${version ? ` ${version}` : ''}`;
}

export async function pickOpenverseCC(name: string): Promise<Cover | null> {
  const clean = (name || '').trim();
  if (!clean) return null;
  try {
    const token = await getToken();
    const params = new URLSearchParams({
      q: clean,
      license_type: 'commercial,modification', // commercial-OK AND derivative-OK (no NC, no ND)
      page_size: '20',
      mature: 'false',
    });
    const res = await fetch(`${API}/images/?${params}`, {
      headers: { 'User-Agent': UA, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null; // includes 429 rate-limit → silent miss, Pexels covers it
    const data: any = await res.json();
    const results: any[] = data?.results || [];

    // Guard against the wrong subject: require the title to actually name the person.
    const r = results.find((x) => x.url && titleNamesPerson(String(x.title || ''), clean));
    if (!r) return null;

    return {
      url: String(r.url),
      credit: String(r.creator || 'Unknown'),
      // Prefer the work's landing page for the credit link (CC attribution norm).
      creditUrl: String(r.foreign_landing_url || r.creator_url || r.url),
      alt: String(r.title || clean),
      source: 'openverse',
      licenseName: licenseLabel(String(r.license || ''), String(r.license_version || '')),
      licenseUrl: String(r.license_url || '') || undefined,
    };
  } catch {
    return null;
  }
}
