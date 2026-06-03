#!/usr/bin/env bun
/**
 * One-time backfill: upgrade existing News posts that currently carry a GENERIC
 * STOCK cover (Pexels) to a real licensed PORTRAIT of the public figure the story
 * is about — when one exists on Wikimedia Commons (then Openverse). Posts that
 * aren't about one named person, or whose subject has no freely-licensed photo,
 * are left exactly as they are.
 *
 * For each candidate it: (1) derives the subject name with Claude (these posts
 * predate the coverPerson field), (2) finds a Commons/Openverse portrait, (3)
 * imports it as the new featured image (16:9, via downloadWebp), (4) swaps the
 * image-credit line in the body, and (5) records the new cover meta.
 *
 * Usage:
 *   bun run scripts/news-agent/backfill-celebrity-covers.ts            # DRY RUN (prod)
 *   bun run scripts/news-agent/backfill-celebrity-covers.ts --write --yes   # apply (PROD)
 *   ...--local [--write]                                               # Local by Flywheel
 * Flags: --limit N (default 25, newest first)  --model NAME
 * Needs ANTHROPIC_API_KEY + PEXELS_API_KEY env (same as the agent).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { getConnection } from '../lib/db';
import { META, NEWS_CATEGORY, DRAFT_MODEL } from './config';
import { downloadWebp, type Cover } from './images';
import { pickCommonsPortrait } from './commons';
import { pickOpenverseCC } from './openverse';

const execFileP = promisify(execFile);
const argv = process.argv;
const has = (f: string) => argv.includes(f);
const flag = (n: string) => { const i = argv.indexOf(n); return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined; };
const IS_LOCAL = has('--local') || process.env.MYSQL_LOCAL === '1';
const WRITE = has('--write');
const YES = has('--yes');
const LIMIT = flag('--limit') ? parseInt(flag('--limit')!, 10) : 25;
const MODEL = flag('--model') || DRAFT_MODEL;

const WP_CLI = process.env.WP_CLI || 'wp';
const WP_PATH = process.env.WP_PATH || '/home/maleq-wp/htdocs/wp.maleq.com';
const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const WP_ENV = { ...process.env, PATH: `${SYSTEM_PATH}:${process.env.PATH || ''}` };

const PersonSchema = z.object({
  coverPerson: z.string().nullable().describe(
    'If the story is CENTRALLY about ONE specific public figure (their name is the ' +
    'subject — a celebrity, athlete, politician, artist), their full name EXACTLY as ' +
    'it would title their Wikipedia article. Null if it is about an event, a group, ' +
    'or several people rather than one identifiable individual.',
  ),
});

async function upsertMeta(db: any, postId: number, key: string, value: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = ? LIMIT 1`, [postId, key]);
  if (rows.length) await db.execute(`UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?`, [value, rows[0].meta_id]);
  else await db.execute(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`, [postId, key, value]);
}

interface Candidate { id: number; title: string; excerpt: string; slug: string; content: string; person: string; }

/** News posts whose current cover is generic Pexels stock (the upgrade targets). */
async function findStockCovered(db: any): Promise<Candidate[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.ID, p.post_title, p.post_excerpt, p.post_name, p.post_content,
            cp.meta_value AS person
       FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
       JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug = ?
       JOIN wp_postmeta cc ON cc.post_id = p.ID AND cc.meta_key = ? AND cc.meta_value LIKE '%Pexels%'
       LEFT JOIN wp_postmeta cp ON cp.post_id = p.ID AND cp.meta_key = ?
      WHERE p.post_type = 'post' AND p.post_status IN ('draft','publish')
      ORDER BY p.post_date DESC
      LIMIT ?`,
    [NEWS_CATEGORY.slug, META.coverCredit, META.coverPerson, LIMIT]);
  return rows.map((r) => ({
    id: Number(r.ID),
    title: String(r.post_title),
    excerpt: String(r.post_excerpt || ''),
    slug: String(r.post_name),
    content: String(r.post_content || ''),
    person: r.person ? String(r.person) : '',
  }));
}

async function wpMediaImport(file: string, postId: number, title: string): Promise<number | null> {
  try {
    const { stdout } = await execFileP(
      WP_CLI,
      ['media', 'import', file, `--post_id=${postId}`, '--featured_image', `--title=${title}`, '--porcelain', `--path=${WP_PATH}`],
      { timeout: 90_000, env: WP_ENV });
    const id = parseInt(stdout.trim().split('\n').pop() || '', 10);
    return Number.isNaN(id) ? null : id;
  } catch (e: any) {
    console.log(`      wp media import failed: ${(e.stderr || e.message || '').toString().slice(0, 160)}`);
    return null;
  }
}

function link(href: string | undefined, text: string): string {
  const name = text.replace(/[<>]/g, '');
  return href ? `<a href="${href.replace(/"/g, '%22')}" target="_blank" rel="nofollow noopener">${name}</a>` : name;
}
function creditLine(cover: Cover): string {
  if (cover.source === 'pexels') return `<p class="image-credit"><em>Cover photo: ${link(cover.creditUrl, cover.credit)} / Pexels</em></p>`;
  const platform = cover.source === 'commons' ? 'Wikimedia Commons' : 'Openverse';
  const lic = cover.licenseName ? `, ${link(cover.licenseUrl, cover.licenseName)}` : '';
  return `<p class="image-credit"><em>Cover photo: ${link(cover.creditUrl, cover.credit)}${lic}, via ${platform}</em></p>`;
}
/** Remove any existing image-credit paragraph(s) so we can swap in the new one. */
function stripCredit(html: string): string {
  return html.replace(/\s*<p class="image-credit">[\s\S]*?<\/p>/gi, '').trimEnd();
}

