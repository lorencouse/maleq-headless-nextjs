/**
 * Title-level duplicate guard.
 *
 * dedupe.ts already drops a feed item whose *URL* we've cited before. That misses
 * the common case at low volume: the same event re-reported a day later by another
 * outlet under a fresh URL and a slightly different headline. With only one story
 * drafted per run, publishing that twice is very visible.
 *
 * So we compare headlines against every news post from the last RECENT_TITLE_HOURS
 * (drafts included — a story sitting in the approval queue still counts), using the
 * same headline vocabulary as cluster.ts. Two headlines match when their content
 * tokens overlap heavily (Dice coefficient) and share at least one long token, which
 * biases matching toward proper nouns rather than shared topic words.
 *
 * Applied twice in run.ts: once on the source headline BEFORE drafting (saves the
 * API spend) and once on Claude's rewritten title before publishing (a rewrite can
 * collide even when the source headline didn't).
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
  META,
  NEWS_CATEGORY,
  RECENT_TITLE_HOURS,
  TITLE_STATS_HOURS,
  TITLE_DUPE_THRESHOLD,
} from './config';
import { tokens } from './cluster';

/** A headline we've already committed to, with the post it belongs to. */
export interface RecentTitle {
  postId: number;
  /** The headline text this entry matches on (our title OR the source headline). */
  title: string;
  /** Our post title, for logging (differs from `title` on source-headline entries). */
  postTitle: string;
  status: string;
  tokens: Set<string>;
  /** True if inside the blocking window; false = stats-only (older) headline. */
  inWindow: boolean;
}

/**
 * Recent headlines plus the token rarity stats derived from them. Rarity matters:
 * on real data, plain overlap flags "PHOTOS: Rehoboth Beach Pride" against
 * "PHOTOS: Front Royal Pride" (both share only `photos` + `pride`) while missing
 * genuine repeats. Weighting each token by how rare it is across the window makes
 * a shared surname worth far more than a shared "pride".
 */
export interface RecentTitleIndex {
  /** Headlines eligible to block a new story (inside RECENT_TITLE_HOURS). */
  entries: RecentTitle[];
  /** How many recent headlines contain each token. */
  df: Map<string, number>;
  /** Number of headlines indexed. */
  docs: number;
}

/** Shortest token length that counts as "distinctive" — proper nouns, not topic words. */
const MIN_LONG_SHARED = 5;
/** Need at least this many shared content tokens regardless of the weighted score. */
const MIN_SHARED = 2;

/** IDF-style weight: rare-in-the-window tokens dominate the score. A token absent
 * from the window (df 0) is treated as maximally rare — it's new information, so it
 * pushes an incoming headline AWAY from being a duplicate. */
function weightOf(idx: RecentTitleIndex, token: string): number {
  return Math.log((idx.docs + 1) / ((idx.df.get(token) ?? 0) + 0.5));
}

function sumWeights(idx: RecentTitleIndex, tk: Set<string>): number {
  let total = 0;
  for (const t of tk) total += weightOf(idx, t);
  return total;
}

/** Register one headline: every headline feeds the rarity stats, but only ones
 * inside the blocking window become candidates to match against. */
function indexTitle(idx: RecentTitleIndex, entry: RecentTitle): void {
  if (entry.inWindow) idx.entries.push(entry);
  idx.docs++;
  for (const t of entry.tokens) idx.df.set(t, (idx.df.get(t) || 0) + 1);
}

/**
 * Every headline attached to a news post from the last `hours` hours — both our
 * rewritten `post_title` and the stored original `_maleq_news_source_title`, since
 * incoming candidates are original headlines and match those more directly.
 *
 * Includes drafts/pending/future as well as published: an unapproved draft covering
 * the story is still a reason not to draft it again.
 *
 * Token rarity is measured over a WIDER window (`statsHours`) than the blocking
 * window. At 4 posts/day the 48 h window holds only ~8 headlines — far too few to
 * tell "pride" from a surname — so the weights come from ~30 days of headlines
 * while only the last `hours` can actually block a story.
 */
