#!/usr/bin/env bun
/**
 * Tiny pure helper for the WP cover-picker meta box's "re-roll" button: given a
 * post's cover keywords (passed as args by PHP — no DB here) and a list of URLs to
 * skip, return ONE fresh candidate cover as a single line of JSON on stdout:
 *   {"url":...,"credit":...,"creditUrl":...,"alt":...,"source":...}
 * or "{}" when nothing new is found. Mirrors attach-covers' selectCover priority
 * (portrait → poster → stock) but excludes anything already shown.
 *
 * Usage:
 *   bun run scripts/news-agent/pick-cover.ts --query "..." [--person "..."] \
 *     [--work "..." --work-kind film|tv] [--exclude "url1,url2"] [--source pexels|commons|openverse|tmdb]
 *
 * With --source, only that one source is queried, using --query as its search term
 * (the meta box's "choose a source + edit the keyword" re-roll). Without it, the
 * auto priority (portrait → poster → stock) is used.
 */
import { pickCoverExcluding, type Cover } from './images';
import { pickCommonsPortrait } from './commons';
import { pickOpenverseCC } from './openverse';
import { pickTmdbPoster } from './tmdb';

const argv = process.argv;
const flag = (n: string) => { const i = argv.indexOf(n); return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined; };

const query = (flag('--query') || '').trim();
const person = (flag('--person') || '').trim();
const work = (flag('--work') || '').trim();
const workKindRaw = (flag('--work-kind') || '').trim();
const workKind = workKindRaw === 'tv' ? 'tv' : workKindRaw === 'film' ? 'film' : undefined;
const source = (flag('--source') || '').trim().toLowerCase();
const exclude = new Set((flag('--exclude') || '').split(',').map((s) => s.trim()).filter(Boolean));

const fresh = (c: Cover | null): Cover | null => (c && !exclude.has(c.url) ? c : null);

/** Query a single named source with the user's keyword (the explicit-source re-roll). */
async function pickFromSource(src: string): Promise<Cover | null> {
  const term = query || person || work;
  switch (src) {
    case 'commons':   return fresh(await pickCommonsPortrait(term));
    case 'openverse': return fresh(await pickOpenverseCC(term));
    case 'tmdb':      return fresh(await pickTmdbPoster(work || query, workKind)); // self-gated; null if TMDB off
    case 'pexels':    return pickCoverExcluding(term ? [term] : [], exclude);
    default:          return null; // unknown source → no result
  }
}

async function pick(): Promise<Cover | null> {
  if (source) return pickFromSource(source);
  if (person) {
    const c = fresh(await pickCommonsPortrait(person)) || fresh(await pickOpenverseCC(person));
    if (c) return c;
  }
  if (work) {
    const c = fresh(await pickTmdbPoster(work, workKind)); // self-gated; null if TMDB off
    if (c) return c;
  }
  return pickCoverExcluding(query ? [query] : [], exclude);
}

const cover = await pick();
process.stdout.write(JSON.stringify(cover || {}));
