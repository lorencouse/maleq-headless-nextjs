/**
 * Male Q's public social accounts. Rendered in the footer and emitted as
 * Organization.sameAs so the site itself backs up what we tell payment
 * processors and search engines about who we are.
 *
 * `inFooter` splits the two audiences: every profile goes into the schema
 * (identity signal for reviewers and search engines), but only accounts a
 * shopper would want to click are shown in the footer. Dormant pages stay
 * schema-only until they are posted to again.
 *
 * The news agent (scripts/news-agent/share.ts) posts to the first five; keep
 * those in sync with its server .env (BLUESKY_HANDLE, MASTODON_INSTANCE_URL,
 * TUMBLR_BLOG_IDENTIFIER, TELEGRAM_CHANNEL, NOSTR_NSEC).
 * `bun scripts/news-agent/share.ts --verify` on the server prints the live handles.
 * components/home/SocialSection.tsx renders its own styled subset of these.
 */
export interface SocialLink {
  platform: 'bluesky' | 'mastodon' | 'tumblr' | 'telegram' | 'nostr' | 'youtube' | 'facebook' | 'linkedin';
  label: string;
  handle: string;
  url: string;
  /** Show in the site footer (false = schema.org sameAs only). */
  inFooter: boolean;
}

export const SOCIAL_LINKS: readonly SocialLink[] = [
  {
    platform: 'bluesky',
    label: 'Bluesky',
    handle: '@mqnews.bsky.social',
    url: 'https://bsky.app/profile/mqnews.bsky.social',
    inFooter: true,
  },
  {
    platform: 'mastodon',
    label: 'Mastodon',
    handle: '@mqnews@mastodon.social',
    url: 'https://mastodon.social/@mqnews',
    inFooter: true,
  },
  {
    platform: 'tumblr',
    label: 'Tumblr',
    handle: 'mqnews',
    url: 'https://mqnews.tumblr.com',
    inFooter: true,
  },
  {
    platform: 'telegram',
    label: 'Telegram',
    handle: '@maleqnews',
    url: 'https://t.me/maleqnews',
    inFooter: true,
  },
  {
    platform: 'nostr',
    label: 'Nostr',
    handle: 'npub1f55gt4p…8vyaqc',
    url: 'https://njump.me/npub1f55gt4pnvmsdgdqmjsts8d8ap85nhv99vmk4qhcgdxrc4xsrjrhs8vyaqc',
    inFooter: true,
  },
  {
    platform: 'youtube',
    label: 'YouTube',
    handle: '@themaleq',
    url: 'https://www.youtube.com/@themaleq',
    inFooter: true,
  },
  {
    platform: 'facebook',
    label: 'Facebook',
    handle: 'maleqstore',
    url: 'https://www.facebook.com/maleqstore',
    inFooter: false, // page exists but has not been posted to since ~2023
  },
  {
    platform: 'linkedin',
    label: 'LinkedIn',
    handle: 'maleq',
    url: 'https://www.linkedin.com/company/maleq/',
    inFooter: false, // company page for the legal entity; no activity
  },
] as const;

/** Accounts shown in the footer. */
export const FOOTER_SOCIAL_LINKS: readonly SocialLink[] = SOCIAL_LINKS.filter((s) => s.inFooter);

/** Every profile URL, for schema.org Organization.sameAs. */
export const SOCIAL_PROFILE_URLS: string[] = SOCIAL_LINKS.map((s) => s.url);
