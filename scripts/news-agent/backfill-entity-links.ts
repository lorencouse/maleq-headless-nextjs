#!/usr/bin/env bun
/**
 * One-time backfill: add contextual entity links (IMDb / Rotten Tomatoes /
 * Goodreads / AllMusic / Steam / official sites / Wikipedia) to the bodies of
 * existing News posts, the same way the live drafter now does for new pieces.
 *
 * These posts predate the entityLinks field, so we re-derive the linkworthy
 * entities from the existing body with Claude (anchor text + lookup term + kind),
 * then resolve every URL ourselves via Wikipedia/Wikidata and inject the verified
 * links (entity-links.ts). No URL ever comes from the model.
 *
 * Pure post_content rewrite — no wp-cli / media needed, so it runs fine over the
 * SSH tunnel. Idempotent: sets _maleq_news_links_done, and skips any post whose
 * article body already contains links (so it never double-links new-pipeline posts).
 *
 * Usage:
 *   bun run scripts/news-agent/backfill-entity-links.ts                 # DRY RUN (prod via tunnel)
 *   bun run scripts/news-agent/backfill-entity-links.ts --write --yes    # apply (PROD)
 *   ...--local [--write]                                                 # Local by Flywheel
 * Flags: --limit N (default 50, newest first)  --model NAME
 * Needs ANTHROPIC_API_KEY.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { getConnection } from '../lib/db';
import { META, NEWS_CATEGORY, DRAFT_MODEL } from './config';
import { addEntityLinks } from './entity-links';

const argv = process.argv;
const has = (f: string) => argv.includes(f);
const flag = (n: string) => { const i = argv.indexOf(n); return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined; };
const IS_LOCAL = has('--local') || process.env.MYSQL_LOCAL === '1';
const WRITE = has('--write');
const YES = has('--yes');
const LIMIT = flag('--limit') ? parseInt(flag('--limit')!, 10) : 50;
const MODEL = flag('--model') || DRAFT_MODEL;

const EntitySchema = z.object({
  entityLinks: z.array(z.object({
    text: z.string().describe('The anchor phrase EXACTLY as it appears in the body HTML below (a verbatim substring, same casing). If you can\'t copy it verbatim, omit the entity.'),
    query: z.string().describe('The entity\'s name for a lookup — the Wikipedia/IMDb article title when you know it (e.g. "Heartstopper (TV series)", "Stonewall Inn", "GLAAD").'),
    kind: z.enum(['film', 'tv', 'person', 'organization', 'place', 'book', 'music', 'game', 'other']).describe(
      'What KIND of entity this is — picks the authoritative site: film/tv → IMDb/Rotten Tomatoes; ' +
      'person → IMDb/Wikipedia; organization & place → official site/Wikipedia; book → Goodreads; ' +
      'music (album/song) → AllMusic; game → Steam; other (law, event, play, topic) → Wikipedia.',
    ),
  })).describe(
    'Notable real-world entities in the body a professional outlet would hyperlink: films, TV ' +
    'shows, books, albums, games, places/venues, organizations, and public figures. For each, ' +
    'give the EXACT anchor text from the body, a lookup term, and its kind. Only unambiguous, ' +
    'genuinely notable entities; FIRST mention only; no duplicates; skip generic phrases ("the ' +
    'court", "activists"). 0 to 6 items. We verify each and drop ones that don\'t resolve.',
  ),
});

const SYSTEM = 'You add the contextual links a professional news outlet uses. Given a published ' +
  'article, identify the notable real-world entities worth linking and classify each. Copy anchor ' +
  'text verbatim from the body so it can be matched exactly. Be precise, not exhaustive.';

interface Candidate { id: number; title: string; content: string; }

async function upsertMeta(db: any, postId: number, key: string, value: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = ? LIMIT 1`, [postId, key]);
  if (rows.length) await db.execute(`UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?`, [value, rows[0].meta_id]);
  else await db.execute(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`, [postId, key, value]);
}

/** Our News posts that haven't had entity links added yet (newest first). */
async function findPosts(db: any): Promise<Candidate[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.ID, p.post_title, p.post_content
       FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
       JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug = ?
       JOIN wp_postmeta src ON src.post_id = p.ID AND src.meta_key = ?
       LEFT JOIN wp_postmeta ld ON ld.post_id = p.ID AND ld.meta_key = ?
      WHERE p.post_type = 'post' AND p.post_status IN ('draft','publish')
        AND ld.meta_value IS NULL
      ORDER BY p.post_date DESC
      LIMIT ?`,
    [NEWS_CATEGORY.slug, META.sourceUrl, META.linksDone, LIMIT]);
  return rows.map((r) => ({ id: Number(r.ID), title: String(r.post_title), content: String(r.post_content || '') }));
}

/**
 * Split the article body from the appended attribution/credit blocks, which live
 * at the very end (`<p class="news-source">`, `<p class="image-credit">`). We only
 * inject links into the article body, never into those credit lines.
 */
function splitBody(content: string): { head: string; tail: string } {
  const m = /<p class="(?:news-source|image-credit)">/i.exec(content);
  return m ? { head: content.slice(0, m.index), tail: content.slice(m.index) } : { head: content, tail: '' };
}

/** A plain-text rendering of the body for the model (tags stripped, spacing kept). */
function toText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function deriveEntities(client: Anthropic, c: Candidate, bodyHtml: string) {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 700,
    system: [{ type: 'text', text: SYSTEM }],
    output_config: { format: zodOutputFormat(EntitySchema) },
    messages: [{ role: 'user', content: `HEADLINE: ${c.title}\n\nARTICLE BODY (plain text):\n${toText(bodyHtml)}` }],
  });
  return res.parsed_output?.entityLinks || [];
}

async function main() {
  console.log('\n── News Agent · backfill entity links ──\n');
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set.'); process.exit(1); }
  if (WRITE && !IS_LOCAL && !YES) { console.error('⛔ Writing to PROD. Re-run with --write --yes.\n'); process.exit(1); }
  console.log(`Mode: ${WRITE ? (IS_LOCAL ? 'WRITE (local)' : 'WRITE (PROD)') : 'DRY RUN'}  |  model: ${MODEL}  |  limit: ${LIMIT}\n`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const db = await getConnection();
  const candidates = await findPosts(db);
  console.log(`${candidates.length} News post(s) without entity links.\n`);

  let linked = 0, already = 0, none = 0;
  for (const c of candidates) {
    const label = `#${c.id} "${c.title.slice(0, 48)}"`;
    const { head, tail } = splitBody(c.content);

    // Guard: if the article body already has links (e.g. a new-pipeline post), skip
    // and just mark done — never double-link.
    if (/<a\s/i.test(head)) {
      already++;
      console.log(`  · ${label} — already has links (skip)`);
      if (WRITE) await upsertMeta(db, c.id, META.linksDone, '1');
      continue;
    }

    let entities: any[] = [];
    try { entities = await deriveEntities(client, c, head); }
    catch (e: any) { console.log(`  · ${label} — extraction failed: ${e.message}`); continue; }

    const { html: newHead, linked: hits } = await addEntityLinks(head, entities);
    if (!hits.length) {
      none++;
      console.log(`  · ${label} — no linkworthy entities resolved`);
      if (WRITE) await upsertMeta(db, c.id, META.linksDone, '1');
      continue;
    }

    const summary = hits.map((h) => `${h.source}:${h.text}`).join(', ');
    if (!WRITE) {
      linked++;
      console.log(`  ✓ ${label} — ${hits.length} link(s): ${summary}`);
      continue;
    }

    await db.execute(`UPDATE wp_posts SET post_content = ? WHERE ID = ?`, [newHead + tail, c.id]);
    await upsertMeta(db, c.id, META.linksDone, '1');
    linked++;
    console.log(`  ✓ ${label} — ${hits.length} link(s): ${summary}`);
  }

  await db.end();
  console.log(`\nDone. ${linked} linked${WRITE ? '' : ' (would link)'}, ${already} already-linked, ${none} no-entities.`);
  if (WRITE && !IS_LOCAL) console.log('⚠ Prod write — run `wp cache flush` on the server so WPGraphQL serves the new bodies.');
}

main().catch((e) => { console.error('\nFatal:', e); process.exit(1); });
