/**
 * Tumblr adapter (API v2, Neue Post Format).
 *
 * Tumblr has an unusually strong LGBTQ audience and a reblog mechanic that gives
 * real organic reach in queer communities — a good fit for our news covers. We post
 * the cover image + the drafted hook + a link block back to the clean /guides/<slug>
 * article, with the hashtags as native Tumblr tags (Tumblr's tag search is a genuine
 * discovery surface).
 *
 * Auth: OAuth 1.0a (consumer key/secret + token/token-secret from the app you register
 * at https://www.tumblr.com/oauth/apps). OAuth1 tokens don't expire, so — like the
 * Bluesky/Mastodon creds — this is set-and-forget with no refresh logic. For a JSON
 * POST the request body is NOT part of the OAuth signature base string (only the
 * oauth_* params are), which keeps signing simple.
 *
 * ⚠ POLICY: Tumblr allows mature LGBTQ content but bans explicit sexual imagery. We
 * post clean editorial news linking only to /guides/ — never adult product content.
 *
 * Env: TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET, TUMBLR_TOKEN, TUMBLR_TOKEN_SECRET,
 *      TUMBLR_BLOG_IDENTIFIER (e.g. "maleq.tumblr.com")
 */
import crypto from 'node:crypto';
import { cleanHashtags, truncate, type ShareInput, type ShareResult, type SocialAdapter, type VerifyResult } from './types';

const CONSUMER_KEY = process.env.TUMBLR_CONSUMER_KEY || '';
const CONSUMER_SECRET = process.env.TUMBLR_CONSUMER_SECRET || '';
const TOKEN = process.env.TUMBLR_TOKEN || '';
const TOKEN_SECRET = process.env.TUMBLR_TOKEN_SECRET || '';
const BLOG = (process.env.TUMBLR_BLOG_IDENTIFIER || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const API = 'https://api.tumblr.com';
const MAX_TAGS = 10; // Tumblr tolerates many tags; a focused handful is best for discovery.

/** RFC-3986 percent-encoding (encodeURIComponent leaves !*'() — OAuth requires them encoded). */
function pe(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Build an OAuth 1.0a Authorization header (HMAC-SHA1). For JSON bodies the body is
 * excluded from the signature, so `extra` only carries query params (none here).
 */
function authHeader(method: string, url: string, extra: Record<string, string> = {}): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: TOKEN,
    oauth_version: '1.0',
  };
  const all = { ...oauth, ...extra };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${pe(k)}=${pe(all[k])}`)
    .join('&');
  const base = `${method.toUpperCase()}&${pe(url)}&${pe(paramString)}`;
  const key = `${pe(CONSUMER_SECRET)}&${pe(TOKEN_SECRET)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return (
    'OAuth ' +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pe(k)}="${pe(oauth[k])}"`)
      .join(', ')
  );
}

export const tumblr: SocialAdapter = {
  platform: 'tumblr',
  enabled: Boolean(CONSUMER_KEY && CONSUMER_SECRET && TOKEN && TOKEN_SECRET && BLOG),

  async verify(): Promise<VerifyResult> {
    try {
      const url = `${API}/v2/user/info`;
      const res = await fetch(url, { headers: { Authorization: authHeader('GET', url) } });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.meta?.msg || `user/info HTTP ${res.status}`);
      const name = body?.response?.user?.name || 'tumblr';
      return { platform: 'tumblr', ok: true, account: `${name} → ${BLOG}` };
    } catch (e: any) {
      return { platform: 'tumblr', ok: false, error: e.message };
    }
  },

  async share(input: ShareInput): Promise<ShareResult> {
    try {
      const hook = (input.socialText || '').trim() || input.title;
      const tags = cleanHashtags(input.hashtags, MAX_TAGS);

      // Neue Post Format: cover image + hook text + a link block back to the article.
      const content: Record<string, unknown>[] = [];
      if (input.imageUrl) {
        content.push({ type: 'image', media: [{ url: input.imageUrl }], alt_text: truncate(input.title, 500) });
      }
      content.push({ type: 'text', text: hook });
      content.push({
        type: 'link',
        url: input.url, // clean editorial /guides/<slug> — never a product page
        title: truncate(input.title, 200),
        description: truncate(input.excerpt || '', 200),
      });

      const url = `${API}/v2/blog/${BLOG}/posts`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: authHeader('POST', url), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, tags: tags.join(','), state: 'published' }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (res.status >= 300) throw new Error(body?.meta?.msg || body?.errors?.[0]?.detail || `posts HTTP ${res.status}`);
      const id = body?.response?.id_string || body?.response?.id;
      return { platform: 'tumblr', ok: true, url: id ? `https://${BLOG}/post/${id}` : undefined };
    } catch (e: any) {
      return { platform: 'tumblr', ok: false, error: e.message };
    }
  },
};
