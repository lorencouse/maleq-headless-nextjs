#!/usr/bin/env bun
/**
 * One-off repair: existing News posts have IMDb name-page links baked into their
 * body for people who are actually politicians — the old entity-linker sent
 * politicians who also carry an entertainer occupation (Trump → TV presenter,
 * Schwarzenegger/Zelenskyy → actor) to IMDb.
 *
 * For every imdb.com/name/ link in a News post body, re-resolve the linked person
 * by its ANCHOR TEXT through the (now-fixed) resolver. ONLY when the person now
 * resolves to a non-IMDb target (official site / Wikipedia — i.e. a politician) do
 * we rewrite that link's href. Genuine entertainer links (still resolve to IMDb)
 * and unresolvable names are left exactly as they are. Published posts are saved
 * via wp-cli so the save_post hook revalidates the live page.
 *
 * Dry run by default (prints the swap plan):
 *   bun run scripts/news-agent/relink-politicians.ts                 # DRY RUN
 *   bun run scripts/news-agent/relink-politicians.ts --write --yes   # apply (PROD)
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { getConnection } from '../lib/db';
import { NEWS_CATEGORY } from './config';
import { resolveEntity } from './entity-links';

const execFileP = promisify(execFile);

const argv = process.argv;
const has = (f: string) => argv.includes(f);
const IS_LOCAL = has('--local') || process.env.MYSQL_LOCAL === '1';
const WRITE = has('--write');
const YES = has('--yes');

const WP_CLI = process.env.WP_CLI || 'wp';
const WP_PATH = process.env.WP_PATH || '/home/maleq-wp/htdocs/wp.maleq.com';
const WP_EXTRA_PATH = process.env.WP_CLI_EXTRA_PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const WP_ENV = { ...process.env, PATH: `${WP_EXTRA_PATH}:${process.env.PATH || ''}` };

/** <a href="https://www.imdb.com/name/nm123/" target=... rel=...>Anchor Text</a> */
const IMDB_NAME_RE = /<a\s+href="https?:\/\/www\.imdb\.com\/name\/nm\d+\/?"([^>]*)>(.*?)<\/a>/gi;
const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// Cache resolutions by anchor text so a person linked in several posts resolves once.
const cache = new Map<string, Awaited<ReturnType<typeof resolveEntity>>>();
async function resolvePerson(name: string) {
  if (!cache.has(name)) cache.set(name, await resolveEntity(name, 'person'));
  return cache.get(name)!;
}

interface Post { id: number; status: string; title: string; content: string; }

async function findPosts(db: any): Promise<Post[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.ID, p.post_status, p.post_title, p.post_content
       FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
       JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug = ?
      WHERE p.post_type = 'post' AND p.post_content LIKE '%imdb.com/name/%'
      ORDER BY p.ID DESC`,
    [NEWS_CATEGORY.slug],
  );
  return rows.map((r) => ({ id: Number(r.ID), status: String(r.post_status), title: String(r.post_title), content: String(r.post_content) }));
}

async function wpUpdateContent(id: number, content: string) {
  // Write to a temp file and pass its path — `wp post update <id> <file>` reads the
  // new post_content from it (async execFile can't feed STDIN), and the save fires
  // save_post → the revalidation hook for published posts.
  const tmp = join(tmpdir(), `relink-${id}.html`);
  await writeFile(tmp, content, 'utf8');
  try {
    await execFileP(WP_CLI, ['post', 'update', String(id), tmp, `--path=${WP_PATH}`],
      { env: WP_ENV, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

async function main() {
  console.log('\n── News Agent · re-link politicians off IMDb ──\n');
  if (WRITE && !IS_LOCAL && !YES) {
    console.error('⛔ Writing to PROD. Re-run with --write --yes to confirm.\n');
    process.exit(1);
  }
  console.log(`Mode: ${WRITE ? (IS_LOCAL ? 'WRITE (local)' : 'WRITE (PROD)') : 'DRY RUN'}\n`);

  const db = await getConnection();
  const posts = await findPosts(db);
  console.log(`${posts.length} News post(s) contain IMDb name links.\n`);

  let changedPosts = 0, swaps = 0, kept = 0;
  for (const p of posts) {
    // Collect distinct (fullMatch, attrs, anchor) tuples in this post.
    const matches: { full: string; attrs: string; anchor: string }[] = [];
    for (const m of p.content.matchAll(IMDB_NAME_RE)) {
      matches.push({ full: m[0], attrs: m[1], anchor: stripTags(m[2]) });
    }
    let content = p.content;
    const lines: string[] = [];
    for (const mt of matches) {
      const r = await resolvePerson(mt.anchor);
      if (r && r.source !== 'imdb' && r.url) {
        // Politician (or non-entertainer) — rewrite only the href, keep text + attrs.
        const rebuilt = mt.full.replace(/href="[^"]*"/, `href="${r.url.replace(/"/g, '%22')}"`);
        content = content.split(mt.full).join(rebuilt);
        lines.push(`      ↪ ${mt.anchor}: IMDb → ${r.source} ${r.url}`);
        swaps++;
      } else {
        lines.push(`      • ${mt.anchor}: kept (${r ? r.source : 'no resolve'})`);
        kept++;
      }
    }
    const changed = content !== p.content;
    if (lines.length) {
      console.log(`#${p.id} [${p.status}] "${p.title.slice(0, 48)}"`);
      console.log(lines.join('\n'));
    }
    if (changed) {
      changedPosts++;
      if (WRITE) {
        try { await wpUpdateContent(p.id, content); console.log(`      ✓ saved`); }
        catch (e: any) { console.log(`      ✗ save failed: ${(e.stderr || e.message || '').toString().slice(0, 140)}`); }
      }
    }
  }

  await db.end();
  console.log(`\n${WRITE ? 'Done' : 'DRY RUN'}. ${swaps} link(s) → official/Wikipedia, ${kept} kept on IMDb, across ${changedPosts} post(s) to change.`);
}

main().catch((e) => { console.error('\nFatal:', e); process.exit(1); });
