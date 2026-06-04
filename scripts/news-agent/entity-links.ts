/**
 * Contextual entity links for news bodies — the kind a professional outlet adds:
 * the first mention of a notable book, TV show, film, place, organization, or
 * public figure becomes a link to the most authoritative site for that entity.
 *
 * TRUST MODEL (mirrors commons.ts portraits): the drafting model NEVER gives us a
 * URL — only the exact anchor phrase as it wrote it, a lookup term, and a kind. We
 * resolve everything ourselves from structured data so a hallucinated or broken
 * link can't slip in:
 *   1. Find the entity's Wikipedia article (existence + disambiguation check) and
 *      its Wikidata QID.
 *   2. Read that entity's external-ID properties from Wikidata and pick the best
 *      target for its kind:
 *        film / tv    → IMDb (P345) → Rotten Tomatoes (P1258) → Wikipedia
 *        person       → IMDb name page (P345 nm…) → Wikipedia
 *        organization → official website (P856) → Wikipedia
 *        place        → official website (P856) → Wikipedia
 *        everything else (book, law, event, …) → Wikipedia
 * An entity that doesn't resolve to a real article isn't linked at all.
 *
 * Injection is deterministic and conservative: each entity is linked at most once
 * (first occurrence), only inside body text (never inside an existing <a> or an
 * <h2> heading), and the original anchor text is preserved verbatim.
 *
 * No API key required; we send the same descriptive User-Agent Wikimedia asks for.
 */
const WP_API = 'https://en.wikipedia.org/w/api.php';
const WD_API = 'https://www.wikidata.org/w/api.php';
const UA = 'MaleQ-NewsAgent/1.0 (https://maleq.com; editorial entity links)';

export type EntityKind = 'film' | 'tv' | 'person' | 'organization' | 'place' | 'book' | 'other';

/** What the model proposes per entity (it provides no URL — we resolve it). */
export interface EntityLinkRequest {
  /** The anchor phrase EXACTLY as it appears in bodyHtml (verbatim substring). */
  text: string;
  /** A Wikipedia search term for the entity (title, with disambiguation if useful). */
  query: string;
  /** Entity kind — picks which authoritative site we prefer for the link. */
  kind: EntityKind;
}

interface ResolvedEntity {
  text: string;
  url: string;
  /** Which site the link points to — for logging/inspection. */
  source: 'imdb' | 'rottentomatoes' | 'official' | 'wikipedia';
}

async function api(base: string, params: Record<string, string>): Promise<any> {
  const url = `${base}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
  return res.json();
}

/** Significant (3+ char) lowercase tokens, for a loose query↔title match check. */
function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length >= 3);
}

/** Build an IMDb URL from a P345 value by its prefix (title / name / company). */
function imdbUrl(id: string | null): string | null {
  if (!id) return null;
  if (id.startsWith('tt')) return `https://www.imdb.com/title/${id}/`;
  if (id.startsWith('nm')) return `https://www.imdb.com/name/${id}/`;
  if (id.startsWith('co')) return `https://www.imdb.com/company/${id}/`;
  return null;
}

/** Pull the authoritative external IDs we care about from a Wikidata entity. */
async function wikidataIds(qid: string): Promise<{ imdb: string | null; rt: string | null; site: string | null } | null> {
  try {
    const data = await api(WD_API, { action: 'wbgetentities', ids: qid, props: 'claims' });
    const claims = data?.entities?.[qid]?.claims || {};
    const val = (p: string): string | null => {
      const v = claims[p]?.[0]?.mainsnak?.datavalue?.value;
      return typeof v === 'string' ? v : null;
    };
    return { imdb: val('P345'), rt: val('P1258'), site: val('P856') };
  } catch {
    return null;
  }
}

/** Choose the most authoritative URL for a kind, falling back to Wikipedia. */
function bestUrl(
  kind: EntityKind,
  ids: { imdb: string | null; rt: string | null; site: string | null } | null,
  wikiUrl: string,
): { url: string; source: ResolvedEntity['source'] } {
  const imdb = imdbUrl(ids?.imdb || null);
  const rt = ids?.rt ? `https://www.rottentomatoes.com/${ids.rt}` : null;
  const site = ids?.site && /^https?:\/\//i.test(ids.site) ? ids.site : null;
  switch (kind) {
    case 'film':
    case 'tv':
      if (imdb) return { url: imdb, source: 'imdb' };
      if (rt) return { url: rt, source: 'rottentomatoes' };
      break;
    case 'person':
      // Only a true IMDb name page (nm…) — don't send a person to a title page.
      if (ids?.imdb?.startsWith('nm')) return { url: imdbUrl(ids.imdb)!, source: 'imdb' };
      break;
    case 'organization':
    case 'place':
      if (site) return { url: site, source: 'official' };
      break;
    default:
      break;
  }
  return { url: wikiUrl, source: 'wikipedia' };
}

/**
 * Resolve an entity to the best authoritative URL, or null if it has no real
 * Wikipedia article (our existence + sanity gate). We require the matched article
 * title to share a significant token with the query so a search miss can't link
 * to a wildly wrong page (e.g. a band when we meant a book).
 */
