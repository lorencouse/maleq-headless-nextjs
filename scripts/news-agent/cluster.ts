/**
 * Group feed items that look like the SAME story across outlets, so one post can
 * cite multiple sources. Lexical clustering is imperfect, so this only *proposes*
 * related coverage — draft.ts asks the model to confirm/ignore each source.
 *
 * Heuristic: IDF-weighted shared-token overlap of headlines. Tokens that are rare
 * across this run (proper nouns like "ghana", "kendrick") count for much more than
 * ubiquitous ones ("lgbtq", "pride"), so two outlets sharing a distinctive name
 * cluster, while two unrelated stories sharing only "trans" do not.
 */
import type { NewsItem } from './rss';

export interface StoryCluster {
  /** Richest item (most source material) — drives title/url/image. */
  primary: NewsItem;
  /** All items in the cluster (includes primary), newest-first. */
  sources: NewsItem[];
}

const STOPWORDS = new Set([
  // articles / pronouns / prepositions
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'has', 'are', 'was',
  'were', 'will', 'would', 'could', 'should', 'after', 'over', 'amid', 'into', 'their',
  'they', 'his', 'her', 'its', 'how', 'why', 'what', 'who', 'when', 'where', 'about',
  'more', 'than', 'but', 'not', 'you', 'your', 'our', 'onto', 'amid', 'ahead', 'still',
  'just', 'here', 'there', 'again', 'amid', 'while', 'them',
  // generic headline verbs/adverbs/idioms — semantically empty for matching
  'says', 'said', 'back', 'backing', 'down', 'out', 'off', 'set', 'sets', 'get', 'gets',
  'got', 'make', 'makes', 'made', 'take', 'takes', 'took', 'want', 'wants', 'call',
  'calls', 'called', 'draw', 'draws', 'face', 'faces', 'faced', 'sees', 'seen', 'push',
  'plan', 'plans', 'eyes', 'marks', 'slams', 'blasts', 'rips', 'hits', 'urges', 'vows',
  'cancel', 'cancels', 'goes', 'going', 'comes', 'coming', 'keeps', 'keep', 'help',
  // generic nouns
  'new', 'first', 'last', 'next', 'day', 'days', 'year', 'years', 'time', 'times',
  'way', 'ways', 'top', 'people', 'group', 'report', 'story',
]);

/** Significant tokens of a headline: alnum, length ≥ 4, not a stopword, not all-digits.
 * Exported for title-dedupe.ts so both same-story checks share one vocabulary. */
export function tokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const raw of title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')) {
    if (raw.length < 4) continue;
    if (STOPWORDS.has(raw)) continue;
    if (/^\d+$/.test(raw)) continue;
    out.add(raw);
  }
  return out;
}

const MERGE_THRESHOLD = 4.5; // combined IDF weight of shared tokens required to merge
const MIN_SHARED = 2;        // need at least this many shared content tokens
const MIN_LONG_SHARED = 5;   // …at least one of which is ≥ this long (biases to entities)

export function clusterByStory(items: NewsItem[]): StoryCluster[] {
  const n = items.length;
  const tokenSets = items.map((it) => tokens(it.title));

  // Document frequency across this run → IDF weight per token.
  const df = new Map<string, number>();
  for (const set of tokenSets) for (const t of set) df.set(t, (df.get(t) || 0) + 1);
  const weight = (t: string) => Math.log((n + 1) / (df.get(t) || 1));

  // Greedy grouping: place each item into the first cluster whose representative
  // it's similar enough to, else start a new cluster.
  interface Group { repTokens: Set<string>; idxs: number[]; }
  const groups: Group[] = [];

  // Process content-richest first so cluster reps carry the most material.
  const order = [...items.keys()].sort(
    (a, b) => (items[b].contentHtml.length + items[b].summary.length) -
              (items[a].contentHtml.length + items[a].summary.length),
  );

  for (const i of order) {
    let best: Group | null = null;
    let bestScore = 0;
    for (const g of groups) {
      let shared = 0;
      let score = 0;
      let hasLong = false;
      for (const t of tokenSets[i]) {
        if (g.repTokens.has(t)) {
          shared++;
          score += weight(t);
          if (t.length >= MIN_LONG_SHARED) hasLong = true;
        }
      }
      if (shared >= MIN_SHARED && hasLong && score >= MERGE_THRESHOLD && score > bestScore) {
        best = g;
        bestScore = score;
      }
    }
    if (best) best.idxs.push(i);
    else groups.push({ repTokens: tokenSets[i], idxs: [i] });
  }

  return groups.map((g) => {
    const members = g.idxs.map((i) => items[i]);
    // Dedupe by outlet — multiple items from one feed about the same story add noise.
    const byOutlet = new Map<string, NewsItem>();
    for (const m of members) if (!byOutlet.has(m.sourceName)) byOutlet.set(m.sourceName, m);
    const sources = [...byOutlet.values()].sort(
      (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
    );
    return { primary: members[0], sources };
  });
}
