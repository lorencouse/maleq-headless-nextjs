#!/usr/bin/env bun
/**
 * One-off, DETERMINISTIC unlink of a hand-picked list of junk entity links the
 * audit surfaced — anchors that are not real linkable entities (a generic word, a
 * whole sentence, a lone period, the literal word "Wikipedia"). We don't re-resolve
 * anything; we just remove the <a> wrapper and keep the visible text, but ONLY when
 * the link's href and anchor text match the expected target exactly (a safety gate,
 * so an edit elsewhere can't make us strip the wrong link).
 *
 * Usage:
 *   bun run scripts/news-agent/unlink-junk-links.ts                # DRY RUN (prod via tunnel)
 *   bun run scripts/news-agent/unlink-junk-links.ts --write --yes   # apply (PROD)
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getConnection } from '../lib/db';

const argv = process.argv;
const has = (f: string) => argv.includes(f);
const IS_LOCAL = has('--local') || process.env.MYSQL_LOCAL === '1';
const WRITE = has('--write');
const YES = has('--yes');

/** Each target: the post, a substring uniquely identifying the link's href, and the
 *  exact anchor text we expect (verified before we touch anything). */
const TARGETS: { id: number; hrefIncludes: string; anchor: string }[] = [
  { id: 71,  hrefIncludes: '/wiki/LGBT_Olympians',                        anchor: 'Wikipedia' },
  { id: 66,  hrefIncludes: '/wiki/Motivation',                           anchor: 'impetus' },
  { id: 60,  hrefIncludes: '/wiki/Conventional_sex',                     anchor: 'vanilla sex' },
  { id: 128, hrefIncludes: '/wiki/Recognition_of_same-sex_unions_in_the_Americas', anchor: 'This makes Ecuador the 5th country in South America' },
  { id: 128, hrefIncludes: '/wiki/LGBT_rights_in_Paraguay',             anchor: '.' },
  { id: 22,  hrefIncludes: '/wiki/Recognition_of_same-sex_unions_in_Italy', anchor: 'lawmakers in Italy' },
];

const LINK_RE = /<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis;

async function main() {
  console.log('\n── News Agent · unlink junk links ──\n');
  if (WRITE && !IS_LOCAL && !YES) { console.error('⛔ Writing to PROD. Re-run with --write --yes.\n'); process.exit(1); }
  console.log(`Mode: ${WRITE ? (IS_LOCAL ? 'WRITE (local)' : 'WRITE (PROD)') : 'DRY RUN'}\n`);

  const db = await getConnection();

  // Group targets by post so we rewrite each post's content once.
  const byPost = new Map<number, typeof TARGETS>();
  for (const t of TARGETS) (byPost.get(t.id) ?? byPost.set(t.id, []).get(t.id)!).push(t);

  let removed = 0, missed = 0, written = 0;
  for (const [id, targets] of byPost) {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT post_content FROM wp_posts WHERE ID = ?`, [id]);
    if (!rows.length) { console.log(`#${id} — post not found`); continue; }
    let content = String(rows[0].post_content || '');
    let postChanged = false;

    for (const t of targets) {
      // Find the <a> whose href contains the expected slug AND whose text matches.
      let found: string | null = null;
      let m: RegExpExecArray | null;
      LINK_RE.lastIndex = 0;
      while ((m = LINK_RE.exec(content)) !== null) {
        const href = m[1];
        const text = m[2].replace(/<[^>]+>/g, '').trim();
        if (href.includes(t.hrefIncludes) && text === t.anchor) { found = m[0]; break; }
      }
      if (!found) {
        missed++;
        console.log(`  ✗ #${id} "${t.anchor}" — not found (already fixed?) [${t.hrefIncludes}]`);
        continue;
      }
      // Replace the <a>…</a> with just its inner text (unlink).
      const inner = found.replace(/^<a\s[^>]*>/i, '').replace(/<\/a>$/i, '');
      content = content.replace(found, inner);
      postChanged = true;
      removed++;
      console.log(`  ✂ #${id} unlink "${t.anchor}"  (${t.hrefIncludes})`);
    }

    if (WRITE && postChanged) {
      await db.execute(`UPDATE wp_posts SET post_content = ? WHERE ID = ?`, [content, id]);
      written++;
      console.log(`     ✓ #${id} written`);
    }
  }

  await db.end();
  console.log(`\nDone. ${removed} link(s) ${WRITE ? 'unlinked' : 'would unlink'}, ${missed} not found.${WRITE ? ` ${written} post(s) written.` : ''}`);
  if (WRITE && !IS_LOCAL && written) console.log('⚠ Prod write — run `wp cache flush` on the server so WPGraphQL serves the new bodies.');
}

main().catch((e) => { console.error('\nFatal:', e); process.exit(1); });
