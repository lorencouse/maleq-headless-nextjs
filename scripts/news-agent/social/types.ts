/**
 * Shared types for social-share adapters. Each adapter implements SocialAdapter.
 * Adapters are self-configuring from env vars and report `enabled=false` when
 * their credentials are absent, so share.ts can fan out to whatever's configured.
 */

export interface ShareInput {
  /** Post headline. Shown in the link card; also the fallback post body when no hook. */
  title: string;
  /** Short summary / dek (optional, used where space allows — e.g. Bluesky card description). */
  excerpt?: string;
  /** Canonical URL to link to (the published post on our site, or the source). */
  url: string;
  /** Optional image URL (used by platforms that support/require it). */
  imageUrl?: string | null;
  /**
   * Conversational post-body hook (NOT the headline — that's already in the card).
   * Falls back to the title when absent. Mirrors the autoshare plugin's socialText.
   */
  socialText?: string;
  /** Discovery hashtags WITHOUT the leading # (cleaned + capped per platform at send time). */
  hashtags?: string[];
  /**
   * Source image URL (the Pexels cover) used to compose a portrait PIN for Pinterest/IG.
   * The pin is generated on the fly with the headline overlaid; absent → no pin.
   */
  coverSourceUrl?: string | null;
  /** ALL-CAPS overlay headline baked onto the pin (the drafter's coverHeadline). */
  coverHeadline?: string;
}

export interface ShareResult {
  platform: string;
  ok: boolean;
  /** URL of the created post, when the platform returns one. */
  url?: string;
  error?: string;
}

export interface VerifyResult {
  platform: string;
  ok: boolean;
  /** Human-readable account identity confirmed by the API. */
  account?: string;
  error?: string;
}

export interface SocialAdapter {
  platform: string;
  /** True only when all required credentials are present in env. */
  enabled: boolean;
  /** Read-only auth check — confirms credentials without posting anything. */
  verify(): Promise<VerifyResult>;
  /** Publish a post. Only call when enabled. */
  share(input: ShareInput): Promise<ShareResult>;
}

/** Truncate to a grapheme-ish limit, appending an ellipsis if cut. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Normalize hashtags to letters/digits only, strip a leading #, de-dupe
 * case-insensitively, and cap the count. Mirrors maleq_news_clean_hashtags() in
 * wordpress/mu-plugins/maleq-news-autoshare.php — keep the two in sync.
 */
export function cleanHashtags(tags: string[] | undefined, max = 4): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const raw of tags) {
    const t = String(raw).replace(/^#+/, '').replace(/[^A-Za-z0-9]/g, '');
    if (!t) continue;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Byte feature for a Bluesky richtext facet. */
export interface TagFacet {
  index: { byteStart: number; byteEnd: number };
  features: { $type: 'app.bsky.richtext.facet#tag'; tag: string }[];
}

/**
 * Build Bluesky #tag facets so hashtags are clickable/searchable. Bluesky indexes
 * by UTF-8 BYTE offsets, so `byteOffset` is the byte length of the text BEFORE the
 * tag line (use Buffer.byteLength). Mirrors maleq_news_tag_facets() in the plugin.
 */
export function buildTagFacets(cleanTags: string[], byteOffset: number): TagFacet[] {
  const facets: TagFacet[] = [];
  let pos = byteOffset;
  cleanTags.forEach((tag, i) => {
    if (i > 0) pos += 1; // single-space separator
    const token = `#${tag}`;
    const start = pos;
    const end = pos + Buffer.byteLength(token, 'utf8');
    facets.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag }],
    });
    pos = end;
  });
  return facets;
}
