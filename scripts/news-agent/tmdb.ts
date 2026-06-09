/**
 * Movie / TV poster covers via The Movie Database (TMDB).
 *
 * Posters are PROMOTIONAL ART — copyrighted by the studio, NOT freely licensed
 * (unlike the Wikimedia/Openverse portraits in commons.ts / openverse.ts). We use
 * one only to illustrate a post that is genuinely ABOUT that specific title, at
 * modest resolution, with a credit line — i.e. editorial fair use. Because that's
 * a risk-based posture for a commercial site, this source is OFF by default: it
 * runs only when BOTH TMDB_API_KEY is set AND NEWS_AGENT_TMDB_POSTERS=1, and the
 * news pipeline keeps its human-approval step before anything publishes.
 *
 * Attribution: TMDB's terms require crediting them; we credit "The Movie Database
 * (TMDB)" and link the title's TMDB page. The API is free (themoviedb.org → API).
 *
 * Env: TMDB_API_KEY (v3 key), NEWS_AGENT_TMDB_POSTERS=1 to enable.
 */
import type { Cover } from './images';
import { titleMatchesQuery } from './entity-links';

const KEY = process.env.TMDB_API_KEY || '';
export const tmdbEnabled = Boolean(KEY) && process.env.NEWS_AGENT_TMDB_POSTERS === '1';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w780'; // ~780×1170 poster; downscaled, never upscaled
const UA = 'MaleQ-NewsAgent/1.0 (https://maleq.com; editorial poster art)';

/**
 * Find the official poster for a film/TV title. Returns null when disabled, on a
 * miss, or when the best result's title doesn't actually match the query (so a
 * near-namesake can't sneak in — the same guard the entity-link resolver uses).
 * `kind` ('film'|'tv') only nudges ordering; we still verify the title.
 */
export async function pickTmdbPoster(title: string, kind?: 'film' | 'tv'): Promise<Cover | null> {
  const q = (title || '').trim();
  if (!tmdbEnabled || !q) return null;
  try {
    const url = `${API}/search/multi?${new URLSearchParams({ query: q, include_adult: 'false', api_key: KEY })}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const data: any = await res.json();
    const results: any[] = data?.results || [];

    // Only movie/tv results that actually have a poster.
    const candidates = results.filter((r) => (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path);
    // Prefer the kind the drafter expected, but keep TMDB's popularity order within that.
    const wantType = kind === 'tv' ? 'tv' : kind === 'film' ? 'movie' : null;
    const ordered = wantType
      ? candidates.slice().sort((a, b) => Number(b.media_type === wantType) - Number(a.media_type === wantType))
      : candidates;

    const hit = ordered.find((r) => titleMatchesQuery(q, String(r.title || r.name || '')));
    if (!hit) return null;

    const name = String(hit.title || hit.name || q);
    const year = String(hit.release_date || hit.first_air_date || '').slice(0, 4);
    return {
      url: `${IMG}${hit.poster_path}`,
      credit: 'The Movie Database (TMDB)',
      creditUrl: `https://www.themoviedb.org/${hit.media_type}/${hit.id}`,
      alt: year ? `${name} (${year}) poster` : `${name} poster`,
      source: 'tmdb',
    };
  } catch {
    return null;
  }
}
