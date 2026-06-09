#!/usr/bin/env bun
/**
 * One-off repair: regenerate the stale TEXTLESS News covers.
 *
 * Covers generated before the headline-overlay pipeline was deployed to the server
 * are plain 1200×675 crops with no headline text. This finds every News post whose
 * featured image is exactly 1200×675 AND that has a saved `_maleq_news_cover_url`
 * (so genuine auto/picker covers — never an unrelated post whose image happens to be
 * that size), then recomposes the cover from that URL through the current pipeline
 * (with the headline/title overlaid), re-imports it as the featured image, sets alt,
 * deletes the old textless attachment, and revalidates the live page for published
 * posts.
 *
 * Idempotent-ish: once a cover is regenerated it is no longer 1200×675, so a second
 * run skips it.
 *
 * Dry run by default (lists what it WOULD do):
 *   bun run scripts/news-agent/regenerate-textless-covers.ts                 # DRY RUN
 *   bun run scripts/news-agent/regenerate-textless-covers.ts --write --yes   # apply (PROD)
 *   bun run scripts/news-agent/regenerate-textless-covers.ts --write --yes --limit 5
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { getConnection } from '../lib/db';
import { META, NEWS_CATEGORY } from './config';
import { downloadWebp } from './images';

const execFileP = promisify(execFile);

const argv = process.argv;
const has = (f: string) => argv.includes(f);
const flag = (n: string) => { const i = argv.indexOf(n); return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined; };
const IS_LOCAL = has('--local') || process.env.MYSQL_LOCAL === '1';
const WRITE = has('--write');
const YES = has('--yes');
const LIMIT = flag('--limit') ? parseInt(flag('--limit')!, 10) : 0;

const WP_CLI = process.env.WP_CLI || 'wp';
const WP_PATH = process.env.WP_PATH || '/home/maleq-wp/htdocs/wp.maleq.com';
const WP_EXTRA_PATH = process.env.WP_CLI_EXTRA_PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const WP_ENV = { ...process.env, PATH: `${WP_EXTRA_PATH}:${process.env.PATH || ''}` };

/** The textless-cover signature the old pipeline produced. */
const TEXTLESS_W = 1200;
const TEXTLESS_H = 675;

interface Row { id: number; title: string; slug: string; status: string; thumbId: number; coverUrl: string; headline: string; attMeta: string; }

async function wpcli(args: string[]): Promise<string> {
  const { stdout } = await execFileP(WP_CLI, [...args, `--path=${WP_PATH}`], { timeout: 90_000, env: WP_ENV });
  return stdout.trim();
}

async function upsertMeta(db: any, postId: number, key: string, value: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = ? LIMIT 1`, [postId, key]);
  if (rows.length) await db.execute(`UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?`, [value, rows[0].meta_id]);
  else await db.execute(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`, [postId, key, value]);
}

