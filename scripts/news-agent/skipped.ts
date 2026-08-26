/**
 * Reject memory: remember stories the drafting model turned down as "not a news
 * event" so a later run doesn't pick the same item again.
 *
 * Why this exists: the editorial scope filter in editorial-filter.ts screens
 * HEADLINES, but draft.ts re-checks against the full article and rejects a good
 * fraction of what survives. With --limit 1 that rejection used to cost the whole
 * run (see the top-up loop in run.ts) — and because ranking is deterministic, the
 * same rejected item sat at the top of the list for every run until it aged out of
 * the feed. "WATCH: Here The Whole Time" burned two consecutive runs that way.
 *
 * Stored as a plain JSON file rather than postmeta: a rejected story has no post
 * to hang meta off, and the state is disposable — losing it costs one wasted draft.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Entries older than this are pruned — the feed item is long gone by then. */
const SKIP_TTL_DAYS = 14;

const STATE_DIR = process.env.NEWS_AGENT_STATE_DIR || join(__dirname, '.state');
const STATE_FILE = join(STATE_DIR, 'skipped-stories.json');

type SkipEntry = { at: string; title: string; reason: string };
type SkipFile = Record<string, SkipEntry>;

export type SkipMemory = {
  /** True if this URL was rejected by a previous run and hasn't aged out. */
  has(url: string): boolean;
  /** Record a rejection for every source URL in the cluster. */
  record(urls: string[], title: string, reason: string): void;
  /** Persist to disk. Best-effort — a write failure must never fail a run. */
  save(): void;
  /** How many live entries were loaded (for logging). */
  size: number;
};

export function loadSkipped(): SkipMemory {
  let data: SkipFile = {};
  try {
    if (existsSync(STATE_FILE)) data = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as SkipFile;
  } catch {
    data = {};   // malformed state is not worth failing a run over
  }

  const cutoff = Date.now() - SKIP_TTL_DAYS * 24 * 60 * 60 * 1000;
  for (const [url, entry] of Object.entries(data)) {
    if (!entry?.at || Date.parse(entry.at) < cutoff) delete data[url];
  }

  let dirty = false;
  return {
    size: Object.keys(data).length,
    has: (url) => Object.prototype.hasOwnProperty.call(data, url),
    record(urls, title, reason) {
      const at = new Date().toISOString();
      for (const url of urls) {
        if (!url) continue;
        data[url] = { at, title: title.slice(0, 160), reason: reason.slice(0, 200) };
        dirty = true;
      }
    },
    save() {
      if (!dirty) return;
      try {
        mkdirSync(dirname(STATE_FILE), { recursive: true });
        writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
      } catch (e: any) {
        console.log(`   ⚠ could not save reject memory (${e.message}) — a later run may re-pick these.`);
      }
    },
  };
}
