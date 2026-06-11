/**
 * Nostr adapter (NIP-01 kind-1 text note).
 *
 * Nostr is a decentralized, censorship-resistant protocol — the same fediverse-style
 * bet as Bluesky/Mastodon: no central moderator to disable the account, no algorithmic
 * link suppression, and a sizable LGBTQ + tech-forward audience. Posting is just
 * signing an event (schnorr over secp256k1) and broadcasting it to a handful of relays.
 *
 * Identity is a single keypair, set once. We sign with the channel's secret key (nsec
 * or 64-char hex) and publish to NOSTR_RELAYS. Hashtags become both inline #tags (which
 * Nostr clients render as tappable) and `t` tags (NIP-12 topic tags) for discovery, and
 * the trailing URL is auto-linked + preview-carded by clients from the page's og: tags.
 *
 * Generate a key (if you don't have one) with any Nostr client, or:
 *   bun -e "import('nostr-tools').then(t=>{const sk=t.generateSecretKey();console.log('nsec',t.nip19.nsecEncode(sk));console.log('npub',t.nip19.npubEncode(t.getPublicKey(sk)))})"
 *
 * Env: NOSTR_NSEC (nsec1… or 64-hex secret key),
 *      NOSTR_RELAYS (comma-separated wss:// URLs; sensible defaults below)
 */
import { cleanHashtags, truncate, type ShareInput, type ShareResult, type SocialAdapter, type VerifyResult } from './types';

const NSEC = (process.env.NOSTR_NSEC || '').trim();
const RELAYS = (process.env.NOSTR_RELAYS ||
  'wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band,wss://relay.primal.net')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);

const MAX_TAGS = 5;
const CONTENT_LIMIT = 2000; // soft cap; notes can be longer but keep it tidy

/** Decode NOSTR_NSEC (nsec1… bech32 or 64-char hex) to a 32-byte secret key. */
async function secretKey(): Promise<Uint8Array> {
  const { nip19 } = await import('nostr-tools');
  if (NSEC.startsWith('nsec')) {
    const { type, data } = nip19.decode(NSEC);
    if (type !== 'nsec') throw new Error('NOSTR_NSEC is not an nsec key');
    return data as Uint8Array;
  }
  if (/^[0-9a-fA-F]{64}$/.test(NSEC)) {
    return Uint8Array.from(NSEC.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  }
  throw new Error('NOSTR_NSEC must be an nsec1… key or 64-char hex');
}

export const nostr: SocialAdapter = {
  platform: 'nostr',
  enabled: Boolean(NSEC && RELAYS.length),

  async verify(): Promise<VerifyResult> {
    try {
      const { getPublicKey, nip19 } = await import('nostr-tools');
      const sk = await secretKey();
      const npub = nip19.npubEncode(getPublicKey(sk));
      return { platform: 'nostr', ok: true, account: `${npub} → ${RELAYS.length} relay(s)` };
    } catch (e: any) {
      return { platform: 'nostr', ok: false, error: e.message };
    }
  },

  async share(input: ShareInput): Promise<ShareResult> {
    const { finalizeEvent, nip19, SimplePool } = await import('nostr-tools');
    const pool = new SimplePool();
    try {
      const sk = await secretKey();

      // Hook (NOT the headline — clients card the URL) + inline #tags + the URL.
      const hookTags = cleanHashtags(input.hashtags, MAX_TAGS);
      const tagLine = hookTags.map((t) => `#${t}`).join(' ');
      const reserve = input.url.length + 2 + (tagLine ? tagLine.length + 2 : 0);
      const hook = (input.socialText || '').trim() || input.title;
      const head = truncate(hook, CONTENT_LIMIT - reserve);
      const content = [head, tagLine || null, input.url].filter(Boolean).join('\n\n');

      // `r` tag = referenced URL; `t` tags = topic tags (lowercased) for discovery.
      const tags: string[][] = [['r', input.url], ...hookTags.map((t) => ['t', t.toLowerCase()])];

      const signed = finalizeEvent(
        { kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content },
        sk,
      );

      // Publish to every relay; succeed if at least one accepts the event.
      const results = await Promise.allSettled(pool.publish(RELAYS, signed));
      const accepted = results.filter((r) => r.status === 'fulfilled').length;
      if (accepted === 0) {
        const why = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
        throw new Error(`no relay accepted the event${why ? `: ${why.reason}` : ''}`);
      }
      return { platform: 'nostr', ok: true, url: `https://njump.me/${nip19.neventEncode({ id: signed.id, relays: RELAYS.slice(0, 3) })}` };
    } catch (e: any) {
      return { platform: 'nostr', ok: false, error: e.message };
    } finally {
      try { pool.close(RELAYS); } catch { /* ignore */ }
    }
  },
};
