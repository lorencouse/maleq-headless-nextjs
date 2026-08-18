/**
 * Editorial scope filter: we report NEWS EVENTS, never another outlet's original
 * creative work.
 *
 * A listicle, how-to, opinion column, review, interview feature, recap or photo
 * gallery IS the publication's product — the value is in their selection, framing
 * and voice, not in an underlying event anyone can independently report. Rewriting
 * one produces a derivative of their work no matter how much we reword it, so those
 * are dropped outright. A news event (a court ruling, a law, a death, an arrest, a
 * casting announcement, an election result) is a fact in the world that any outlet
 * may report, and that is all we cover.
 *
 * Runs on the HEADLINE before drafting, so a rejected item costs no API call.
 * draft.ts enforces the same rule again on the full article text, catching pieces
 * whose headline looks newsy (see the EDITORIAL SCOPE section of its system prompt).
 */

export interface NonNewsMatch {
  /** Short category label, e.g. 'listicle' — shown in logs. */
  kind: string;
  /** The pattern text that matched, for debugging false positives. */
  matched: string;
}

/**
 * Ordered rules. Each is deliberately anchored or specific: a bare word like
 * "review" or "best" appears in plenty of real news headlines ("Supreme Court to
 * review…", "best-known for…"), so we match formats, not vocabulary.
 */
/** Nouns that make a leading count a listicle ("7 queer films you missed"). */
const LIST_NOUNS =
  'best|worst|greatest|hottest|queerest|sexiest|funniest|most|things|ways|reasons|times|moments|songs|films|movies|shows|books|albums|places|spots|looks|tips|signs|myths|facts|questions|rules|lessons|icons|memes|pics|gifts';
/** The subset strong enough to signal a listicle MID-headline. The rest are dropped
 * there because real news counts things too: "Used Flock Cameras Over 200 Times",
 * "30 celebs join campaign" are events, not listicles. */
const LIST_NOUNS_STRONG =
  'best|worst|greatest|hottest|queerest|sexiest|funniest|things|ways|reasons|myths|signs|tips';
/** Up to two modifiers may sit between the count and the noun: "6 trans films". */
const MOD = "(?:[\\w'’+-]+\\s+){0,2}";

/**
 * Ordered rules. Each is deliberately anchored or specific: a bare word like
 * "review" or "best" appears in plenty of real news headlines ("Supreme Court to
 * review…", "best-known for…"), so we match formats, not vocabulary.
 */
const RULES: { kind: string; patterns: RegExp[] }[] = [
  {
    kind: 'listicle',
    patterns: [
      new RegExp(`^\\s*(the\\s+)?\\d{1,3}\\s+${MOD}(${LIST_NOUNS})\\b`, 'i'),
      new RegExp(`\\b\\d{1,3}\\s+${MOD}(${LIST_NOUNS_STRONG})\\b`, 'i'),
      /,\s*ranked\b/i,
      /\branked\b\s*$/i,
      /^\s*(ranking|rating|counting down)\b/i,
      /^\s*top\s+\d{1,3}\b/i,
      /\bour\s+(top|favou?rite|best)\b/i,
      /\bround-?up\b/i,
    ],
  },
  {
    kind: 'how-to / service piece',
    patterns: [
      /^\s*how\s+to\b/i,
      /\ba\s+(complete\s+|beginner'?s?\s+)?guide\s+to\b/i,
      /\bguide:/i,
      /\beverything\s+you\s+need\s+to\s+know\b/i,
      /\bwhat\s+(you|to)\s+(need\s+to\s+know|watch|stream|read)\b/i,
      /\bwhere\s+to\s+(watch|stream|buy|stay)\b/i,
      /\b(dos\s+and\s+don'?ts)\b/i,
      /\bexplainer\b/i,
    ],
  },
  {
    kind: 'opinion / essay',
    patterns: [
      /^\s*(op-?ed|opinion|commentary|editorial|column|essay|perspective|viewpoint)\s*[:|-]/i,
      /^\s*letter\s+(to|from)\s+the\b/i,
      /^\s*why\s+i\b/i,
      /^\s*(i|we)\s+(am|was|have|used|spent|tried|learned|grew)\b/i,
      /\bmy\s+(story|journey|life|experience|coming\s+out)\b/i,
    ],
  },
  {
    kind: 'review',
    patterns: [
      /^\s*review\s*[:|-]/i,
      /\breview\s*:/i,                                    // "Stop! That! Train! review: …"
      /\breview\s*[:|-]\s*$/i,
      /\b(album|film|movie|book|tv|theatre|theater|restaurant)\s+review\b/i,
      /\bstar\s+review\b/i,
    ],
  },
  {
    kind: 'interview / profile',
    patterns: [
      /^\s*(interview|profile|q\s*&\s*a)\s*[:|-]/i,
      /\(\s*exclusive\s*\)/i,
      /\bin\s+conversation\s+with\b/i,
      /\bsits?\s+down\s+with\b/i,
      /\bopens?\s+up\s+about\b/i,
      /\btalks\s+(to|about|with)\b/i,
      /\bdishes\s+on\b/i,
      /\bon\s+(his|her|their)\s+\w+,\s+\w+,?\s+and\b/i,        // "X on his career, love, and …"
      /\bon\s+(working|starring|playing|making|writing|filming|touring|recording)\b/i,
      /\bon\s+[^,]{2,30},\s+[^,]{2,30},\s+(and|the)\b/i,        // "Pelosi on AIDS, trans rights, and …"
    ],
  },
  {
    kind: 'recurring column / feature',
    patterns: [
      /\b(crossword|horoscope|astrology|quiz|puzzle|playlist|podcast|newsletter)\b/i,
      /^\s*photos?\s*[:|-]/i,
      /\b(photo\s+gallery|photo\s+shoots?|in\s+pictures|slideshow)\b/i,
      /\bthis\s+week\s+in\b/i,
      /\bweek\s+in\s+(review|photos|queer)\b/i,
      /\bobsessed\s+with\s+this\s+week\b/i,
      /\brecap\b/i,
      /\bpower\s+ranking/i,
    ],
  },
  {
    kind: 'shopping / promo',
    patterns: [
      /\bgift\s+guide\b/i,
      /\b(deals?|sale|discount|coupon|promo\s+code)\s+(alert|roundup)\b/i,
      /\bbest\s+\w+\s+to\s+buy\b/i,
      /\bshop\s+(the|now)\b/i,
    ],
  },
];

/**
 * Classify a headline as another outlet's original work, or null if it reads like
 * a reportable news event.
 */
export function classifyNonNews(title: string): NonNewsMatch | null {
  const t = title.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  for (const rule of RULES) {
    for (const p of rule.patterns) {
      const m = t.match(p);
      if (m) return { kind: rule.kind, matched: m[0].trim() };
    }
  }
  return null;
}
