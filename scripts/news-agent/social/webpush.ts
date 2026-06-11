/**
 * Web Push adapter — broadcasts the article to the site's OWN push subscribers.
 *
 * Unlike the other adapters this isn't a third-party social network: it sends a
 * native push notification to people who installed the PWA / enabled notifications
 * AND explicitly opted into news (pref_news = 1). It's the highest-reliability channel
 * we have — no algorithm, no link suppression, no platform that can disable us.
 *
 * Consent: dedicated opt-in. We only send to maleq_push_subscriptions WHERE pref_news = 1.
 * The column is added by scripts/add-push-news-pref.sql (DEFAULT 0 → existing subscribers
 * stay opted out until they toggle "LGBTQ News" on the account notifications page).
 *
 * Idempotency: like every adapter, the result is recorded in _maleq_news_share_urls, so
 * sync-shares.ts only "broadcasts" each post once even though it re-scans recent posts.
 *
 * Payload mirrors lib/push/push-service.ts sendToSubscription() — the web_push:8030 +
 * notification block is the Declarative Web Push format iOS 18.4+/Safari need to render
 * natively. Keep the two in sync.
 *
 * Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (optional), plus the same DB
 *      env sync-shares.ts uses (handled by scripts/lib/db.ts getConnection()).
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getConnection } from '../../lib/db';
import { truncate, type ShareInput, type ShareResult, type SocialAdapter, type VerifyResult } from './types';

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:info@maleq.com';
const SITE_URL = (process.env.MALEQ_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com').replace(/\/+$/, '');
const BATCH_SIZE = 50;

let configured = false;
async function getWebPush() {
  const mod = await import('web-push');
  const wp = (mod as any).default ?? mod;
  if (!configured) {
    wp.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  }
  return wp;
}

interface Sub { id: number; endpoint: string; p256dh: string; auth: string; }

export const webpush: SocialAdapter = {
  platform: 'webpush',
  enabled: Boolean(PUBLIC_KEY && PRIVATE_KEY),

  async verify(): Promise<VerifyResult> {
    const db = await getConnection();
    try {
      const [rows] = await db.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM maleq_push_subscriptions WHERE pref_news = 1',
      );
      const n = Number(rows[0]?.n ?? 0);
      return { platform: 'webpush', ok: true, account: `${n} news subscriber(s)` };
    } catch (e: any) {
      // A missing pref_news column is the most likely failure — surface it clearly.
      return { platform: 'webpush', ok: false, error: e.message };
    } finally {
      await db.end();
    }
  },

  async share(input: ShareInput): Promise<ShareResult> {
    const db = await getConnection();
    try {
      const wp = await getWebPush();
      const [rows] = await db.query<RowDataPacket[]>(
        'SELECT id, endpoint, p256dh, auth FROM maleq_push_subscriptions WHERE pref_news = 1',
      );
      const subs = rows as unknown as Sub[];
      if (subs.length === 0) {
        return { platform: 'webpush', ok: true, url: 'no news subscribers' };
      }

      const navigate = input.url.startsWith('http') ? input.url : `${SITE_URL}${input.url}`;
      const title = truncate(input.title, 120);
      const body = truncate((input.excerpt || input.socialText || '').trim() || 'New story on Male Q', 200);
      const payload = JSON.stringify({
        title,
        body,
        icon: '/favicon/android/android-launchericon-192-192.png',
        badge: '/favicon/favicon-32x32.png',
        tag: 'news',
        url: navigate,
        image: input.imageUrl || undefined,
        // Declarative Web Push (iOS 18.4+ / Safari) — mirrors push-service.ts.
        web_push: 8030,
        notification: { title, body, navigate, silent: false, app_badge: '1' },
      });

      let sent = 0, expired = 0, failed = 0;
      for (let i = 0; i < subs.length; i += BATCH_SIZE) {
        const batch = subs.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(async (s) => {
          try {
            await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
            return 'ok' as const;
          } catch (err: any) {
            const code = err?.statusCode;
            if (code === 410 || code === 404) {
              // Subscription gone — clean it up, same as push-service.ts.
              await db.execute('DELETE FROM maleq_push_subscriptions WHERE endpoint = ?', [s.endpoint]).catch(() => {});
              return 'expired' as const;
            }
            return 'error' as const;
          }
        }));
        for (const r of results) r === 'ok' ? sent++ : r === 'expired' ? expired++ : failed++;
      }

      // ok as long as the broadcast ran; a non-zero `failed` doesn't warrant a retry of
      // the whole audience (that would re-notify everyone who already got it).
      return { platform: 'webpush', ok: true, url: `sent ${sent}${expired ? `, pruned ${expired}` : ''}${failed ? `, failed ${failed}` : ''}` };
    } catch (e: any) {
      return { platform: 'webpush', ok: false, error: e.message };
    } finally {
      await db.end();
    }
  },
};