/** News posts that have a cover URL + a featured image, with the thumb's serialized metadata. */
async function findCandidates(db: any): Promise<Row[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.ID, p.post_title, p.post_name, p.post_status,
            th.meta_value AS thumb_id, cu.meta_value AS cover_url,
            COALESCE(hl.meta_value, '') AS headline, am.meta_value AS att_meta
       FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
       JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug = ?
       JOIN wp_postmeta th ON th.post_id = p.ID AND th.meta_key = '_thumbnail_id'
       JOIN wp_postmeta cu ON cu.post_id = p.ID AND cu.meta_key = ? AND cu.meta_value <> ''
       LEFT JOIN wp_postmeta hl ON hl.post_id = p.ID AND hl.meta_key = ?
       JOIN wp_postmeta am ON am.post_id = th.meta_value AND am.meta_key = '_wp_attachment_metadata'
      WHERE p.post_type = 'post' AND p.post_status IN ('draft','publish','pending','future')
      ORDER BY p.ID DESC`,
    [NEWS_CATEGORY.slug, META.coverUrl, META.coverHeadline],
  );
  return rows
    .map((r) => ({
      id: Number(r.ID), title: String(r.post_title), slug: String(r.post_name), status: String(r.post_status),
      thumbId: Number(r.thumb_id), coverUrl: String(r.cover_url), headline: String(r.headline || ''), attMeta: String(r.att_meta || ''),
    }))
    // Only the textless 1200×675 signature (serialized PHP: s:5:"width";i:1200;).
    .filter((r) => r.attMeta.includes(`"width";i:${TEXTLESS_W};`) && r.attMeta.includes(`"height";i:${TEXTLESS_H};`));
}

async function wpMediaImport(file: string, postId: number, title: string): Promise<number | null> {
  try {
    const stdout = await wpcli(['media', 'import', file, `--post_id=${postId}`, '--featured_image', `--title=${title}`, '--porcelain']);
    const id = parseInt(stdout.split('\n').pop() || '', 10);
    return Number.isNaN(id) ? null : id;
  } catch (e: any) {
    console.log(`      ✗ import failed: ${(e.stderr || e.message || '').toString().slice(0, 160)}`);
    return null;
  }
}

/** Delete the old cover, but only if it's a dedicated child of this post (safety). */
async function deleteOldCover(oldId: number, newId: number, postId: number): Promise<boolean> {
  if (!oldId || oldId === newId) return false;
  try {
    const parent = parseInt(await wpcli(['post', 'get', String(oldId), '--field=post_parent']), 10);
    if (parent !== postId) return false; // not dedicated to this post — leave it
    await wpcli(['post', 'delete', String(oldId), '--force']);
    return true;
  } catch { return false; }
}

async function main() {
  console.log('\n── News Agent · regenerate textless covers ──\n');
  if (WRITE && !IS_LOCAL && !YES) {
    console.error('⛔ Writing to PROD. Re-run with --write --yes to confirm.\n');
    process.exit(1);
  }
  console.log(`Mode: ${WRITE ? (IS_LOCAL ? 'WRITE (local)' : 'WRITE (PROD)') : 'DRY RUN'}  |  signature: ${TEXTLESS_W}×${TEXTLESS_H}\n`);

  const db = await getConnection();
  let candidates = await findCandidates(db);
  if (LIMIT > 0) candidates = candidates.slice(0, LIMIT);
  console.log(`${candidates.length} textless cover(s) to regenerate.\n`);

  let done = 0, failed = 0, revalidated = 0;
  for (const c of candidates) {
    const overlay = (c.headline || c.title).slice(0, 70);
    const label = `#${c.id} [${c.status}] "${c.title.slice(0, 48)}"`;

    if (!WRITE) {
      console.log(`  • ${label}\n      overlay: "${overlay.toUpperCase()}"\n      from: ${c.coverUrl.slice(0, 90)}`);
      continue;
    }

    const file = await downloadWebp(c.coverUrl, c.slug, overlay);
    if (!file) { console.log(`  ✗ ${label} — download/compose failed`); failed++; continue; }

    const attId = await wpMediaImport(file, c.id, c.title);
    await unlink(file).catch(() => {});
    if (!attId) { console.log(`  ✗ ${label} — import failed`); failed++; continue; }

    await upsertMeta(db, attId, '_wp_attachment_image_alt', c.title.slice(0, 125));
    const deletedOld = await deleteOldCover(c.thumbId, attId, c.id);

    // Refresh the live page for published posts (drafts aren't on the site yet).
    if (c.status === 'publish') {
      try { await wpcli(['eval', `maleq_revalidate_frontend_cache(${c.id},"post");`]); revalidated++; } catch {}
    }
    done++;
    console.log(`  ✓ ${label} → #${attId}${deletedOld ? ' (old removed)' : ''}${c.status === 'publish' ? ' (revalidated)' : ''}`);
  }

  await db.end();
  console.log(`\nDone. ${done} regenerated, ${failed} failed, ${revalidated} revalidated.`);
  if (WRITE && !IS_LOCAL) console.log('⚠ Prod write — the cron wrapper normally flushes cache; run `wp cache flush` if titles look stale.');
}

main().catch((e) => { console.error('\nFatal:', e); process.exit(1); });
