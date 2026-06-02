#!/usr/bin/env bun
/**
 * Attach legal cover images to News posts that don't have one yet.
 *
 * For each of our News posts lacking a featured image, pick a thematic Pexels photo
 * from its tags, import it as the WordPress featured image via wp-cli (which builds
 * the thumbnail sizes properly), set alt text, and append a small photo credit line.
 *
 * Idempotent: marks _maleq_news_cover_done so a post is only attempted once. Runs in
 * the cron right after run.ts, so drafts have covers before you review/publish them.
 *
 * Usage:
 *   bun run scripts/news-agent/attach-covers.ts --local                 # DRY RUN
 *   bun run scripts/news-agent/attach-covers.ts --local --write --yes    # attach (local)
 *   bun run scripts/news-agent/attach-covers.ts --write --yes            # attach (PROD)
 *
 * Needs PEXELS_API_KEY. wp-cli location via WP_CLI / WP_PATH (default server paths).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { getConnection } from '../lib/db';
import { META, NEWS_CATEGORY } from './config';
import { pickCover, downloadWebp, imagesEnabled } from './images';

const execFileP = promisify(execFile);

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

const WP_CLI = process.env.WP_CLI || 'wp';
const WP_PATH = process.env.WP_PATH || '/home/maleq-wp/htdocs/wp.maleq.com';

interface Candidate { id: number; title: string; slug: string; tags: string[]; coverQuery: string; }

async function upsertMeta(db: any, postId: number, key: string, value: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = ? LIMIT 1`,
    [postId, key],
  );
  if (rows.length) await db.execute(`UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?`, [value, rows[0].meta_id]);
  else await db.execute(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`, [postId, key, value]);
}

/** News posts that are ours, have no featured image, and haven't been attempted. */
async function findNeedingCover(db: any): Promise<Candidate[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.ID, p.post_title, p.post_name
       FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
       JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug = ?
       JOIN wp_postmeta src ON src.post_id = p.ID AND src.meta_key = ?
       LEFT JOIN wp_postmeta th ON th.post_id = p.ID AND th.meta_key = '_thumbnail_id'
       LEFT JOIN wp_postmeta dn ON dn.post_id = p.ID AND dn.meta_key = ?
      WHERE p.post_type = 'post' AND p.post_status IN ('draft','publish')
        AND th.meta_value IS NULL AND dn.meta_value IS NULL
      ORDER BY p.post_date DESC
      LIMIT ?`,
    [NEWS_CATEGORY.slug, META.sourceUrl, META.coverDone, LIMIT],
  );
  const candidates: Candidate[] = [];
  for (const r of rows) {
    const [tagRows] = await db.query<RowDataPacket[]>(
      `SELECT t.name FROM wp_term_relationships tr
         JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'post_tag'
         JOIN wp_terms t ON t.term_id = tt.term_id
        WHERE tr.object_id = ?`,
      [r.ID],
    );
    const [[cq]] = await db.query<RowDataPacket[]>(
      `SELECT meta_value v FROM wp_postmeta WHERE post_id = ? AND meta_key = ? LIMIT 1`,
      [r.ID, META.coverQuery],
    ) as any;
    candidates.push({
      id: Number(r.ID),
      title: String(r.post_title),
      slug: String(r.post_name),
      tags: tagRows.map((x) => String(x.name)),
      coverQuery: cq?.v ? String(cq.v) : '',
    });
  }
  return candidates;
}

/** Import a local image file as the post's featured image. Returns the attachment ID. */
async function wpMediaImport(file: string, postId: number, title: string): Promise<number | null> {
  try {
    const { stdout } = await execFileP(
      WP_CLI,
      ['media', 'import', file, `--post_id=${postId}`, '--featured_image', `--title=${title}`, '--porcelain', `--path=${WP_PATH}`],
      { timeout: 90_000 },
    );
    const id = parseInt(stdout.trim().split('\n').pop() || '', 10);
    return Number.isNaN(id) ? null : id;
  } catch (e: any) {
    console.log(`      wp media import failed: ${(e.stderr || e.message || '').toString().slice(0, 160)}`);
    return null;
  }
}

function creditLine(credit: string, creditUrl: string): string {
  const url = creditUrl.replace(/"/g, '%22');
  const name = credit.replace(/</g, '').replace(/>/g, '');
  return `<p class="image-credit"><em>Cover photo: <a href="${url}" target="_blank" rel="nofollow noopener">${name}</a> / Pexels</em></p>`;
}

async function main() {
  console.log('\n── News Agent · attach cover images ──\n');
  if (!imagesEnabled) {
    console.error('PEXELS_API_KEY not set — cannot fetch images. Add it to .env / .env.local.');
    process.exit(1);
  }
  if (WRITE && !IS_LOCAL && !YES) {
    console.error('⛔ Writing covers to PROD. Re-run with --write --yes to confirm.\n');
    process.exit(1);
  }
  console.log(`Mode: ${WRITE ? (IS_LOCAL ? 'WRITE (local)' : 'WRITE (PROD)') : 'DRY RUN'}  |  wp: ${WP_CLI} --path=${WP_PATH}\n`);

  const db = await getConnection();
  const candidates = await findNeedingCover(db);
  console.log(`${candidates.length} News post(s) need a cover.\n`);

  for (const c of candidates) {
    // Prefer the drafter's concrete image phrase; fall back to tags, then title.
    const keywords = c.coverQuery
      ? [c.coverQuery]
      : c.tags.length ? c.tags : c.title.split(/\s+/).filter((w) => w.length > 3);
    const cover = await pickCover(keywords);
    const label = `#${c.id} "${c.title.slice(0, 50)}"`;

    if (!cover) {
      console.log(`  ⊘ ${label} — no image found for [${keywords.slice(0, 3).join(', ')}]`);
      if (WRITE) await upsertMeta(db, c.id, META.coverDone, '1'); // don't retry forever
      continue;
    }

    if (!WRITE) {
      console.log(`  • ${label}\n      → ${cover.url}\n      will save as ${c.slug}.webp (≤1200px, webp q80), credit: ${cover.credit} / Pexels  (query: ${keywords.slice(0, 3).join(' ')})`);
      continue;
    }

    // Download → resize → WebP, named after the article slug (SEO).
    const file = await downloadWebp(cover.url, c.slug);
    if (!file) {
      console.log(`  ✗ ${label} — image download/convert failed; will retry next run`);
      continue;
    }

    const attId = await wpMediaImport(file, c.id, c.title);
    await unlink(file).catch(() => {});
    if (!attId) {
      console.log(`  ✗ ${label} — import failed; will retry next run`);
      continue; // leave cover_done unset so it retries
    }

    // Alt text (article-relevant) on the attachment + credit line on the post + reference meta.
    await upsertMeta(db, attId, '_wp_attachment_image_alt', c.title.slice(0, 125));
    await db.execute(`UPDATE wp_posts SET post_content = CONCAT(post_content, '\n', ?) WHERE ID = ?`, [
      creditLine(cover.credit, cover.creditUrl),
      c.id,
    ]);
    await upsertMeta(db, c.id, META.coverUrl, cover.url);
    await upsertMeta(db, c.id, META.coverCredit, `${cover.credit} / Pexels`);
    await upsertMeta(db, c.id, META.coverDone, '1');
    console.log(`  ✓ ${label} → attachment #${attId} (${cover.credit} / Pexels)`);
  }

  await db.end();
  console.log('\nDone.');
  if (WRITE && !IS_LOCAL) console.log('⚠ Prod write — run `wp cache flush` (the cron wrapper does this).');
}

main().catch((e) => { console.error('\nFatal:', e); process.exit(1); });
