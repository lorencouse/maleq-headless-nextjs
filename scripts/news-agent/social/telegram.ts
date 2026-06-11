/**
 * Telegram adapter (Bot API).
 *
 * Telegram is a broadcast/subscriber channel, not an algorithmic feed: every
 * follower of the channel sees every post in order, and there is NO outbound-link
 * suppression — so news links get full reach, the opposite of Threads/X/Facebook.
 * Posting is a single unauthenticated-looking HTTPS call (the bot token is the auth),
 * with no OAuth, no app review, and no refresh logic — genuinely set-and-forget.
 *
 * Setup:
 *   1. Talk to @BotFather → /newbot → get the bot token.
 *   2. Create a public channel (e.g. t.me/maleqnews) and add the bot as an admin
 *      with "Post messages" permission.
 *   3. Set TELEGRAM_CHANNEL to the channel's @username (public) or numeric -100… id.
 *
 * We post the drafted hook + hashtags + the article URL, and let Telegram build the
 * link-preview card from the page's og: tags (same approach as Mastodon). Telegram
 * renders #hashtags as tappable search links and bare URLs as links automatically,
 * so we send plain text (no parse_mode → nothing to escape).
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL
 */
import { truncate, cleanHashtags, type ShareInput, type ShareResult, type SocialAdapter, type VerifyResult } from './types';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHANNEL = (process.env.TELEGRAM_CHANNEL || '').trim();
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : '';
const TEXT_LIMIT = 4096; // Telegram sendMessage hard limit
const MAX_TAGS = 5;

/** Public-channel web URL for a posted message, when the channel is an @username. */
function messageUrl(messageId: unknown): string | undefined {
  if (!messageId) return undefined;
  if (CHANNEL.startsWith('@')) return `https://t.me/${CHANNEL.slice(1)}/${messageId}`;
  return undefined; // numeric -100… ids have no clean public web URL
}

export const telegram: SocialAdapter = {
  platform: 'telegram',
  enabled: Boolean(TOKEN && CHANNEL),

  async verify(): Promise<VerifyResult> {
    try {
      const res = await fetch(`${API}/getMe`);
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) throw new Error(body?.description || `getMe HTTP ${res.status}`);
      return { platform: 'telegram', ok: true, account: `@${body.result?.username} → ${CHANNEL}` };
    } catch (e: any) {
      return { platform: 'telegram', ok: false, error: e.message };
    }
  },

  async share(input: ShareInput): Promise<ShareResult> {
    try {
      // Conversational hook (NOT the headline — it's already in the link card) +
      // hashtags + the URL Telegram renders as a card. Mirrors the Mastodon adapter.
      const hook = (input.socialText || '').trim() || input.title;
      const tags = cleanHashtags(input.hashtags, MAX_TAGS);
      const tagLine = tags.map((t) => `#${t}`).join(' ');
      const reserve = input.url.length + 2 + (tagLine ? tagLine.length + 2 : 0);
      const head = truncate(hook, TEXT_LIMIT - reserve);
      const text = [head, tagLine || null, input.url].filter(Boolean).join('\n\n');

      const res = await fetch(`${API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHANNEL,
          text,
          // Let the trailing URL generate a preview card (pulls the article's og:image).
          link_preview_options: { is_disabled: false, url: input.url, prefer_large_media: true },
          disable_notification: false,
        }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) throw new Error(body?.description || `sendMessage HTTP ${res.status}`);
      return { platform: 'telegram', ok: true, url: messageUrl(body.result?.message_id) };
    } catch (e: any) {
      return { platform: 'telegram', ok: false, error: e.message };
    }
  },
};
