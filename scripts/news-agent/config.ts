/**
 * Configuration for the LGBTQ news agent (Phase 1: discover → draft → publish-as-draft).
 *
 * Tune sources, cadence and limits here. Feed URLs are best-effort defaults —
 * verify them with `bun run scripts/news-agent/run.ts --check-feeds --local`
 * and swap any that 404 / block scrapers.
 */

export interface NewsSource {
  /** Display name used for attribution ("Source: PinkNews"). */
  name: string;
  /** RSS / Atom feed URL. */
  feed: string;
  /** Optional homepage (for reference / future use). */
  site?: string;
}

/** Trusted LGBTQ outlets. Edit freely — order is the discovery priority. */
export const SOURCES: NewsSource[] = [
  { name: 'PinkNews',         feed: 'https://www.thepinknews.com/feed/',              site: 'https://www.thepinknews.com' },
  { name: 'The Advocate',     feed: 'https://www.advocate.com/customfeeds/js/feed/rss', site: 'https://www.advocate.com' },
  { name: 'them.',            feed: 'https://www.them.us/feed/rss',                   site: 'https://www.them.us' },
  { name: 'GLAAD',            feed: 'https://glaad.org/feed/',                        site: 'https://glaad.org' },
  { name: 'Washington Blade', feed: 'https://www.washingtonblade.com/feed/',          site: 'https://www.washingtonblade.com' },
  { name: 'Out',              feed: 'https://www.out.com/customfeeds/js/feed/rss',    site: 'https://www.out.com' },
  { name: 'LGBTQ Nation',     feed: 'https://www.lgbtqnation.com/feed/',              site: 'https://www.lgbtqnation.com' },
  { name: 'Erin in the Morning', feed: 'https://www.erininthemorning.com/feed',       site: 'https://www.erininthemorning.com' },
  { name: 'Queerty',          feed: 'https://www.queerty.com/feed',                   site: 'https://www.queerty.com' },
  { name: 'Metro Weekly',     feed: 'https://www.metroweekly.com/feed/',              site: 'https://www.metroweekly.com' },
  { name: 'Autostraddle',     feed: 'https://www.autostraddle.com/feed/',             site: 'https://www.autostraddle.com' },
  { name: 'Gay Times',        feed: 'https://www.gaytimes.com/feed/',                 site: 'https://www.gaytimes.com' },
  { name: 'Pride',            feed: 'https://www.pride.com/rss.xml',                  site: 'https://www.pride.com' },
  // NOTE: Los Angeles Blade is intentionally NOT here — its WAF 403s the Hetzner VPS
  // datacenter IP where the cron discovers feeds (works from a home IP). Same reason it
  // was dropped before. Don't re-add without confirming `curl` 200 from `ssh hetzner`.
  // Mainstream outlets — topical LGBTQ sections only (the pipeline trusts each feed to be on-topic).
  { name: 'The Guardian',     feed: 'https://www.theguardian.com/world/lgbt-rights/rss', site: 'https://www.theguardian.com/world/lgbt-rights' },
  // NOTE: HuffPost Queer Voices REMOVED 2026-08-18 — its feed 301s to
  // chaski.huffpost.com and returns a valid but EMPTY channel (0 items), so it
  // contributed nothing while reporting healthy. Re-add only if it starts
  // carrying items again.
  //
  // Supplemental sources added 2026-08-18. Chosen to fill gaps rather than add
  // volume: at 1 drafted story/day the pipeline is already ~15× oversupplied, so
  // extra feeds earn their place by corroborating national stories (multi-source
  // clusters rank first) and covering angles the US gay-male press misses.
  // All verified reachable FROM THE HETZNER VPS, not just a home IP.
  { name: 'Assigned Media',   feed: 'https://www.assignedmedia.org/feed',                site: 'https://www.assignedmedia.org' },
  { name: 'Xtra',             feed: 'https://xtramagazine.com/feed',                     site: 'https://xtramagazine.com' },
  { name: 'GCN',              feed: 'https://gcn.ie/feed/',                              site: 'https://gcn.ie' },
  { name: 'DIVA',             feed: 'https://divamag.co.uk/feed/',                       site: 'https://divamag.co.uk' },
  { name: 'Attitude',         feed: 'https://www.attitude.co.uk/feed/',                  site: 'https://www.attitude.co.uk' },
  { name: 'Mamba Online',     feed: 'https://www.mambaonline.com/feed/',                 site: 'https://www.mambaonline.com' },
  // Verified working from a home IP but 403 FROM THE VPS (same WAF problem as the
  // Los Angeles Blade above) — do NOT add without re-confirming `curl` 200 from
  // `ssh hetzner`: The 19th (19thnews.org/feed), Star Observer AU
  // (starobserver.com.au/feed), Bay Area Reporter (ebar.com/rss/news).
  // Dead/404 as of 2026-08-18: Georgia Voice, South Florida Gay News, Edge Media,
  // HRC, Lambda Legal, QNews AU (403), Trans Writes (503), NBC Out (last item 12
  // days old — effectively abandoned).
  // Working but deliberately skipped: Instinct Magazine (~4.3/day but celebrity
  // clickbait — Queerty and Pride already cover that register), Philadelphia Gay
  // News / Gay City News / Windy City Times / Dallas Voice (solid papers, but
  // hyper-local stories stay single-source and so rank last anyway).
];

