/**
 * Bluesky adapter (AT Protocol).
 *
 * Auth: com.atproto.server.createSession with an APP PASSWORD (never the main
 * password). Post: com.atproto.repo.createRecord into app.bsky.feed.post, with
 * an external link-card embed so the URL renders as a rich preview.
 *
 * Env: BLUESKY_HANDLE, BLUESKY_APP_PASSWORD
 */
import { truncate, type ShareInput, type ShareResult, type SocialAdapter, type VerifyResult } from './types';

const SERVICE = process.env.BLUESKY_SERVICE || 'https://bsky.social';
const HANDLE = process.env.BLUESKY_HANDLE || '';
const APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD || '';
const POST_LIMIT = 300; // graphemes; we approximate with string length

async function createSession(): Promise<{ accessJwt: string; did: string; handle: string }> {
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: HANDLE, password: APP_PASSWORD }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message || `createSession HTTP ${res.status}`);
  }
  return body;
}

/**
 * Upload an image to the repo and return the blob for use as a link-card thumb.
 * Bluesky doesn't crawl the URL for an OG image (unlike Mastodon) — we must
 * supply the thumbnail ourselves. Returns undefined on any miss (no image,
 * >1MB, fetch/upload error) so the card just renders imageless.
 */
async function uploadThumb(jwt: string, imageUrl: string): Promise<unknown> {
  try {
    const img = await fetch(imageUrl);
    if (!img.ok) return undefined;
    const mime = img.headers.get('content-type') || 'image/jpeg';
    const bytes = new Uint8Array(await img.arrayBuffer());
    if (bytes.byteLength > 1_000_000) return undefined; // bsky.social blob cap
    const res = await fetch(`${SERVICE}/xrpc/com.atproto.repo.uploadBlob`, {
      method: 'POST',
      headers: { 'Content-Type': mime, Authorization: `Bearer ${jwt}` },
      body: bytes,
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) return undefined;
    return body.blob;
  } catch {
    return undefined;
  }
}

export const bluesky: SocialAdapter = {
  platform: 'bluesky',
  enabled: Boolean(HANDLE && APP_PASSWORD),

  async verify(): Promise<VerifyResult> {
    try {
      const s = await createSession();
      return { platform: 'bluesky', ok: true, account: `@${s.handle} (${s.did})` };
    } catch (e: any) {
      return { platform: 'bluesky', ok: false, error: e.message };
    }
  },

  async share(input: ShareInput): Promise<ShareResult> {
    try {
      const session = await createSession();
      const text = truncate(input.title, POST_LIMIT);

      const external: Record<string, unknown> = {
        uri: input.url,
        title: truncate(input.title, 200),
        description: truncate(input.excerpt || '', 280),
      };
      if (input.imageUrl) {
        const thumb = await uploadThumb(session.accessJwt, input.imageUrl);
        if (thumb) external.thumb = thumb;
      }

      const record: Record<string, unknown> = {
        $type: 'app.bsky.feed.post',
        text,
        createdAt: new Date().toISOString(),
        langs: ['en'],
        embed: {
          $type: 'app.bsky.embed.external',
          external,
        },
      };

      const res = await fetch(`${SERVICE}/xrpc/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessJwt}`,
        },
        body: JSON.stringify({
          repo: session.did,
          collection: 'app.bsky.feed.post',
          record,
        }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || `createRecord HTTP ${res.status}`);

      // body.uri = at://did/app.bsky.feed.post/<rkey> → build a web URL
      const rkey = String(body.uri || '').split('/').pop();
      const webUrl = rkey ? `https://bsky.app/profile/${session.handle}/post/${rkey}` : undefined;
      return { platform: 'bluesky', ok: true, url: webUrl };
    } catch (e: any) {
      return { platform: 'bluesky', ok: false, error: e.message };
    }
  },
};
