/**
 * Safe DB sweep — remove dead weight with no functional impact:
 *   - orphan term_relationships (term_taxonomy_id no longer exists)
 *   - orphan term_taxonomy rows (no wp_terms row)
 *   - dead terms (0 product-relationships) in attribute/brand/cat taxonomies,
 *     GUARDED: never delete a term whose slug is still used by a variation
 *     postmeta value (attribute_<tax>=slug), nor a term shared with another taxonomy.
 *
 * Usage: bun run scripts/gen-attr-sweep-sql.ts   # PROD via tunnel -> scripts/migrate-attr-sweep.sql
 */
import { getConnection } from './lib/db';
import { writeFileSync } from 'fs';

const TAXONOMIES = ['pa_style', 'pa_variant', 'pa_flavor', 'pa_volume', 'pa_color', 'pa_size', 'pa_length', 'product_brand', 'product_cat'];

async function main() {
  const db = await getConnection();

  // dead terms (0 rels) in target taxonomies, with slug + taxonomy
  const [dead] = await db.query<any[]>(
    `SELECT t.term_id, t.slug, tt.taxonomy, tt.term_taxonomy_id ttid
       FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id
      WHERE tt.taxonomy IN (${TAXONOMIES.map((x) => `'${x}'`).join(',')})
        AND NOT EXISTS (SELECT 1 FROM wp_term_relationships r WHERE r.term_taxonomy_id=tt.term_taxonomy_id)`);

  // variation postmeta values per pa_* taxonomy (guard: keep terms still used as a variation value)
  const usedByVar = new Set<string>(); // "tax|slug"
  const [varVals] = await db.query<any[]>(
    `SELECT DISTINCT meta_key, meta_value FROM wp_postmeta WHERE meta_key LIKE 'attribute\\_pa\\_%' AND meta_value<>''`);
  for (const r of varVals as any[]) usedByVar.add(`${r.meta_key.replace('attribute_', '')}|${r.meta_value}`);

  // term_ids that appear in MORE than one taxonomy (don't hard-delete the shared term row)
  const deadTermIds = (dead as any[]).map((r) => r.term_id);
  const sharedTermIds = new Set<number>();
  if (deadTermIds.length) {
    const [shared] = await db.query<any[]>(
      `SELECT term_id, COUNT(*) c FROM wp_term_taxonomy WHERE term_id IN (${deadTermIds.join(',')}) GROUP BY term_id HAVING c>1`);
    for (const r of shared as any[]) sharedTermIds.add(r.term_id);
  }

  const ttToDelete: number[] = [];     // term_taxonomy rows to drop
  const termToDelete: number[] = [];   // wp_terms rows to drop (only if not shared)
  let keptVar = 0;
  for (const r of dead as any[]) {
    if (usedByVar.has(`${r.taxonomy}|${r.slug}`)) { keptVar++; continue; } // still a live variation value
    ttToDelete.push(r.ttid);
    if (!sharedTermIds.has(r.term_id)) termToDelete.push(r.term_id);
  }

  // orphan term_taxonomy (no wp_terms)
  const [orphTT] = await db.query<any[]>(
    `SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt LEFT JOIN wp_terms t ON t.term_id=tt.term_id WHERE t.term_id IS NULL`);
  const orphTTids = (orphTT as any[]).map((r) => r.term_taxonomy_id);

  const sql: string[] = ['SET autocommit=0;', 'START TRANSACTION;', ''];

  // 1. drop dead-term taxonomy rows + their (now-removed) relationships
  sql.push('-- drop dead-term term_taxonomy rows');
  for (let i = 0; i < ttToDelete.length; i += 1000) sql.push(`DELETE FROM wp_term_taxonomy WHERE term_taxonomy_id IN (${ttToDelete.slice(i, i + 1000).join(',')});`);
  sql.push('-- drop dead wp_terms rows (only those not shared with another taxonomy)');
  for (let i = 0; i < termToDelete.length; i += 1000) sql.push(`DELETE FROM wp_terms WHERE term_id IN (${termToDelete.slice(i, i + 1000).join(',')}) AND term_id NOT IN (SELECT term_id FROM wp_term_taxonomy);`);
  sql.push('-- drop termmeta for deleted terms');
  for (let i = 0; i < termToDelete.length; i += 1000) sql.push(`DELETE FROM wp_termmeta WHERE term_id IN (${termToDelete.slice(i, i + 1000).join(',')});`);

  // 2. drop orphan term_taxonomy rows (no term)
  sql.push('', '-- drop orphan term_taxonomy rows (no wp_terms)');
  if (orphTTids.length) for (let i = 0; i < orphTTids.length; i += 1000) sql.push(`DELETE FROM wp_term_taxonomy WHERE term_taxonomy_id IN (${orphTTids.slice(i, i + 1000).join(',')});`);

  // 3. delete ALL orphan term_relationships (tt no longer exists) — pre-existing cruft + newly orphaned
  sql.push('', '-- delete orphan term_relationships (term_taxonomy_id missing)');
  sql.push(`DELETE r FROM wp_term_relationships r LEFT JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id=r.term_taxonomy_id WHERE tt.term_taxonomy_id IS NULL;`);

  sql.push('', 'COMMIT;');
  sql.push(`SELECT CONCAT('orphan rels now: ', COUNT(*)) result FROM wp_term_relationships r LEFT JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id=r.term_taxonomy_id WHERE tt.term_taxonomy_id IS NULL;`);

  writeFileSync('scripts/migrate-attr-sweep.sql', sql.join('\n') + '\n');
  console.log('Wrote scripts/migrate-attr-sweep.sql');
  console.log(`  dead terms found: ${dead.length}`);
  console.log(`  -> tt rows dropped: ${ttToDelete.length}, term rows dropped: ${termToDelete.length}`);
  console.log(`  kept (still a live variation value): ${keptVar}`);
  console.log(`  shared-term rows preserved: ${sharedTermIds.size}`);
  console.log(`  orphan term_taxonomy dropped: ${orphTTids.length}`);
  console.log(`  statements: ${sql.filter((s) => s.trim().endsWith(';')).length}`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