/** WordPress category the drafts are filed under (slug must already exist; created if missing). */
export const NEWS_CATEGORY = {
  slug: 'news',
  name: 'LGBTQ+ News',
};

/** wp_postmeta keys written on each generated post. */
export const META = {
  /** Canonical source URL (primary outlet) — the main dedupe key. */
  sourceUrl: '_maleq_news_source_url',
  /** JSON array of ALL cited source URLs (multi-source posts). Also deduped against. */
  sourceUrls: '_maleq_news_source_urls',
  /** Source outlet name (primary). */
  sourceName: '_maleq_news_source_name',
  /** Original headline (before our rewrite), for traceability. */
  sourceTitle: '_maleq_news_source_title',
  /** Lead image URL pulled from the feed (attachment import is Phase 2). */
  imageUrl: '_maleq_news_image_url',
  /** ISO timestamp this draft was generated. */
  generatedAt: '_maleq_news_generated_at',
  /** Set once cover-image selection has been attempted (success or miss) — idempotency. */
  coverDone: '_maleq_news_cover_done',
  /** Chosen cover image URL and credit, for reference (Pexels stock or a CC portrait). */
  coverUrl: '_maleq_news_cover_url',
  coverCredit: '_maleq_news_cover_credit',
  /** Concrete image-search phrase produced by the drafter (drives cover relevance). */
  coverQuery: '_maleq_news_cover_query',
  /** Full name of the public figure the story centrally concerns — drives a real
   * licensed portrait (Wikimedia Commons / Openverse CC) instead of generic stock.
   * Empty when the story isn't about one named person. */
  coverPerson: '_maleq_news_cover_person',
  /** Title of the single film/TV show the story centrally concerns — drives an
   * official poster cover (TMDB) when no coverPerson is set. Empty otherwise. */
  coverWork: '_maleq_news_cover_work',
  /** 'film' or 'tv' for coverWork (picks the TMDB media type). */
  coverWorkKind: '_maleq_news_cover_work_kind',
  /** Short punchy social hook the drafter writes — overlaid on the cover image. */
  coverHeadline: '_maleq_news_cover_headline',
  /** Conversational social-post hook (post body). Consumed by the autoshare plugin + TS adapters. */
  socialText: '_maleq_news_social_text',
  /** JSON array of discovery hashtags (no #). Consumed by the autoshare plugin + TS adapters. */
  hashtags: '_maleq_news_hashtags',
  /** Marks the post as machine-drafted and awaiting human approval. */
  pending: '_maleq_news_pending_review',
  /** Rank Math SEO description (matches existing posts). */
  seoDescription: 'rank_math_description',
  /** Set once contextual entity links (IMDb/Goodreads/Wikipedia/…) have been added
   * to the body — idempotency for the one-off backfill of pre-existing posts. */
  linksDone: '_maleq_news_links_done',
  /** ISO timestamp the post was shared to social (absence = not yet shared). */
  sharedAt: '_maleq_news_shared_at',
  /** JSON map of platform → posted-URL, for per-platform idempotency. */
  shareUrls: '_maleq_news_share_urls',
};

/** Default author (WP user ID) for generated drafts. 6 = "Mr. Q" (login maleqorg). */
export const DEFAULT_AUTHOR_ID = 6;

/** Claude model for DRAFTING. Haiku 4.5 (2026-06-13 cost move) → Sonnet 5
 * (2026-08-05 quality decision): drafts now go through the Batches API at 50%
 * off, so Sonnet 5 prose costs ~1.5× what Haiku cost direct (~$0.06/article vs
 * ~$0.04) while being markedly better written. Drop back to 'claude-haiku-4-5'
 * if cost ever matters more than prose again. */
