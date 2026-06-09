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
 *        film / tv    → IMDb (P345) → Rotten Tomatoes (P1258) → Metacritic (P1712) → Wikipedia
 *        person       → politician/office-holder: official site (P856) → Wikipedia;
 *                       entertainer: IMDb name page (P345 nm…) → AllMusic artist (P1728) → Wikipedia;
 *                       everyone else → Wikipedia
 *        organization → official website (P856) → Wikipedia
 *        place        → official website (P856) → Wikipedia
 *        book         → Goodreads (P2969 book → P8383 work) → Wikipedia
 *        music        → AllMusic album (P1729) → Metacritic (P1712) → Wikipedia
 *        game         → Steam (P1733) → Metacritic (P1712) → Wikipedia
 *        other (law, event, …) → Wikipedia
 * An entity that doesn't resolve to a real article isn't linked at all.
 *
 * The IMDb URL is built by ID prefix (tt/nm/co); every other site uses the exact
 * formatter URL Wikidata publishes for that property (verified against P1630), so
 * the path scheme can't drift.
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

export type EntityKind = 'film' | 'tv' | 'person' | 'organization' | 'place' | 'book' | 'music' | 'game' | 'other';

/** What the model proposes per entity (it provides no URL — we resolve it). */
export interface EntityLinkRequest {
  /** The anchor phrase EXACTLY as it appears in bodyHtml (verbatim substring). */
  text: string;
  /** A Wikipedia search term for the entity (title, with disambiguation if useful). */
  query: string;
  /** Entity kind — picks which authoritative site we prefer for the link. */
  kind: EntityKind;
}

type LinkSource = 'imdb' | 'rottentomatoes' | 'metacritic' | 'goodreads' | 'allmusic' | 'steam' | 'official' | 'wikipedia';

interface ResolvedEntity {
  text: string;
  url: string;
  /** Which site the link points to — for logging/inspection. */
  source: LinkSource;
}

async function api(base: string, params: Record<string, string>): Promise<any> {
  const url = `${base}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
  return res.json();
}

/**
 * Significant (3+ char) lowercase tokens, for a query↔title match check. Diacritics
 * are folded (é→e) so "René Lavan" and "Rene Lavan" compare equal.
 */
export function tokens(s: string): string[] {
  const folded = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return (folded.match(/[a-z0-9]+/g) || []).filter((t) => t.length >= 3);
}

/** Drop "(...)" disambiguation suffixes so they don't skew token comparison. */
function stripParens(s: string): string {
  return s.replace(/\([^)]*\)/g, ' ');
}

/**
 * Does `title` denote the same entity as `query`? Compares significant tokens
 * (ignoring any parenthetical disambiguation on either side) and accepts ONLY when
 * one token set contains the other. A single shared common word is NOT enough — so
 * "Blue Film" no longer matches "Blue Beetle" (they only share "blue"), while
 * "Heartstopper" still matches "Heartstopper (TV series)" and a query that adds a
 * descriptor ("Wicked film") still matches the article "Wicked".
 */
export function titleMatchesQuery(query: string, title: string): boolean {
  const qt = new Set(tokens(stripParens(query)));
  const tt = new Set(tokens(stripParens(title)));
  if (!qt.size || !tt.size) return false;
  const qSubsetT = [...qt].every((t) => tt.has(t));
  const tSubsetQ = [...tt].every((t) => qt.has(t));
  return qSubsetT || tSubsetQ;
}

/** Build an IMDb URL from a P345 value by its prefix (title / name / company). */
function imdbUrl(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.startsWith('tt')) return `https://www.imdb.com/title/${id}/`;
  if (id.startsWith('nm')) return `https://www.imdb.com/name/${id}/`;
  if (id.startsWith('co')) return `https://www.imdb.com/company/${id}/`;
  return null;
}

/**
 * The authoritative external IDs we route to. Every URL template below was
 * verified against the property's Wikidata formatter URL (P1630) on 2026-06-04,
 * so the path scheme matches what Wikidata itself publishes.
 */
interface ExternalIds {
  imdb: string | null;        // P345  (tt… / nm… / co…)
  rt: string | null;          // P1258 — value already includes "m/" or "tv/"
  metacritic: string | null;  // P1712 — value already includes "movie/" / "music/" / "tv/"
  site: string | null;        // P856  — a full URL
  goodreadsBook: string | null; // P2969
  goodreadsWork: string | null; // P8383
  allmusicAlbum: string | null; // P1729
  allmusicArtist: string | null;// P1728
  steam: string | null;       // P1733
  occupations: string[];      // P106  — occupation QIDs (drives person routing)
  positionsHeld: number;      // P39   — count of public offices held (politician signal)
}

const EXTERNAL_PROPS: Record<Exclude<keyof ExternalIds, 'occupations'>, string> = {
  imdb: 'P345', rt: 'P1258', metacritic: 'P1712', site: 'P856',
  goodreadsBook: 'P2969', goodreadsWork: 'P8383',
  allmusicAlbum: 'P1729', allmusicArtist: 'P1728', steam: 'P1733',
};

