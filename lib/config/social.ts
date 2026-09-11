/**
 * Male Q's public social accounts — the ones the news agent
 * (scripts/news-agent/share.ts) actually posts to. Rendered in the footer and
 * emitted as Organization.sameAs so the site itself backs up what we tell
 * payment processors and search engines about who we are.
 *
 * Keep this in sync with the news-agent server .env (BLUESKY_HANDLE,
 * MASTODON_INSTANCE_URL, TUMBLR_BLOG_IDENTIFIER, TELEGRAM_CHANNEL, NOSTR_NSEC).
 * `bun scripts/news-agent/share.ts --verify` on the server prints the live handles.
 */
export interface SocialLink {
  platform: 'bluesky' | 'mastodon' | 'tumblr' | 'telegram' | 'nostr';
  label: string;
  handle: string;
  url: string;
}

export const SOCIAL_LINKS: readonly SocialLink[] = [
  {
    platform: 'bluesky',
    label: 'Bluesky',
    handle: '@mqnews.bsky.social',
    url: 'https://bsky.app/profile/mqnews.bsky.social',
  },
  {
    platform: 'mastodon',
    label: 'Mastodon',
    handle: '@mqnews@mastodon.social',
    url: 'https://mastodon.social/@mqnews',
  },
  {
    platform: 'tumblr',
    label: 'Tumblr',
    handle: 'mqnews',
    url: 'https://mqnews.tumblr.com',
  },
  {
    platform: 'telegram',
    label: 'Telegram',
    handle: '@maleqnews',
    url: 'https://t.me/maleqnews',
  },
  {
    platform: 'nostr',
    label: 'Nostr',
    handle: 'npub1f55gt4p…8vyaqc',
    url: 'https://njump.me/npub1f55gt4pnvmsdgdqmjsts8d8ap85nhv99vmk4qhcgdxrc4xsrjrhs8vyaqc',
  },
] as const;

/** Profile URLs for schema.org Organization.sameAs. */
export const SOCIAL_PROFILE_URLS: string[] = SOCIAL_LINKS.map((s) => s.url);
