/**
 * Reddit adapter.
 *
 * Auth: a "script"-type app (https://www.reddit.com/prefs/apps → create app →
 * "script") gives a client id + secret. We use the OAuth *password* grant with
 * the bot account's own username/password — tokens are short-lived (~1h), so we
 * mint a fresh one per run rather than storing/refreshing anything.
 *
 * Post: a LINK submission (kind=link) to a single configured subreddit. Reddit
 * has no link-card/hashtag concept, so we just submit headline + URL. Per our
 * research, auto-posting is only safe to a subreddit YOU control — set
 * REDDIT_SUBREDDIT to your own (e.g. mqnews), NOT broad communities, or you'll
 * get filtered/shadowbanned and stray into the "commercial use" ToS gray zone.
 *
 * Reddit REQUIRES a unique, descriptive User-Agent or it returns 429s.
 *
 * Env: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD,
 *      REDDIT_SUBREDDIT (no "r/" prefix), [REDDIT_NSFW=1], [REDDIT_FLAIR_ID]
 */
import { truncate, type ShareInput, type ShareResult, type SocialAdapter, type VerifyResult } from './types';

const CLIENT_ID = process.env.REDDIT_CLIENT_ID || '';
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || '';
const USERNAME = process.env.REDDIT_USERNAME || '';
const PASSWORD = process.env.REDDIT_PASSWORD || '';
// Subreddit to post into, sans "r/". A subreddit you control (see header note).
const SUBREDDIT = (process.env.REDDIT_SUBREDDIT || 'mqnews').replace(/^\/?r\//i, '').trim();
const NSFW = process.env.REDDIT_NSFW === '1';
const FLAIR_ID = process.env.REDDIT_FLAIR_ID || '';

const TITLE_LIMIT = 300; // Reddit hard limit on submission titles.
// Reddit's API rules: send a unique UA in "platform:appid:version (by /u/name)" form.
const USER_AGENT = process.env.REDDIT_USER_AGENT || `web:maleq-news-agent:1.0 (by /u/${USERNAME || 'maleq'})`;

/** Mint a short-lived OAuth token via the script-app password grant. */
async function getToken(): Promise<string> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const form = new URLSearchParams({ grant_type: 'password', username: USERNAME, password: PASSWORD });
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: form,
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(body?.error || body?.message || `access_token HTTP ${res.status}`);
  }
  return body.access_token as string;
}

export const reddit: SocialAdapter = {
  platform: 'reddit',
  enabled: Boolean(CLIENT_ID && CLIENT_SECRET && USERNAME && PASSWORD && SUBREDDIT),

  async verify(): Promise<VerifyResult> {
    try {
      const token = await getToken();
      const res = await fetch('https://oauth.reddit.com/api/v1/me', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || `me HTTP ${res.status}`);
      return { platform: 'reddit', ok: true, account: `u/${body.name} → r/${SUBREDDIT}` };
    } catch (e: any) {
      return { platform: 'reddit', ok: false, error: e.message };
    }
  },

  async share(input: ShareInput): Promise<ShareResult> {
    try {
      const token = await getToken();

      // Link submission: headline as title, our post URL as the link. Reddit has
      // no card/dek/hashtag fields, so socialText/hashtags are intentionally unused.
      const form = new URLSearchParams();
      form.set('sr', SUBREDDIT);
      form.set('kind', 'link');
      form.set('title', truncate(input.title, TITLE_LIMIT));
      form.set('url', input.url);
      form.set('resubmit', 'true'); // allow if the same URL was posted before
      form.set('sendreplies', 'false');
      form.set('nsfw', NSFW ? 'true' : 'false');
      form.set('api_type', 'json');
      if (FLAIR_ID) form.set('flair_id', FLAIR_ID);

      const res = await fetch('https://oauth.reddit.com/api/submit', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: form,
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`submit HTTP ${res.status}`);

      // api_type=json returns { json: { errors: [[code, msg, field], ...], data: {...} } }.
      const errors: any[] = body?.json?.errors || [];
      if (errors.length) {
        const [code, msg] = errors[0];
        throw new Error(`${code}: ${msg}`); // e.g. RATELIMIT, SUBREDDIT_NOEXIST, NO_TEXT
      }
      const url: string | undefined = body?.json?.data?.url;
      return { platform: 'reddit', ok: true, url };
    } catch (e: any) {
      return { platform: 'reddit', ok: false, error: e.message };
    }
  },
};