/**
 * Wikidata occupation QIDs (P106) that mean "entertainer" — the only people we
 * send to IMDb. Anyone else (politicians, activists, executives, athletes, …)
 * links to Wikipedia, which reads far more professionally than an IMDb page.
 */
const ENTERTAINER_OCCUPATIONS = new Set([
  'Q33999', 'Q10800557', 'Q10798782', 'Q2405480', 'Q2259451', // actor (+ film/TV/voice/stage)
  'Q2526255', 'Q3455803', 'Q28389', 'Q3282637',               // film director, director, screenwriter, film producer
  'Q177220', 'Q639669', 'Q488205', 'Q753110', 'Q855091', 'Q36834', 'Q183945', // singer, musician, singer-songwriter, songwriter, guitarist, composer, record producer
  'Q245068', 'Q947873', 'Q4610556', 'Q3357567', 'Q1141526', 'Q5716684', // comedian, TV presenter, model, drag queen (x2), dancer
]);

/**
 * Occupations that mean "public/political figure". These take PRECEDENCE over the
 * entertainer check, because many politicians also carry an entertainer occupation
 * in Wikidata (Trump → TV presenter; Reagan, Schwarzenegger, Zelensky → actor) and
 * would otherwise be sent to IMDb. A politician links to their official site, else
 * Wikipedia — never IMDb. Holding any public office (P39) is treated the same way.
 */
const POLITICIAN_OCCUPATIONS = new Set([
  'Q82955',  // politician
  'Q372436', // statesperson
  'Q193391', // diplomat
]);

/** Pull the authoritative external IDs we care about from a Wikidata entity. */
async function wikidataIds(qid: string): Promise<ExternalIds | null> {
  try {
    const data = await api(WD_API, { action: 'wbgetentities', ids: qid, props: 'claims' });
    const claims = data?.entities?.[qid]?.claims || {};
    const val = (p: string): string | null => {
      const v = claims[p]?.[0]?.mainsnak?.datavalue?.value;
      return typeof v === 'string' ? v : null;
    };
    const out = { occupations: [] as string[], positionsHeld: 0 } as ExternalIds;
    for (const [key, prop] of Object.entries(EXTERNAL_PROPS)) out[key as keyof ExternalIds] = val(prop) as any;
    out.occupations = (claims.P106 || [])
      .map((c: any) => c?.mainsnak?.datavalue?.value?.id)
      .filter((id: any): id is string => typeof id === 'string');
    out.positionsHeld = Array.isArray(claims.P39) ? claims.P39.length : 0; // P39 = position held
    return out;
  } catch {
    return null;
  }
}

/** Choose the most authoritative URL for a kind, falling back to Wikipedia. */
function bestUrl(kind: EntityKind, ids: ExternalIds | null, wikiUrl: string): { url: string; source: LinkSource } {
  const imdb = imdbUrl(ids?.imdb);
  const rt = ids?.rt ? `https://www.rottentomatoes.com/${ids.rt}` : null;
  const mc = ids?.metacritic ? `https://www.metacritic.com/${ids.metacritic}` : null;
  const site = ids?.site && /^https?:\/\//i.test(ids.site) ? ids.site : null;
  const goodreads = ids?.goodreadsBook
    ? `https://www.goodreads.com/book/show/${ids.goodreadsBook}`
    : ids?.goodreadsWork ? `https://www.goodreads.com/work/editions/${ids.goodreadsWork}` : null;
  const allmusicAlbum = ids?.allmusicAlbum ? `https://www.allmusic.com/album/${ids.allmusicAlbum}` : null;
  const allmusicArtist = ids?.allmusicArtist ? `https://www.allmusic.com/artist/${ids.allmusicArtist}` : null;
  const steam = ids?.steam ? `https://store.steampowered.com/app/${ids.steam}/` : null;

  switch (kind) {
    case 'film':
    case 'tv':
      if (imdb) return { url: imdb, source: 'imdb' };
      if (rt) return { url: rt, source: 'rottentomatoes' };
      if (mc) return { url: mc, source: 'metacritic' };
      break;
    case 'person': {
      // Politicians / public-office holders FIRST — they take precedence over the
      // entertainer check (many carry an entertainer occupation too: Trump → TV
      // presenter, Reagan/Schwarzenegger/Zelensky → actor). They link to their
      // official site if known, else Wikipedia — never IMDb.
      const politician = ids?.occupations?.some((q) => POLITICIAN_OCCUPATIONS.has(q)) || (ids?.positionsHeld ?? 0) > 0;
      if (politician) {
        if (site) return { url: site, source: 'official' };
        break; // → Wikipedia
      }
      // Otherwise only ENTERTAINERS go to IMDb/AllMusic; everyone else (activists,
      // executives, athletes, …) falls through to Wikipedia, which reads better.
      const entertainer = ids?.occupations?.some((q) => ENTERTAINER_OCCUPATIONS.has(q));
      if (entertainer && ids?.imdb?.startsWith('nm')) return { url: imdbUrl(ids.imdb)!, source: 'imdb' };
      if (entertainer && allmusicArtist) return { url: allmusicArtist, source: 'allmusic' };
      break;
    }
    case 'organization':
    case 'place':
      if (site) return { url: site, source: 'official' };
      break;
    case 'book':
      if (goodreads) return { url: goodreads, source: 'goodreads' };
      break;
    case 'music':
      if (allmusicAlbum) return { url: allmusicAlbum, source: 'allmusic' };
      if (mc) return { url: mc, source: 'metacritic' };
      break;
    case 'game':
      if (steam) return { url: steam, source: 'steam' };
      if (mc) return { url: mc, source: 'metacritic' };
      break;
    default:
      break;
  }
  return { url: wikiUrl, source: 'wikipedia' };
}

