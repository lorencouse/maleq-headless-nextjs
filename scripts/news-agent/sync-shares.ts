#!/usr/bin/env bun
/**
 * Approval → auto-share. Finds News posts that YOU have approved (i.e. published
 * in WP) but that haven't been shared yet, and posts them to Bluesky + Mastodon.
 *
 * "Approve" = publish the draft in WP admin. This script then shares it ONCE.
 * Idempotent + per-platform safe: each post records which platforms succeeded in
 * _maleq_news_share_urls, so a re-run only retries the platforms that failed and
 * never double-posts. Safe to run on every schedule tick alongside run.ts.
 *
 * Selection: post_type=post, status=publish, in the News category, carrying our
 * _maleq_news_source_url marker, and not yet fully shared.
 *
 * Usage:
 *   bun run scripts/news-agent/sync-shares.ts --local                 # DRY RUN (no posts, no writes)
 *   bun run scripts/news-agent/sync-shares.ts --local --write --yes    # share approved local posts
 *   bun run scripts/news-agent/sync-shares.ts --write --yes            # share approved PROD posts
 *
 * --write posts PUBLICLY, so --yes is always required with it.
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getConnection } from '../lib/db';
import { META, NEWS_CATEGORY, postUrl } from './config';
import { bluesky } from './social/bluesky';
import { mastodon } from './social/mastodon';
import { pinterest } from './social/pinterest';
import { tumblr } from './social/tumblr';
import { shareToSocial } from './share';
import type { ShareInput } from './social/types';

const ADAPTERS = [bluesky, mastodon, pinterest, tumblr];

const argv = process.argv;
const has = (f: string) => argv.includes(f);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const IS_LOCAL = has('--local') || process.env.MYSQL_LOCAL === '1';
const WRITE = has('--write');
const YES = has('--yes');
const LIMIT = flag('--limit') ? parseInt(flag('--limit')!, 10) : 10;

interface Candidate {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  imageUrl: string | null;
  coverSourceUrl: string | null;
  coverHeadline: string;
  socialText: string;
  hashtags: string[];
  shareUrls: Record<string, string>;
  sharedAt: string;
}

/** Insert-or-update a single postmeta row (wp_postmeta has no natural unique key). */
async function upsertMeta(db: any, postId: number, key: string, value: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = ? LIMIT 1`,
    [postId, key],
  );
  if (rows.length) {
    await db.execute(`UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?`, [value, rows[0].meta_id]);
  } else {
    await db.execute(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`, [postId, key, value]);
  }
}

async function deleteMeta(db: any, postId: number, key: string) {
  await db.execute(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`, [postId, key]);
}

async function findApprovedUnshared(db: any): Promise<Candidate[]> {
  // Published News posts that are ours, newest first. We deliberately do NOT filter on
  // `_maleq_news_shared_at`: the maleq-news-autoshare.php plugin sets that flag on publish
  // based only on ITS platforms (Bluesky + Mastodon), which would hide posts still needing
  // Pinterest/Tumblr. Instead we select the newest posts and decide per-platform from
  // `share_urls` in main() — so this path completes whatever the plugin couldn't. The LIMIT
  // bounds the scan to recent posts (older fully-shared ones simply fall out of the window).
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.ID, p.post_title, p.post_name, p.post_excerpt,
            src.meta_value     AS source_url,
            img.meta_value     AS image_url,
            shared.meta_value  AS shared_at,
            urls.meta_value    AS share_urls,
            soc.meta_value     AS social_text,
            tags.meta_value    AS hashtags,
            cov.meta_value     AS cover_url,
            hl.meta_value      AS cover_headline
       FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
       JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug = ?
       JOIN wp_postmeta src ON src.post_id = p.ID AND src.meta_key = ?
       LEFT JOIN wp_postmeta img    ON img.post_id = p.ID    AND img.meta_key = ?
       LEFT JOIN wp_postmeta shared ON shared.post_id = p.ID AND shared.meta_key = ?
       LEFT JOIN wp_postmeta urls   ON urls.post_id = p.ID   AND urls.meta_key = ?
       LEFT JOIN wp_postmeta soc    ON soc.post_id = p.ID    AND soc.meta_key = ?
       LEFT JOIN wp_postmeta tags   ON tags.post_id = p.ID   AND tags.meta_key = ?
       LEFT JOIN wp_postmeta cov    ON cov.post_id = p.ID    AND cov.meta_key = ?
       LEFT JOIN wp_postmeta hl     ON hl.post_id = p.ID     AND hl.meta_key = ?
      WHERE p.post_type = 'post' AND p.post_status = 'publish'
      ORDER BY p.post_date DESC
      LIMIT ?`,
    [NEWS_CATEGORY.slug, META.sourceUrl, META.imageUrl, META.sharedAt, META.shareUrls, META.socialText, META.hashtags, META.coverUrl, META.coverHeadline, LIMIT],
  );
  return rows.map((r) => ({
    id: Number(r.ID),
    title: String(r.post_title),
    slug: String(r.post_name),
    excerpt: String(r.post_excerpt || ''),
    imageUrl: r.image_url ? String(r.image_url) : null,
    coverSourceUrl: r.cover_url ? String(r.cover_url) : null,
    coverHeadline: r.cover_headline ? String(r.cover_headline) : '',
    socialText: r.social_text ? String(r.social_text) : '',
    hashtags: r.hashtags ? safeJsonArray(String(r.hashtags)) : [],
    shareUrls: r.share_urls ? safeJson(String(r.share_urls)) : {},
    sharedAt: r.shared_at ? String(r.shared_at) : '',
  }));
}

