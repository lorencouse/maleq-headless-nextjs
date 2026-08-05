#!/usr/bin/env bun
/**
 * Review-queue push notifier — tells YOUR phone when new drafts are ready.
 *
 * Runs in cron-run.sh right after attach-covers.ts (so covers exist before you look).
 * Finds pending News drafts (_maleq_news_pending_review = 1, status draft) that haven't
 * been announced yet (no _maleq_news_review_notified meta) and sends ONE digest push per
 * run to the owner devices subscribed via the /news-review page (the mu-plugin
 * maleq-news-review.php stores their PushSubscriptions as a JSON string in the
 * wp_options row `maleq_news_review_push_subs` — keep the two sides in sync).
 *
 * This is the private counterpart of social/webpush.ts (which broadcasts PUBLISHED
 * stories to site subscribers) — different audience, different VAPID keypair:
 * subscriptions here are created on wp.maleq.com by the review page itself, so only
 * someone holding the secret review URL can ever be subscribed.
 *
 * If no device is subscribed yet, drafts are left UN-marked so the first subscription
 * gets the backlog digest on the next cron tick.
 *
 * Env: NEWS_REVIEW_VAPID_PUBLIC, NEWS_REVIEW_VAPID_PRIVATE, MALEQ_NEWS_REVIEW_URL
 *      (the full keyed page URL the notification opens), optional VAPID_SUBJECT,
 *      plus the usual DB env handled by scripts/lib/db.ts.
 *
 * Usage:
 *   bun run scripts/news-agent/notify-review.ts --local              # DRY RUN
 *   bun run scripts/news-agent/notify-review.ts --local --write --yes
 *   bun run scripts/news-agent/notify-review.ts --write --yes        # PROD (cron)
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getConnection } from '../lib/db';
import { META } from './config';

const NOTIFIED_META = '_maleq_news_review_notified';
const SUBS_OPTION = 'maleq_news_review_push_subs';

const PUBLIC_KEY = process.env.NEWS_REVIEW_VAPID_PUBLIC || '';
const PRIVATE_KEY = process.env.NEWS_REVIEW_VAPID_PRIVATE || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:info@maleq.com';
const REVIEW_URL = process.env.MALEQ_NEWS_REVIEW_URL || '';

const argv = process.argv;
const has = (f: string) => argv.includes(f);
const IS_LOCAL = has('--local') || process.env.MYSQL_LOCAL === '1';
const WRITE = has('--write');
const YES = has('--yes');

interface Sub { endpoint: string; p256dh: string; auth: string; ua?: string; }
interface Draft { ID: number; post_title: string; }

/** Decode the handful of HTML entities WP stores in titles so the push reads clean. */
function decodeTitle(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, '’').replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&#8220;|&ldquo;/g, '“').replace(/&#8221;|&rdquo;/g, '”');
}

async function main() {
  if (WRITE && !YES) {
    console.error('Refusing --write without --yes.');
    process.exit(1);
  }
  if (WRITE && (!PUBLIC_KEY || !PRIVATE_KEY || !REVIEW_URL)) {
    console.error('Missing NEWS_REVIEW_VAPID_PUBLIC / NEWS_REVIEW_VAPID_PRIVATE / MALEQ_NEWS_REVIEW_URL.');
    process.exit(1);
  }
  console.log(`DB: ${IS_LOCAL ? 'local' : 'PROD'} · mode: ${WRITE ? 'WRITE' : 'dry run'}`);

  const db = await getConnection();
  try {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT p.ID, p.post_title
         FROM wp_posts p
         JOIN wp_postmeta pending
           ON pending.post_id = p.ID AND pending.meta_key = ? AND pending.meta_value = '1'
         LEFT JOIN wp_postmeta notified
           ON notified.post_id = p.ID AND notified.meta_key = ?
        WHERE p.post_type = 'post' AND p.post_status = 'draft'
          AND notified.meta_id IS NULL
        ORDER BY p.post_date DESC`,
      [META.pending, NOTIFIED_META],
    );
    const drafts = rows as unknown as Draft[];
    if (drafts.length === 0) {
      console.log('No new drafts to announce.');
      return;
    }

    const [optRows] = await db.query<RowDataPacket[]>(
      'SELECT option_value FROM wp_options WHERE option_name = ? LIMIT 1',
      [SUBS_OPTION],
    );
    let subsMap: Record<string, Sub> = {};
    try {
      subsMap = JSON.parse(String(optRows[0]?.option_value ?? '')) || {};
    } catch { /* option absent or not yet JSON — treated as no devices */ }
    const subs = Object.entries(subsMap);

    const titles = drafts.map((d) => decodeTitle(d.post_title));
    const title = `📰 ${drafts.length} new ${drafts.length === 1 ? 'story' : 'stories'} to review`;
    const body = titles.slice(0, 2).join(' · ') + (drafts.length > 2 ? ` · +${drafts.length - 2} more` : '');

    console.log(`${drafts.length} un-announced draft(s):`);
    titles.forEach((t) => console.log(`  - ${t}`));
    console.log(`${subs.length} subscribed device(s).`);

    if (subs.length === 0) {
      console.log('No devices subscribed yet — leaving drafts un-marked so the first device gets the backlog.');
      return;
    }
    if (!WRITE) {
      console.log(`DRY RUN — would push: "${title}" / "${body}"`);
      return;
    }

    const mod = await import('web-push');
    const webpush = (mod as any).default ?? mod;
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);

    const payload = JSON.stringify({
      title,
      body,
      icon: 'https://maleq.com/favicon/android/android-launchericon-192-192.png',
      badge: 'https://maleq.com/favicon/favicon-32x32.png',
      tag: 'news-review',
      url: REVIEW_URL,
      // Declarative Web Push (iOS 18.4+/Safari) — same shape as social/webpush.ts.
      web_push: 8030,
      notification: { title, body, navigate: REVIEW_URL, silent: false, app_badge: String(drafts.length) },
    });

    let sent = 0;
    const dead: string[] = [];
    for (const [hash, s] of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err: any) {
        const code = err?.statusCode;
        if (code === 410 || code === 404) {
          dead.push(hash);
          console.log(`  pruning expired device (${s.ua || s.endpoint.slice(0, 60)})`);
        } else {
          console.error(`  push failed (${code ?? err?.message})`);
        }
      }
    }

    if (dead.length > 0) {
      for (const h of dead) delete subsMap[h];
      await db.execute(
        'UPDATE wp_options SET option_value = ? WHERE option_name = ?',
        [JSON.stringify(subsMap), SUBS_OPTION],
      );
    }

    // Mark announced only if at least one device actually got the push.
    if (sent > 0) {
      for (const d of drafts) {
        await db.execute(
          'INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)',
          [d.ID, NOTIFIED_META, new Date().toISOString()],
        );
      }
    }
    console.log(`Pushed to ${sent}/${subs.length} device(s)${dead.length ? `, pruned ${dead.length}` : ''}${sent > 0 ? `; marked ${drafts.length} draft(s) notified` : '; nothing marked (no successful sends)'}.`);
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