/**
 * Resolve an entity to the best authoritative URL, or null if no real Wikipedia
 * article denotes it (our existence + sanity gate). We fetch the top few search
 * hits and pick the highest-ranked one whose title actually MATCHES the query
 * (set-containment, not a single shared word) — so when the obvious search hit is
 * a more famous near-namesake ("Blue Beetle" for "Blue Film"), we skip it and use
 * the correct lower-ranked article instead of linking to the wrong page.
 */
export async function resolveEntity(query: string, kind: EntityKind): Promise<{ url: string; source: LinkSource } | null> {
  const q = (query || '').trim();
  if (!q) return null;
  try {
    const data = await api(WP_API, {
      action: 'query',
      generator: 'search',
      gsrsearch: q,
      gsrlimit: '5',
      gsrnamespace: '0',
      prop: 'info|pageprops',
      inprop: 'url',
      ppprop: 'wikibase_item|disambiguation',
    });
    const pages: any[] = (data?.query?.pages || []).slice().sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));
    // Highest-ranked search hit that is a real article AND whose title denotes our entity.
    const page = pages.find((p) => {
      const title: string | undefined = p?.title;
      if (!title || !p?.fullurl) return false;
      // Reject disambiguation landing pages — they're not a real target.
      if (/\(disambiguation\)/i.test(title) || p?.pageprops?.disambiguation !== undefined) return false;
      return titleMatchesQuery(q, title);
    });
    if (!page) return null;
    const wikiUrl: string = page.fullurl;

    const qid: string | undefined = page?.pageprops?.wikibase_item;
    // 'other' (laws, events, generic topics) always lives on Wikipedia — skip the
    // extra call. Every other kind has a more authoritative home worth checking.
    if (!qid || kind === 'other') return { url: wikiUrl, source: 'wikipedia' };

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

  // Clean the anchor: drop a trailing possessive ("Tom Holland's" → "Tom Holland")
  // and any leading/trailing punctuation, so we link the name, not the apostrophe-s.
  const clean = (t: string) =>
    (t || '')
      .trim()
      .replace(/[’']s$/i, '')
      .replace(/^[^A-Za-z0-9(]+/, '')
      .replace(/[^A-Za-z0-9)]+$/, '')
      .trim();

  // De-dupe anchors, dropping entities whose anchor text isn't actually in the body
  // (the model occasionally paraphrases) and sub-phrases of an anchor we already
  // kept ("Karamo" when we have "Karamo Brown"). Longer anchors are considered
  // first so the full name wins over a bare first/last name.
  const accepted: { text: string; words: Set<string> }[] = [];
  const wordsOf = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]+/g) || []);
  const isSubsetOf = (a: Set<string>, b: Set<string>) => a.size > 0 && [...a].every((w) => b.has(w));
  const candidates = requests
    .map((r) => ({ ...r, text: clean(r?.text || '') }))
    .filter((r) => r.text && html.includes(r.text))
    .sort((a, b) => b.text.length - a.text.length)
    .filter((r) => {
      const w = wordsOf(r.text);
      // Skip exact repeats and any anchor whose words are wholly contained in an
      // already-kept anchor (same entity referred to more briefly).
      if (accepted.some((a) => a.text.toLowerCase() === r.text.toLowerCase() || isSubsetOf(w, a.words))) return false;
      accepted.push({ text: r.text, words: w });
      return true;
    });

  // Resolve in parallel, then de-dupe by destination URL so the same entity
  // referred to two ways ("Karamo Brown" + "Karamo") isn't linked twice.
  const seenUrl = new Set<string>();
  const resolved = (
    await Promise.all(
      candidates.map(async (r) => {
        const hit = await resolveEntity(r.query || r.text, r.kind || 'other');
        return hit ? { text: r.text, url: hit.url, source: hit.source } : null;
      }),
    )
  )
    .filter((x): x is ResolvedEntity => x !== null)
    .filter((x) => (seenUrl.has(x.url) ? false : (seenUrl.add(x.url), true)))
    .slice(0, max);

  if (!resolved.length) return { html, linked: [] };
  return { html: injectEntityLinks(html, resolved), linked: resolved };
}