export async function resolveEntity(query: string, kind: EntityKind): Promise<{ url: string; source: ResolvedEntity['source'] } | null> {
  const q = (query || '').trim();
  if (!q) return null;
  try {
    const data = await api(WP_API, {
      action: 'query',
      generator: 'search',
      gsrsearch: q,
      gsrlimit: '1',
      gsrnamespace: '0',
      prop: 'info|pageprops',
      inprop: 'url',
      ppprop: 'wikibase_item|disambiguation',
    });
    const page = data?.query?.pages?.[0];
    const title: string | undefined = page?.title;
    const wikiUrl: string | undefined = page?.fullurl;
    if (!title || !wikiUrl) return null;
    // Reject disambiguation landing pages — they're not a real target.
    if (/\(disambiguation\)/i.test(title) || page?.pageprops?.disambiguation !== undefined) return null;
    const qt = new Set(tokens(q));
    if (qt.size && !tokens(title).some((t) => qt.has(t))) return null;

    const qid: string | undefined = page?.pageprops?.wikibase_item;
    // Kinds we never upgrade (Wikipedia is the right home) — skip the extra call.
    if (!qid || kind === 'book' || kind === 'other') return { url: wikiUrl, source: 'wikipedia' };

    const ids = await wikidataIds(qid);
    return bestUrl(kind, ids, wikiUrl);
  } catch {
    return null;
  }
}

/** Escape a string for literal use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Inject resolved entity links into `html`. Walks the markup tag-by-tag and only
 * rewrites text that sits in ordinary body flow — never inside an existing <a>
 * (no nested links) or an <h2>/<h3> heading (headings stay clean). Each entity is
 * linked once, at its first eligible occurrence, on a word boundary, with the
 * original casing preserved.
 */
export function injectEntityLinks(html: string, entities: ResolvedEntity[]): string {
  if (!entities.length) return html;
  const pending = entities
    .filter((e) => e.text && e.url)
    .map((e) => ({
      url: e.url,
      // Word-boundary match that also works for multi-word names and trailing
      // punctuation: not preceded/followed by an alphanumeric.
      re: new RegExp(`(?<![A-Za-z0-9])${escapeRe(e.text)}(?![A-Za-z0-9])`),
      linked: false,
    }));
  if (!pending.length) return html;

  const tokens = html.split(/(<[^>]+>)/); // alternating text / tag chunks
  let inAnchor = 0;
  let inHeading = 0;

  return tokens
    .map((tok) => {
      if (tok.startsWith('<')) {
        if (/^<a[\s>]/i.test(tok)) inAnchor++;
        else if (/^<\/a>/i.test(tok)) inAnchor = Math.max(0, inAnchor - 1);
        else if (/^<h[1-6][\s>]/i.test(tok)) inHeading++;
        else if (/^<\/h[1-6]>/i.test(tok)) inHeading = Math.max(0, inHeading - 1);
        return tok;
      }
      if (inAnchor > 0 || inHeading > 0 || !tok) return tok;

      // Inject every still-unlinked entity that matches, left to right.
      let out = '';
      let rest = tok;
      while (rest) {
        let best: { e: (typeof pending)[number]; index: number; match: string } | null = null;
        for (const e of pending) {
          if (e.linked) continue;
          const m = e.re.exec(rest);
          if (m && (best === null || m.index < best.index)) best = { e, index: m.index, match: m[0] };
        }
        if (!best) {
          out += rest;
          break;
        }
        out += rest.slice(0, best.index);
        out += `<a href="${best.e.url.replace(/"/g, '%22')}" target="_blank" rel="nofollow noopener">${best.match}</a>`;
        best.e.linked = true;
        rest = rest.slice(best.index + best.match.length);
      }
      return out;
    })
    .join('');
}

/**
 * Resolve a model-proposed entity list to authoritative URLs and inject the
 * verified links into the body. Returns the body unchanged if nothing resolves.
 * Caps the number of links so a piece doesn't turn into a sea of blue.
 */
export async function addEntityLinks(
  html: string,
  requests: EntityLinkRequest[] | null | undefined,
  max = 6,
): Promise<{ html: string; linked: ResolvedEntity[] }> {
  if (!html || !requests?.length) return { html, linked: [] };

  // De-dupe by anchor text (keep first), drop entities whose anchor text isn't
  // actually present in the body (the model occasionally paraphrases).
  const seen = new Set<string>();
  const candidates = requests.filter((r) => {
    const t = (r?.text || '').trim();
    if (!t || seen.has(t.toLowerCase()) || !html.includes(t)) return false;
    seen.add(t.toLowerCase());
    return true;
  });

  const resolved = (
    await Promise.all(
      candidates.map(async (r) => {
        const hit = await resolveEntity(r.query || r.text, r.kind || 'other');
        return hit ? { text: r.text.trim(), url: hit.url, source: hit.source } : null;
      }),
    )
  )
    .filter((x): x is ResolvedEntity => x !== null)
    .slice(0, max);

  if (!resolved.length) return { html, linked: [] };
  return { html: injectEntityLinks(html, resolved), linked: resolved };
}