async function derivePerson(client: Anthropic, c: Candidate): Promise<string | null> {
  if (c.person) return c.person; // already known
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 200,
    system: [{ type: 'text', text: 'You identify whether an LGBTQ news headline is centrally about one specific named public figure.' }],
    output_config: { format: zodOutputFormat(PersonSchema) },
    messages: [{ role: 'user', content: `HEADLINE: ${c.title}\nDEK: ${c.excerpt}` }],
  });
  return res.parsed_output?.coverPerson?.trim() || null;
}

async function main() {
  console.log('\n── News Agent · backfill celebrity covers ──\n');
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set.'); process.exit(1); }
  if (WRITE && !IS_LOCAL && !YES) { console.error('⛔ Writing to PROD. Re-run with --write --yes.\n'); process.exit(1); }
  console.log(`Mode: ${WRITE ? (IS_LOCAL ? 'WRITE (local)' : 'WRITE (PROD)') : 'DRY RUN'}  |  model: ${MODEL}  |  limit: ${LIMIT}\n`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const db = await getConnection();
  const candidates = await findStockCovered(db);
  console.log(`${candidates.length} stock-covered News post(s) to evaluate.\n`);

  let upgraded = 0, noPerson = 0, noPhoto = 0;
  for (const c of candidates) {
    const label = `#${c.id} "${c.title.slice(0, 48)}"`;
    let person: string | null = null;
    try { person = await derivePerson(client, c); } catch (e: any) { console.log(`  · ${label} — name lookup failed: ${e.message}`); continue; }
    if (!person) { noPerson++; console.log(`  · ${label} — not about one named person (keep stock)`); continue; }

    const cover: Cover | null = (await pickCommonsPortrait(person)) || (await pickOpenverseCC(person));
    if (!cover) { noPhoto++; console.log(`  · ${label} — "${person}": no free portrait (keep stock)`); continue; }

    const creditText = cover.source === 'pexels'
      ? `${cover.credit} / Pexels`
      : `${cover.credit}${cover.licenseName ? `, ${cover.licenseName}` : ''} via ${cover.source === 'commons' ? 'Wikimedia Commons' : 'Openverse'}`;

    if (!WRITE) {
      console.log(`  ✓ ${label} — "${person}" → ${cover.source} portrait (${creditText})`);
      upgraded++;
      continue;
    }

    const file = await downloadWebp(cover.url, c.slug);
    if (!file) { console.log(`  ✗ ${label} — portrait download/convert failed; skipped`); continue; }
    const attId = await wpMediaImport(file, c.id, c.title);
    await unlink(file).catch(() => {});
    if (!attId) { console.log(`  ✗ ${label} — import failed; skipped`); continue; }

    await upsertMeta(db, attId, '_wp_attachment_image_alt', (cover.alt || c.title).slice(0, 125));
    const newContent = `${stripCredit(c.content)}\n${creditLine(cover)}`;
    await db.execute(`UPDATE wp_posts SET post_content = ? WHERE ID = ?`, [newContent, c.id]);
    await upsertMeta(db, c.id, META.coverUrl, cover.url);
    await upsertMeta(db, c.id, META.coverCredit, creditText);
    await upsertMeta(db, c.id, META.coverPerson, person);
    upgraded++;
    console.log(`  ✓ ${label} — "${person}" → attachment #${attId} (${cover.source}: ${creditText})`);
  }

  await db.end();
  console.log(`\nDone. ${upgraded} upgraded${WRITE ? '' : ' (would upgrade)'}, ${noPerson} not-a-person, ${noPhoto} no-free-photo.`);
  if (WRITE && !IS_LOCAL) console.log('⚠ Prod write — run `wp cache flush` on the server.');
}

main().catch((e) => { console.error('\nFatal:', e); process.exit(1); });
