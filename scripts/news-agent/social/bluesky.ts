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

      const record: Record<string, unknown> = {
        $type: 'app.bsky.feed.post',
        text,
        createdAt: new Date().toISOString(),
        langs: ['en'],
        embed: {
          $type: 'app.bsky.embed.external',
          external: {
            uri: input.url,
            title: truncate(input.title, 200),
            description: truncate(input.excerpt || '', 280),
          },
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
