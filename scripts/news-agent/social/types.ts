/**
 * Shared types for social-share adapters. Each adapter implements SocialAdapter.
 * Adapters are self-configuring from env vars and report `enabled=false` when
 * their credentials are absent, so share.ts can fan out to whatever's configured.
 */

export interface ShareInput {
  /** Post headline. */
  title: string;
  /** Short summary / dek (optional, used where space allows). */
  excerpt?: string;
  /** Canonical URL to link to (the published post on our site, or the source). */
  url: string;
  /** Optional image URL (used by platforms that support/require it). */
  imageUrl?: string | null;
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
