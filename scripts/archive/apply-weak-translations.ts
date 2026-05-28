/**
 * Apply selected translation pairs / groups into `_maleq_translations` meta.
 *
 * Two input modes:
 *
 *   1. --indices=0,2,3,4
 *        Read from scripts/output/translation-proposals.json → weak[] and
 *        apply those weak-suggestion pairs.
 *
 *   2. --manual=path/to/groups.json
 *        Read an explicit list of groups; each group is an array of post IDs
 *        that should all be mutually linked as translations of each other:
 *          { "groups": [[296, 268, 216], [288, 138], ...] }
 *        Groups of 2 are pairs; groups of 3+ create N-way symmetric links.
 *
 * Unlike the auto-apply path in `backfill-post-translations.ts` (which DELETEs
 * the existing CSV and re-INSERTs it), this helper *merges* new partner IDs
 * into any existing translations CSV on either side. That keeps prior linkages
 * intact when a new group overlaps with an existing one.
 *
 * Usage:
 *   bun run scripts/apply-weak-translations.ts --indices=0,2,3,4
 *   bun run scripts/apply-weak-translations.ts --indices=0,2,3,4 --apply --force-remote
 *   bun run scripts/apply-weak-translations.ts --manual=scripts/input/lube-pairs.json --apply --force-remote
 *
 * Safety:
 *   - `--apply` against prod requires `--force-remote` AND a fresh DB backup
 *     (see CLAUDE.md "Database Backup Policy").
 *   - After applying, run on prod: `wp cache flush`
 *
 * The mu-plugin's symmetric-save handler does NOT fire on raw SQL writes, so
 * we explicitly write every side of every group.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConnection } from './lib/db';
import type { RowDataPacket } from 'mysql2';

const TRANSLATIONS_META = '_maleq_translations';
const APPLY = process.argv.includes('--apply');
const FORCE_REMOTE = process.argv.includes('--force-remote');
const IS_LOCAL = process.argv.includes('--local') || process.env.MYSQL_LOCAL === '1';

function parseIndices(): number[] | null {
  const flag = process.argv.find((a) => a.startsWith('--indices='));
  if (!flag) return null;
  return flag
    .slice('--indices='.length)
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

interface WeakPair {
  a: { id: number; locale: string; title: string; slug: string };
  b: { id: number; locale: string; title: string; slug: string };
  sharedTokens?: string[];
}

interface ProposalsFile {
  generatedAt: string;
  weak: WeakPair[];
}

function parseCsv(value: string | null | undefined): number[] {
  if (!value) return [];
  const out: number[] = [];
  for (const part of value.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

async function main() {
  if (APPLY && !IS_LOCAL && !FORCE_REMOTE) {
    console.error(
      '\n✋ Refusing to --apply against prod without --force-remote.\n' +
        '   Take a fresh DB backup first (see CLAUDE.md), then add --force-remote.\n',
    );
    process.exit(1);
  }

  // Build the list of groups (post ID arrays). Both input modes funnel into
  // the same downstream merge logic.
  const manualFlag = process.argv.find((a) => a.startsWith('--manual='));
  const groups: number[][] = [];

  if (manualFlag) {
    const manualPath = manualFlag.slice('--manual='.length);
    const data = JSON.parse(readFileSync(manualPath, 'utf-8')) as { groups?: number[][] };
    if (!Array.isArray(data.groups)) {
      console.error(`Manual file ${manualPath} must have a "groups" array.`);
      process.exit(1);
    }
    for (const g of data.groups) {
      if (Array.isArray(g) && g.length >= 2 && g.every((n) => typeof n === 'number' && n > 0)) {
        groups.push(g);
      }
    }
    console.log(`\nLoaded ${groups.length} manual group(s) from ${manualPath}:`);
    for (const g of groups) {
      console.log(`  [${g.join(', ')}]`);
    }
  } else {
    const proposals: ProposalsFile = JSON.parse(
      readFileSync(join(import.meta.dir, 'output', 'translation-proposals.json'), 'utf-8'),
    );
    const indices = parseIndices();
    const pairs: { idx: number; pair: WeakPair }[] = (indices ?? proposals.weak.map((_, i) => i))
      .filter((i) => i < proposals.weak.length)
      .map((i) => ({ idx: i, pair: proposals.weak[i] }));

    if (pairs.length === 0) {
      console.log('No weak pairs to apply.');
      return;
    }
    console.log(
      `\nSelected ${pairs.length} weak pair(s) ${indices ? `(indices ${indices.join(',')})` : '(all)'}:`,
    );
    for (const { idx, pair } of pairs) {
      console.log(
        `  weak[${idx}] ` +
          `[${pair.a.locale}#${pair.a.id} ${pair.a.title.slice(0, 38)}]  ↔  ` +
          `[${pair.b.locale}#${pair.b.id} ${pair.b.title.slice(0, 38)}]`,
      );
      groups.push([pair.a.id, pair.b.id]);
    }
  }

  if (groups.length === 0) {
    console.log('No groups to apply.');
    return;
  }

  const db = await getConnection();

  // Collect every endpoint ID and read its current translations CSV in one batch.
  const endpointIds = Array.from(new Set(groups.flat()));
  const placeholders = endpointIds.map(() => '?').join(',');
  const [rows] = await db.query<(RowDataPacket & { post_id: number; meta_value: string | null })[]>(
    `SELECT post_id, meta_value
       FROM wp_postmeta
      WHERE meta_key = ? AND post_id IN (${placeholders})`,
    [TRANSLATIONS_META, ...endpointIds],
  );
  const existingByPost = new Map<number, number[]>();
  for (const id of endpointIds) existingByPost.set(id, []);
  for (const row of rows) existingByPost.set(row.post_id, parseCsv(row.meta_value));

  // Compute the merged CSV per endpoint (apply ALL groups in one pass).
  // For each group of N posts, every member gets the other N-1 members added.
  const newByPost = new Map<number, number[]>(existingByPost);
  for (const group of groups) {
    for (const self of group) {
      const partners = group.filter((id) => id !== self);
      const current = newByPost.get(self) ?? [];
      const merged = [...current];
      for (const partner of partners) {
        if (!merged.includes(partner)) merged.push(partner);
      }
      newByPost.set(self, merged);
    }
  }

  // Show the diff.
  console.log('\n── Planned writes ──');
  let actualChanges = 0;
  for (const id of endpointIds) {
    const before = existingByPost.get(id) ?? [];
    const after = newByPost.get(id) ?? [];
    if (before.length === after.length && before.every((v, i) => v === after[i])) {
      console.log(`  post ${id}: unchanged (${before.join(',') || '∅'})`);
      continue;
    }
    actualChanges++;
    console.log(`  post ${id}: ${before.join(',') || '∅'}  →  ${after.join(',')}`);
  }

  if (!APPLY) {
    console.log(`\nDry-run. ${actualChanges} row(s) would be written. Re-run with --apply --force-remote to write.`);
    await db.end();
    return;
  }

  console.log(`\n✏️  Writing ${actualChanges} row(s) to ${IS_LOCAL ? 'LOCAL' : 'REMOTE'}...`);
  for (const id of endpointIds) {
    const before = existingByPost.get(id) ?? [];
    const after = newByPost.get(id) ?? [];
    if (before.length === after.length && before.every((v, i) => v === after[i])) continue;
    const csv = after.join(',');
    if (before.length === 0) {
      await db.query(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
        [id, TRANSLATIONS_META, csv],
      );
    } else {
      await db.query(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = ?`,
        [csv, id, TRANSLATIONS_META],
      );
    }
  }
  console.log(`✅ Done. Remember to run \`wp cache flush\` on prod so Redis reloads the new meta.`);
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