export async function fetchRecentTitles(
  db: Connection,
  hours = RECENT_TITLE_HOURS,
  statsHours = TITLE_STATS_HOURS,
): Promise<RecentTitleIndex> {
  const window = Math.min(hours, statsHours);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.ID, p.post_title, p.post_status, m.meta_value AS source_title,
            (p.post_modified_gmt >= (UTC_TIMESTAMP() - INTERVAL ? HOUR)) AS in_window
       FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
       JOIN wp_terms t ON t.term_id = tt.term_id
       LEFT JOIN wp_postmeta m ON m.post_id = p.ID AND m.meta_key = ?
      WHERE p.post_type = 'post'
        AND p.post_status IN ('draft','pending','publish','future')
        AND tt.taxonomy = 'category'
        AND t.slug = ?
        AND p.post_modified_gmt >= (UTC_TIMESTAMP() - INTERVAL ? HOUR)`,
    [window, META.sourceTitle, NEWS_CATEGORY.slug, Math.max(hours, statsHours)],
  );

  const idx: RecentTitleIndex = { entries: [], df: new Map(), docs: 0 };
  for (const r of rows) {
    const postId = Number(r.ID);
    const inWindow = Number(r.in_window) === 1;
    const postTitle = decodeEntities(String(r.post_title || ''));
    for (const raw of [postTitle, decodeEntities(String(r.source_title || ''))]) {
      const title = raw.trim();
      if (!title) continue;
      const tk = tokens(title);
      if (tk.size === 0) continue;
      indexTitle(idx, { postId, title, postTitle, status: String(r.post_status), tokens: tk, inWindow });
    }
  }
  return idx;
}

/** WP stores titles HTML-encoded (`&amp;`, `&#8217;`); decode so tokenizing sees words. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#0*39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&quot;|&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, '-')
    .replace(/&nbsp;/g, ' ');
}

/**
 * Rarity-weighted Dice coefficient over content tokens:
 * 2·Σw(shared) / (Σw(a) + Σw(b)). 1 = same distinctive vocabulary, 0 = nothing in
 * common. Dice (not Jaccard) so a short headline still scores against a longer one
 * covering the same event.
 */
export function titleSimilarity(
  idx: RecentTitleIndex,
  a: Set<string>,
  b: Set<string>,
): { score: number; shared: string[] } {
  if (a.size === 0 || b.size === 0) return { score: 0, shared: [] };
  const shared: string[] = [];
  let sharedW = 0;
  for (const t of a) {
    if (b.has(t)) {
      shared.push(t);
      sharedW += weightOf(idx, t);
    }
  }
  const denom = sumWeights(idx, a) + sumWeights(idx, b);
  return { score: denom > 0 ? (2 * sharedW) / denom : 0, shared };
}

export interface DuplicateMatch {
  /** The recent headline we collided with. */
  against: RecentTitle;
  score: number;
  shared: string[];
}

/**
 * The strongest recent headline this title duplicates, or null if it's new.
 * Requires MIN_SHARED shared tokens, one of them ≥ MIN_LONG_SHARED chars, and a
 * weighted score ≥ TITLE_DUPE_THRESHOLD — all three, so "another Ghana story"
 * doesn't block on the word "ghana" alone.
 */
export function findDuplicateTitle(
  title: string,
  idx: RecentTitleIndex,
  threshold = TITLE_DUPE_THRESHOLD,
): DuplicateMatch | null {
  const tk = tokens(title);
  if (tk.size === 0) return null;

  let best: DuplicateMatch | null = null;
  for (const r of idx.entries) {
    const { score, shared } = titleSimilarity(idx, tk, r.tokens);
    if (shared.length < MIN_SHARED) continue;
    if (!shared.some((t) => t.length >= MIN_LONG_SHARED)) continue;
    if (score < threshold) continue;
    if (!best || score > best.score) best = { against: r, score, shared };
  }
  return best;
}

/** Add a just-drafted title to the index so one run can't duplicate itself. */
export function rememberTitle(idx: RecentTitleIndex, postId: number, title: string): void {
  const tk = tokens(title);
  if (tk.size === 0) return;
  indexTitle(idx, { postId, title, postTitle: title, status: 'draft', tokens: tk, inWindow: true });
}
