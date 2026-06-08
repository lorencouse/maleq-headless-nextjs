/**
 * Pinterest adapter (API v5).
 *
 * Pinterest is a visual SEARCH engine — pins are evergreen and a real referral
 * source — so it's a high-value reach channel for our news covers. We compose a
 * portrait PIN (1080×1350) on the fly from the post's Pexels cover with the
 * headline overlaid (reusing scripts/news-agent/images.ts), then create the pin
 * with the destination link pointing at the CLEAN editorial /guides/<slug> page.
 *
 * ⚠ POLICY / BAN RISK — read before enabling:
 *  - Pinterest restricts adult/sexual content. Pins (and the page they link to)
 *    must be clean editorial news, never adult product imagery or product links.
 *    That's why pins link only to the news article, and nothing here surfaces
 *    products. Keep it that way.
 *  - You must CLAIM maleq.com in Pinterest (Settings → Claimed accounts) for the
 *    pins to attribute and rank, and the destination must resolve publicly.
 *  - The access token needs the `pins:write` + `boards:read` scopes.
 *  - This adapter is credential-gated: with no creds it reports enabled=false and
 *    never posts. It has NOT been exercised against the live API yet — verify with
 *    `share.ts --verify --only pinterest` once you add credentials.
 *
 * Env: PINTEREST_ACCESS_TOKEN, PINTEREST_BOARD_ID  (optional PINTEREST_API_BASE)
 */
import { renderPinFromUrl } from '../images';
import { cleanHashtags, truncate, type ShareInput, type ShareResult, type SocialAdapter, type VerifyResult } from './types';

const API_BASE = (process.env.PINTEREST_API_BASE || 'https://api.pinterest.com').replace(/\/+$/, '');
const TOKEN = process.env.PINTEREST_ACCESS_TOKEN || '';
const BOARD_ID = process.env.PINTEREST_BOARD_ID || '';
const TITLE_LIMIT = 100; // Pinterest pin title cap
const DESC_LIMIT = 500; // Pinterest pin description cap
const MAX_TAGS = 6; // Pinterest descriptions tolerate a few more discovery tags

function authHeaders() {
  return { Authorization: `Bearer ${TOKEN}` };
}

/** Pin description = hook + hashtags. Pinterest indexes this text, so it's worth filling. */
function buildDescription(input: ShareInput): string {
  const hook = (input.socialText || '').trim() || input.excerpt || input.title;
  const tags = cleanHashtags(input.hashtags, MAX_TAGS);
  const tagLine = tags.map((t) => `#${t}`).join(' ');
  const reserve = tagLine ? tagLine.length + 2 : 0;
  const head = truncate(hook, DESC_LIMIT - reserve);
  return tagLine ? `${head}\n\n${tagLine}` : head;
}

export const pinterest: SocialAdapter = {
  platform: 'pinterest',
  enabled: Boolean(TOKEN && BOARD_ID),

  async verify(): Promise<VerifyResult> {
    try {
      const res = await fetch(`${API_BASE}/v5/user_account`, { headers: authHeaders() });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || `user_account HTTP ${res.status}`);
      return { platform: 'pinterest', ok: true, account: `@${body.username || 'pinterest'}` };
    } catch (e: any) {
      return { platform: 'pinterest', ok: false, error: e.message };
    }
  },

  async share(input: ShareInput): Promise<ShareResult> {
    try {
      // Compose the portrait pin from the cover source; fall back to the flat cover
      // URL only if we have no source to overlay (Pinterest can pull either).
      let mediaSource: Record<string, unknown> | null = null;
      if (input.coverSourceUrl) {
        const pin = await renderPinFromUrl(input.coverSourceUrl, input.coverHeadline);
        if (pin) {
          mediaSource = {
            source_type: 'image_base64',
            content_type: pin.mime,
            data: pin.data.toString('base64'),
          };
        }
      }
      if (!mediaSource && input.imageUrl) {
        mediaSource = { source_type: 'image_url', url: input.imageUrl };
      }
      if (!mediaSource) {
        return { platform: 'pinterest', ok: false, error: 'no pin image (no coverSourceUrl/imageUrl)' };
      }

      const res = await fetch(`${API_BASE}/v5/pins`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board_id: BOARD_ID,
          title: truncate(input.title, TITLE_LIMIT),
          description: buildDescription(input),
          link: input.url, // clean editorial /guides/<slug> — never a product page
          alt_text: truncate(input.title, 500),
          media_source: mediaSource,
        }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || `pins HTTP ${res.status}`);
      const id = body?.id ? String(body.id) : '';
      return { platform: 'pinterest', ok: true, url: id ? `https://www.pinterest.com/pin/${id}/` : undefined };
    } catch (e: any) {
      return { platform: 'pinterest', ok: false, error: e.message };
    }
  },
};