function safeJson(s: string): Record<string, string> {
  try { return JSON.parse(s); } catch { return {}; }
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   News Agent · share approved posts        ║');
  console.log('╚════════════════════════════════════════════╝\n');

  if (WRITE && !YES) {
    console.error('⛔ --write posts PUBLICLY to your social accounts. Re-run with --write --yes to confirm.\n');
    process.exit(1);
  }

  const enabled = ADAPTERS.filter((a) => a.enabled).map((a) => a.platform);
  if (enabled.length === 0) {
    console.error('No social adapters configured (set Bluesky/Mastodon creds in .env.local).');
    process.exit(1);
  }
  console.log(`Mode:      ${WRITE ? 'WRITE (will post publicly)' : 'DRY RUN'}`);
  console.log(`DB:        ${IS_LOCAL ? 'local' : 'PROD'}`);
  console.log(`Platforms: ${enabled.join(', ')}\n`);

  const db = await getConnection();
  const candidates = await findApprovedUnshared(db);
  console.log(`Found ${candidates.length} approved, not-yet-shared News post(s).\n`);

  for (const c of candidates) {
    const url = postUrl(c.slug);
    const todo = enabled.filter((p) => !c.shareUrls[p]); // skip platforms already done
    const label = `#${c.id} "${c.title.slice(0, 55)}"`;

    if (todo.length === 0) {
      // Fully shared to every enabled platform. We re-scan recent posts each run, so stay
      // quiet unless this is the moment it becomes complete (shared_at not yet stamped).
      if (WRITE && !c.sharedAt) {
        await upsertMeta(db, c.id, META.sharedAt, new Date().toISOString());
        console.log(`  ⤳ ${label} — shared everywhere; marked done.`);
      }
      continue;
    }

    if (!WRITE) {
      console.log(`  • ${label}`);
      console.log(`      → would share to ${todo.join(', ')}  (link: ${url})`);
      continue;
    }

    const input: ShareInput = {
      title: c.title,
      excerpt: c.excerpt,
      url,
      imageUrl: c.imageUrl,
      socialText: c.socialText,
      hashtags: c.hashtags,
      coverSourceUrl: c.coverSourceUrl,
      coverHeadline: c.coverHeadline,
    };
    const results = await shareToSocial(input, todo.join(','));

    const merged = { ...c.shareUrls };
    for (const r of results) {
      if (r.ok) {
        merged[r.platform] = r.url || 'posted';
        console.log(`  ✓ ${label} → ${r.platform}: ${r.url || 'posted'}`);
      } else {
        console.log(`  ✗ ${label} → ${r.platform}: ${r.error}`);
      }
    }

    await upsertMeta(db, c.id, META.shareUrls, JSON.stringify(merged));
    // Mark fully shared only once every enabled platform has a recorded URL.
    if (enabled.every((p) => merged[p])) {
      await upsertMeta(db, c.id, META.sharedAt, new Date().toISOString());
      await deleteMeta(db, c.id, META.pending); // approved + shared → no longer pending
    }
  }

  await db.end();
  console.log('\nDone.');
  if (WRITE && !IS_LOCAL) {
    console.log('⚠ Prod meta written — run `wp cache flush` on the server.');
  }
}

main().catch((e) => { console.error('\nFatal:', e); process.exit(1); });
