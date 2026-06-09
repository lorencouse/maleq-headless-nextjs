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
  { name: 'HuffPost',         feed: 'https://www.huffpost.com/section/queer-voices/feed', site: 'https://www.huffpost.com/voices/queer-voices' },
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

/** Claude model for drafting. Haiku is plenty for short news rewrites and cheap. */
export const DRAFT_MODEL = 'claude-haiku-4-5-20251001';

/** How far back (hours) a story may be published and still be considered fresh. */
export const FRESHNESS_HOURS = 36;

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
