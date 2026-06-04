/**
 * Contextual entity links for news bodies — the kind a professional outlet adds:
 * the first mention of a notable book, TV show, film, place, organization, or
 * public figure becomes a link to its Wikipedia article.
 *
 * TRUST MODEL (mirrors commons.ts portraits): the drafting model NEVER gives us a
 * URL — only the exact anchor phrase as it wrote it plus a lookup term. We resolve
 * the real article URL ourselves via the Wikipedia API and verify the article
 * exists and plausibly matches, so a hallucinated or broken link can't slip in. An
 * entity that doesn't resolve simply isn't linked.
 *
 * Injection is deterministic and conservative: each entity is linked at most once
 * (first occurrence), only inside body text (never inside an existing <a> or an
 * <h2> heading), and the original anchor text is preserved verbatim.
 *
 * No API key required; we send the same descriptive User-Agent Wikimedia asks for.
 */
const WP_API = 'https://en.wikipedia.org/w/api.php';
const UA = 'MaleQ-NewsAgent/1.0 (https://maleq.com; editorial entity links)';

/** What the model proposes per entity (it provides no URL — we resolve it). */
export interface EntityLinkRequest {
  /** The anchor phrase EXACTLY as it appears in bodyHtml (verbatim substring). */
  text: string;
  /** A Wikipedia search term for the entity (title, with disambiguation if useful). */
  query: string;
}

interface ResolvedEntity {
  text: string;
  url: string;
}

async function api(params: Record<string, string>): Promise<any> {
  const url = `${WP_API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
  return res.json();
}

/** Significant (3+ char) lowercase tokens, for a loose query↔title match check. */
function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length >= 3);
}

/**
 * Resolve a Wikipedia article URL for `query`, or null if none exists / the top
 * match looks unrelated. We require the matched article title to share at least
 * one significant token with the query so a search miss can't link to a wildly
 * wrong page (e.g. a band when we meant a book).
 */
export async function resolveWikipediaUrl(query: string): Promise<string | null> {
  const q = (query || '').trim();
  if (!q) return null;
  try {
    const data = await api({
      action: 'query',
      generator: 'search',
      gsrsearch: q,
      gsrlimit: '1',
      gsrnamespace: '0',
      prop: 'info',
      inprop: 'url',
    });
    const page = data?.query?.pages?.[0];
    const title: string | undefined = page?.title;
    const fullurl: string | undefined = page?.fullurl;
    if (!title || !fullurl) return null;
    // Reject disambiguation landing pages — they're not a real target.
    if (/\(disambiguation\)/i.test(title)) return null;
    const qt = new Set(tokens(q));
    if (qt.size && !tokens(title).some((t) => qt.has(t))) return null;
    return fullurl;
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
 * Resolve a model-proposed entity list against Wikipedia and inject the verified
 * links into the body. Returns the body unchanged if nothing resolves. Caps the
 * number of links so a piece doesn't turn into a sea of blue.
 */
export async function addEntityLinks(
  html: string,
  requests: EntityLinkRequest[] | null | undefined,
  max = 6,
): Promise<{ html: string; linked: { text: string; url: string }[] }> {
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
        const url = await resolveWikipediaUrl(r.query || r.text);
        return url ? { text: r.text.trim(), url } : null;
      }),
    )
  )
    .filter((x): x is ResolvedEntity => x !== null)
    .slice(0, max);

  if (!resolved.length) return { html, linked: [] };
  return { html: injectEntityLinks(html, resolved), linked: resolved };
}
