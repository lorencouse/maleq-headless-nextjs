#!/usr/bin/env bun
/**
 * Migration: add the LGBTQ-news opt-in column to maleq_push_subscriptions.
 *
 * Consent model — dedicated, opt-IN. DEFAULT 0 means every EXISTING subscriber (who
 * opted in for order/stock/promo notifications, NOT news) stays opted OUT of news until
 * they explicitly enable "LGBTQ News" on the account → notifications page. New subscribers
 * also start at 0. The news web-push broadcast (scripts/news-agent/social/webpush.ts) only
 * sends to rows WHERE pref_news = 1.
 *
 * ⚠ Sequencing: the push code (lib/push/push-service.ts) now SELECTs pref_news, so this
 * MUST be applied to a DB before that code serves traffic against it, or getPreferences()
 * throws "Unknown column 'pref_news'". Run on LOCAL and PROD before deploying.
 *
 * Idempotent: checks for the column first; a second run is a no-op.
 *
 *   LOCAL:  bun run scripts/migrate-add-pref-news.ts --local
 *   PROD:   bun run scripts/migrate-add-pref-news.ts            (run via the user `!` prefix)
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';

async function main() {
  const db = await getConnection();
  try {
    const [cols] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM maleq_push_subscriptions LIKE 'pref_news'",
    );
    if (cols.length) {
      console.log('✓ pref_news already exists — nothing to do.');
    } else {
      await db.execute(
        'ALTER TABLE maleq_push_subscriptions ADD COLUMN pref_news TINYINT(1) NOT NULL DEFAULT 0 AFTER pref_promotions',
      );
      console.log('✓ Added pref_news (TINYINT, DEFAULT 0) to maleq_push_subscriptions.');
    }
    const [prefs] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM maleq_push_subscriptions LIKE 'pref_%'",
    );
    console.log('  pref columns now:', prefs.map((c) => c.Field).join(', '));
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error('\nFatal:', e.message); process.exit(1); });