export const DRAFT_MODEL = 'claude-sonnet-5';

/** Claude model for the web-RESEARCH pass. Haiku 4.5 — research is fact/context
 * gathering, not prose, so it doesn't need a bigger model. NOTE: Haiku only
 * supports the basic `web_search_20250305` tool variant — the `_20260209`
 * dynamic-filtering variant 400s on it (this silently killed the research pass
 * for 2 months until 2026-08-05). */
export const RESEARCH_MODEL = 'claude-haiku-4-5';

/**
 * Vetting model (vet.ts) — the news-event check that runs BEFORE research and
 * drafting. Deliberately the cheap model: it reads ~4k chars and answers one
 * yes/no question, so a rejection costs ~$0.005 instead of the ~$0.11 a
 * research+draft pair used to burn before the drafter caught the same thing.
 */
export const VET_MODEL = 'claude-haiku-4-5';

/** $ per MTok (standard API list price; Sonnet 5 intro pricing through
 * 2026-08-31 is lower, so estimates here run slightly high until then). */
export const PRICES: Record<string, { in: number; out: number }> = {
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};
/** Both pipeline passes run through the Batches API at 50% of list price. */
export const BATCH_DISCOUNT = 0.5;
/** Server-side web_search tool usage fee: $10 per 1,000 searches. */
export const WEB_SEARCH_PER_SEARCH = 0.01;

/** Estimated $ for one API message given its usage block (batch pricing). */
export function estimateCost(
  model: string,
  u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null },
  searches = 0,
): number {
  const p = PRICES[model] ?? PRICES['claude-sonnet-5'];
  const tokens =
    (u.input_tokens * p.in +
      (u.cache_creation_input_tokens ?? 0) * p.in * 1.25 +
      (u.cache_read_input_tokens ?? 0) * p.in * 0.1 +
      u.output_tokens * p.out) /
    1_000_000;
  return tokens * BATCH_DISCOUNT + searches * WEB_SEARCH_PER_SEARCH;
}

/** Whether the drafter runs a web-research pass (server-side web_search) to add real
 * context/background the source coverage lacks. On by default; set NEWS_DISABLE_RESEARCH=1
 * to skip it (faster/cheaper, source-synthesis only — e.g. for local testing). */
export const ENABLE_RESEARCH = process.env.NEWS_DISABLE_RESEARCH !== '1';

/** How far back (hours) a story may be published and still be considered fresh. */
export const FRESHNESS_HOURS = 36;

/** How far back (hours) title-dedupe looks for near-duplicate coverage. Compared
 * against both our rewritten titles and the stored original headlines of every
 * news post in that window — drafts and scheduled posts included, not just live
 * ones. See title-dedupe.ts. */
export const RECENT_TITLE_HOURS = 48;

/** Window (hours) the token-rarity statistics are measured over — wider than the
 * blocking window on purpose: 48 h of posts is too little data to learn that
 * "pride" is generic and a surname is not. Only affects scoring, never which
 * posts can block a story. */
export const TITLE_STATS_HOURS = 24 * 30;

/** Rarity-weighted Dice threshold (0–1) over headline content tokens above which two
 * headlines are treated as the same story. Calibrated 2026-08-18 against 30 days
 * of real headlines: true repeats scored ≥0.43 (an exact re-post hit 1.00), while
 * genuinely separate follow-ups in an ongoing saga sat ≤0.41. Raise it if real
 * follow-ups get blocked; lower it if near-dupes slip through (`--dupe-report`
 * prints the scores to calibrate against). */
export const TITLE_DUPE_THRESHOLD = 0.42;

/** Max stories drafted per run (keeps the approval queue manageable + caps cost). */
export const MAX_PER_RUN = 6;

/** Per-feed item cap before freshness/dedupe filtering. */
export const MAX_PER_FEED = 20;

/** Frontend base URL for building preview links in the digest. */
export const FRONTEND_URL =
  process.env.MALEQ_FRONTEND_URL || 'http://maleq-local.local';

/** Public site base URL — what social posts link to. Posts render at /guides/<slug>. */
export const SITE_URL = process.env.MALEQ_SITE_URL || 'https://maleq.com';

/** Build the canonical public URL for a published post. */
export function postUrl(slug: string): string {
  return `${SITE_URL.replace(/\/+$/, '')}/guides/${slug}`;
}
