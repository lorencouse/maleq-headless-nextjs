/**
 * Legally-reusable portraits of named public figures via Wikipedia / Wikimedia
 * Commons. Wikipedia disallows non-free images of living people, so a person's
 * article lead image is almost always freely licensed (Public Domain, CC0,
 * CC-BY, CC-BY-SA) — exactly what a commercial editorial blog may reuse WITH
 * attribution. We fetch the lead image, then verify its license from the file's
 * extmetadata and REJECT anything non-commercial (NC), no-derivatives (ND, since
 * we resize), or non-free/fair-use. Attribution data is returned for the credit.
 *
 * No API key required. We send a descriptive User-Agent per Wikimedia policy.
 */
import type { Cover } from './images';

const WP_API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'MaleQ-NewsAgent/1.0 (https://maleq.com; editorial cover images)';

async function api(base: string, params: Record<string, string>): Promise<any> {
  const url = `${base}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
  return res.json();
}

/** Strip HTML and collapse whitespace — Commons "Artist" is an HTML fragment. */
function plain(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Stable identity for a Commons image regardless of rendition, so the lead-portrait
 * full-res URL and a MediaSearch 1200px thumb of the SAME file dedupe/exclude as one.
 * Wikimedia URLs are:  …/commons/<a>/<ab>/<File>  (original)  and
 *                      …/commons/thumb/<a>/<ab>/<File>/<width>px-<File>  (thumb).
 * The <File> name uniquely identifies the file on Commons.
 */
export function commonsFileKey(url: string): string {
  try {
    const segs = new URL(url).pathname.split('/').filter(Boolean);
    const name = segs.includes('thumb') ? segs[segs.length - 2] : segs[segs.length - 1];
    return decodeURIComponent(name || url).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Decide if a license permits commercial reuse WITH modification (we resize/convert).
 * Accept: Public Domain, CC0, US Government work, CC-BY, CC-BY-SA.
 * Reject: anything NonCommercial (NC), NoDerivatives (ND), non-free / fair use.
 */
function licenseOk(code: string, short: string): boolean {
  const c = `${code} ${short}`.toLowerCase();
  if (!c.trim()) return false;
  if (/non-?free|fair[\s-]?use/.test(c)) return false;
  if (/\bnc\b|-nc-|-nc\b|noncommercial|non-commercial/.test(c)) return false;
  if (/\bnd\b|-nd-|-nd\b|noderiv/.test(c)) return false;
  if (/cc0|cc-zero|public[\s-]?domain|\bpd\b|cc-pd|government work/.test(c)) return true;
  if (/cc[-\s]?by/.test(c)) return true; // cc-by / cc-by-sa (NC/ND already excluded)
  return false;
}

/**
 * Full-text search of Wikimedia Commons File pages — the same results as the site's
 * Special:MediaSearch — returning MANY license-clean candidates in relevance order.
 * Each is verified with licenseOk() (commercial reuse + modification), so NC/ND/
 * non-free files are dropped. SVGs are skipped so covers stay photographic.
 *
 * pickCommonsPortrait returns only the one Wikipedia lead portrait; this is what the
 * cover-picker's "Wikimedia Commons" re-roll uses so it can cycle through real
 * search results for a keyword (e.g. a drag performer with no enwiki lead image).
 */
export async function searchCommonsImages(query: string, limit = 24): Promise<Cover[]> {
  const clean = (query || '').trim();
  if (!clean) return [];
  try {
    const data = await api(COMMONS_API, {
      action: 'query',
      generator: 'search',
      gsrsearch: clean,
      gsrnamespace: '6', // File:
      gsrlimit: String(Math.min(Math.max(limit, 1), 50)),
      prop: 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      iiurlwidth: '1200', // gives a 1200px-wide thumburl alongside the full-res url
      iiextmetadatafilter: 'LicenseShortName|License|Artist|LicenseUrl|UsageTerms|Credit',
    });
    const pages: any[] = data?.query?.pages || [];
    pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)); // preserve search relevance order
    const covers: Cover[] = [];
    for (const page of pages) {
      const ii = page?.imageinfo?.[0];
      if (!ii) continue;
      const mime = String(ii.mime || '');
      if (!mime.startsWith('image/') || mime === 'image/svg+xml') continue; // photos only
      const meta = ii.extmetadata || {};
      if (!licenseOk(String(meta.License?.value || ''), String(meta.LicenseShortName?.value || ''))) continue;
      const url = String(ii.thumburl || ii.url || ''); // 1200px thumb when available
      if (!url) continue;
      const artist = plain(String(meta.Artist?.value || meta.Credit?.value || '')) || 'Unknown author';
      covers.push({
        url,
        credit: artist,
        creditUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title || ''))}`,
        alt: clean,
        source: 'commons',
        licenseName: String(meta.LicenseShortName?.value || '') || 'see file page',
        licenseUrl: String(meta.LicenseUrl?.value || '') || undefined,
      });
    }
    return covers;
  } catch {
    return [];
  }
}

/**
 * Find a freely-licensed portrait for `name`. Returns null if the person has no
 * article, no lead image, or the image's license isn't commercially reusable.
 */
export async function pickCommonsPortrait(name: string): Promise<Cover | null> {
  const clean = (name || '').trim();
  if (!clean) return null;
  try {
    // 1) Resolve the best-matching article and its lead image filename + URL.
    const lead = await api(WP_API, {
      action: 'query',
      generator: 'search',
      gsrsearch: clean,
      gsrlimit: '1',
      gsrnamespace: '0',
      prop: 'pageimages',
      piprop: 'original|name',
      pilicense: 'any',
    });
    const page = lead?.query?.pages?.[0];
    const imgUrl: string | undefined = page?.original?.source;
    const fileName: string | undefined = page?.pageimage; // e.g. "Pedro Pascal 2019.jpg"
    if (!imgUrl || !fileName) return null;

    // 2) Pull the file's license + author from extmetadata (Commons-backed, but
    //    enwiki resolves it for us). Verify the license before using the image.
    const info = await api(WP_API, {
      action: 'query',
      titles: `File:${fileName}`,
      prop: 'imageinfo',
      iiprop: 'extmetadata',
      iiextmetadatafilter: 'LicenseShortName|License|Artist|LicenseUrl|UsageTerms|Credit',
    });
    const meta = info?.query?.pages?.[0]?.imageinfo?.[0]?.extmetadata || {};
    const licenseCode = String(meta.License?.value || '');
    const licenseShort = String(meta.LicenseShortName?.value || '');
    if (!licenseOk(licenseCode, licenseShort)) return null;

    const artist = plain(String(meta.Artist?.value || meta.Credit?.value || '')) || 'Unknown author';
    const filePage = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}`;

    return {
      url: imgUrl,
      credit: artist,
      creditUrl: filePage,
      alt: clean,
      source: 'commons',
      licenseName: licenseShort || 'see file page',
      licenseUrl: String(meta.LicenseUrl?.value || '') || undefined,
    };
  } catch {
    return null;
  }
}
