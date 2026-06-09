/**
 * Generate SQL to fix the "color used as size/flavor variation axis" leftovers.
 * Auto-fixes ONLY safe buckets:
 *   pureSize   -> rename variation attribute_pa_color->attribute_pa_size + _product_attributes pa_color->pa_size
 *   flavorOnly -> rename to attribute_pa_flavor + _product_attributes pa_color->pa_flavor
 * Everything else (mixed / has-existing-pa_size / junk / other) is written to a
 * manual-review report and left untouched.
 *
 * Output: scripts/migrate-axis.sql, scripts/axis-manual-review.json
 * Usage: bun run scripts/gen-axis-sql.ts          # reads PROD (tunnel)
 *        bun run scripts/gen-axis-sql.ts --local
 */
import { getConnection } from './lib/db';
import map from './color-cleanup-map.generated.json';
import { writeFileSync } from 'fs';

type Mapping = { slug: string; action: string; taxonomy?: string };
const mappings = map as Mapping[];
const sizeSlugs = new Set(mappings.filter((m) => m.action === 'MOVE' && (m.taxonomy || 'pa_size') === 'pa_size').map((m) => m.slug));
const flavorSlugs = new Set(mappings.filter((m) => m.action === 'MOVE' && m.taxonomy === 'pa_flavor').map((m) => m.slug));
const junkSlugs = new Set(mappings.filter((m) => m.action === 'DELETE').map((m) => m.slug));
const cat = (v: string) => sizeSlugs.has(v) ? 'size' : flavorSlugs.has(v) ? 'flavor' : junkSlugs.has(v) ? 'junk' : 'color';

async function main() {
  const db = await getConnection();
  const [rows] = await db.query<any[]>(
    `SELECT p.post_parent, pm.meta_value FROM wp_postmeta pm
     JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation' WHERE pm.meta_key='attribute_pa_color'`);
  const [sizeAxis] = await db.query<any[]>(
    `SELECT DISTINCT p.post_parent FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation' WHERE pm.meta_key='attribute_pa_size'`);
  const hasSizeAxis = new Set<number>((sizeAxis as any[]).map((r) => r.post_parent));

  const valsByParent = new Map<number, Set<string>>();
  for (const r of rows as any[]) (valsByParent.get(r.post_parent) || valsByParent.set(r.post_parent, new Set()).get(r.post_parent)!).add(r.meta_value);

  const pureSize: number[] = [], flavorOnly: number[] = [];
  const manual: { parent: number; bucket: string; values: string[] }[] = [];
  for (const [parent, vals] of valsByParent) {
    const cats = new Set([...vals].map(cat));
    const has = (c: string) => cats.has(c);
    if (!has('size') && !has('flavor') && !has('junk')) continue; // colorOnly - already clean
    if (has('color')) { manual.push({ parent, bucket: 'mixed', values: [...vals] }); continue; }
    if (has('size') && !has('flavor') && !has('junk')) {
      if (hasSizeAxis.has(parent)) manual.push({ parent, bucket: 'hasExistingPaSize', values: [...vals] });
      else pureSize.push(parent);
    } else if (has('flavor') && !has('size') && !has('junk')) {
      flavorOnly.push(parent);
    } else if (has('junk') && !has('size') && !has('flavor')) {
      manual.push({ parent, bucket: 'junkOnly', values: [...vals] });
    } else {
      manual.push({ parent, bucket: 'other', values: [...vals] });
    }
  }

  // enrich manual report with titles
  for (const m of manual) {
    const [t] = await db.query<any[]>(`SELECT post_title FROM wp_posts WHERE ID=?`, [m.parent]);
    (m as any).title = t[0]?.post_title || null;
  }
  writeFileSync('scripts/axis-manual-review.json', JSON.stringify(manual, null, 2));

  // build SQL
  const sql: string[] = ['SET autocommit=0;', 'START TRANSACTION;', ''];
  if (pureSize.length) {
    sql.push('-- pure-size axis -> pa_size');
    sql.push(`UPDATE wp_postmeta pm JOIN wp_posts c ON c.ID=pm.post_id AND c.post_type='product_variation'
  SET pm.meta_key='attribute_pa_size'
  WHERE c.post_parent IN (${pureSize.join(',')}) AND pm.meta_key='attribute_pa_color';`);
    sql.push(`UPDATE wp_postmeta SET meta_value=REPLACE(meta_value,'s:8:"pa_color"','s:7:"pa_size"')
  WHERE post_id IN (${pureSize.join(',')}) AND meta_key='_product_attributes';`);
    sql.push('');
  }
  if (flavorOnly.length) {
    sql.push('-- flavor axis -> pa_flavor');
    sql.push(`UPDATE wp_postmeta pm JOIN wp_posts c ON c.ID=pm.post_id AND c.post_type='product_variation'
  SET pm.meta_key='attribute_pa_flavor'
  WHERE c.post_parent IN (${flavorOnly.join(',')}) AND pm.meta_key='attribute_pa_color';`);
    sql.push(`UPDATE wp_postmeta SET meta_value=REPLACE(meta_value,'s:8:"pa_color"','s:9:"pa_flavor"')
  WHERE post_id IN (${flavorOnly.join(',')}) AND meta_key='_product_attributes';`);
    sql.push('');
  }
  sql.push('COMMIT;');
  sql.push(`SELECT CONCAT('variations still on attribute_pa_color: ', COUNT(*)) AS r FROM wp_postmeta WHERE meta_key='attribute_pa_color';`);
  writeFileSync('scripts/migrate-axis.sql', sql.join('\n') + '\n');

  console.log(`pureSize parents (->pa_size): ${pureSize.length}`);
  console.log(`flavorOnly parents (->pa_flavor): ${flavorOnly.length}`);
  console.log(`manual-review parents: ${manual.length}`);
  const byBucket: Record<string, number> = {};
  for (const m of manual) byBucket[m.bucket] = (byBucket[m.bucket] || 0) + 1;
  console.log('  manual buckets:', byBucket);
  console.log('Wrote scripts/migrate-axis.sql and scripts/axis-manual-review.json');
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
