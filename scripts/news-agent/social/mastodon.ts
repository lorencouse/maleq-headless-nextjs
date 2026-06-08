/**
 * Mastodon adapter.
 *
 * Auth: a per-app access token (Preferences → Development → New application,
 * scope write:statuses). Post: POST /api/v1/statuses with a `status` string.
 * Mastodon auto-renders the trailing URL as a link card, so we inline the link.
 *
 * Env: MASTODON_INSTANCE_URL, MASTODON_ACCESS_TOKEN | MASTODON_CLIENT_ACCESS_TOKEN
 */
import { truncate, cleanHashtags, type ShareInput, type ShareResult, type SocialAdapter, type VerifyResult } from './types';

const INSTANCE = (process.env.MASTODON_INSTANCE_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.MASTODON_ACCESS_TOKEN || process.env.MASTODON_CLIENT_ACCESS_TOKEN || '';
// Default instance limit is 500 chars; leave room for the URL + spacing.
const STATUS_LIMIT = 500;
const MAX_TAGS = 4; // mirrors MALEQ_NEWS_MASTODON_MAX_TAGS in the autoshare plugin

function authHeaders() {
  return { Authorization: `Bearer ${TOKEN}` };
}

export const mastodon: SocialAdapter = {
  platform: 'mastodon',
  enabled: Boolean(INSTANCE && TOKEN),

  async verify(): Promise<VerifyResult> {
    try {
      const res = await fetch(`${INSTANCE}/api/v1/accounts/verify_credentials`, {
        headers: authHeaders(),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `verify_credentials HTTP ${res.status}`);
      return { platform: 'mastodon', ok: true, account: `@${body.username}@${INSTANCE.replace(/^https?:\/\//, '')}` };
    } catch (e: any) {
      return { platform: 'mastodon', ok: false, error: e.message };
    }
  },

  async share(input: ShareInput): Promise<ShareResult> {
    try {
      // Conversational hook (NOT the headline — it's already in the card) + auto-linked
      // hashtags + the URL Mastodon renders as a card. Mirrors maleq_news_share_mastodon().
      const hook = (input.socialText || '').trim() || input.title;
      const tags = cleanHashtags(input.hashtags, MAX_TAGS);
      const tagLine = tags.map((t) => `#${t}`).join(' ');
      const reserve = input.url.length + 2 + (tagLine ? tagLine.length + 2 : 0);
      const head = truncate(hook, STATUS_LIMIT - reserve);
      const status = [head, tagLine || null, input.url].filter(Boolean).join('\n\n');

      const form = new URLSearchParams();
      form.set('status', status);
      form.set('visibility', 'public');
      form.set('language', 'en');

      const res = await fetch(`${INSTANCE}/api/v1/statuses`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `statuses HTTP ${res.status}`);
      return { platform: 'mastodon', ok: true, url: body.url };
    } catch (e: any) {
      return { platform: 'mastodon', ok: false, error: e.message };
    }
  },
};
