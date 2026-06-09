/**
 * Fix the category-rule violation: skin-tone names (vanilla/chocolate/caramel/…)
 * carried as pa_FLAVOR on NON-lube/condom products are really pa_COLOR (skin tones).
 * Move them to pa_color. Per-product:
 *   - pure skin-tone flavor axis  -> rename variation axis attribute_pa_flavor->attribute_pa_color,
 *     repoint rels, rewrite _product_attributes blob (s:9:"pa_flavor"->s:8:"pa_color")
 *   - skin-tone flavor TAG (not an axis) -> just repoint the term relationship
 *   - MIXED (real flavor + skin-tone on one axis) -> DEFER (logged)
 * Only touches products where the category forbids flavor (isDimAllowed).
 *
 * Usage: bun run scripts/gen-fix-skintone-sql.ts  -> scripts/migrate-fix-skintone.sql + review json
 */
import { getConnection } from './lib/db';
import { isDimAllowed } from './lib/attribute-rules';
import { writeFileSync } from 'fs';

const q = (s: string) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const SKIN = new Set(['vanilla', 'caramel', 'chocolate', 'mocha', 'flesh', 'tan', 'beige', 'nude', 'ivory', 'brown']);
const NAME: Record<string, string> = { vanilla: 'Vanilla', caramel: 'Caramel', chocolate: 'Chocolate', mocha: 'Mocha', flesh: 'Flesh', tan: 'Tan', beige: 'Beige', nude: 'Nude', ivory: 'Ivory', brown: 'Brown' };

async function main() {
  const db = await getConnection();

  // pa_flavor skin-tone terms
  const [flavorTerms] = await db.query<any[]>(`SELECT t.term_id, t.slug, tt.term_taxonomy_id ttid FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy='pa_flavor'`);
  const skinFlavorTT = new Map<string, { ttid: number; term_id: number }>(); // slug -> {ttid, term_id}
  for (const r of flavorTerms as any[]) if (SKIN.has(r.slug)) skinFlavorTT.set(r.slug, { ttid: r.ttid, term_id: r.term_id });
  const skinTTs = [...skinFlavorTT.values()].map((x) => x.ttid);
  if (!skinTTs.length) { console.log('no skin-tone flavor terms'); await db.end(); return; }

  // existing pa_color terms (reuse) for skin-tone slugs
  const [colorTerms] = await db.query<any[]>(`SELECT t.slug, tt.term_taxonomy_id ttid FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy='pa_color'`);
  const colorTT = new Map<string, number>(); for (const r of colorTerms as any[]) colorTT.set(r.slug, r.ttid);

  // products carrying a skin-tone flavor + their categories + flavor axis values
  const [prods] = await db.query<any[]>(
    `SELECT DISTINCT r.object_id pid FROM wp_term_relationships r WHERE r.term_taxonomy_id IN (${skinTTs.join(',')})`);
  const pids = (prods as any[]).map((r) => r.pid);
  const [cats] = await db.query<any[]>(`SELECT cr.object_id pid, t.slug FROM wp_term_relationships cr JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id=cr.term_taxonomy_id AND tt.taxonomy='product_cat' JOIN wp_terms t ON t.term_id=tt.term_id WHERE cr.object_id IN (${pids.join(',')})`);
  const catBy = new Map<number, string[]>(); for (const r of cats as any[]) (catBy.get(r.pid) || catBy.set(r.pid, []).get(r.pid)!).push(r.slug);
  // each product's pa_flavor variation values
  const [vars] = await db.query<any[]>(`SELECT p.post_parent parent, pm.meta_value slug FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation' WHERE pm.meta_key='attribute_pa_flavor' AND pm.meta_value<>'' AND p.post_parent IN (${pids.join(',')})`);
  const flavorAxis = new Map<number, Set<string>>(); for (const v of vars as any[]) (flavorAxis.get(v.parent) || flavorAxis.set(v.parent, new Set()).get(v.parent)!).add(v.slug);

  const pureParents: number[] = [], tagOnly: number[] = [];
  const mixedReview: any[] = [];
  for (const pid of pids) {
    if (isDimAllowed('flavor', catBy.get(pid) || [])) continue; // flavor legit here — skip
    const axis = flavorAxis.get(pid);
    if (!axis) { tagOnly.push(pid); continue; } // skin-tone is only a tag, not a variation axis
    const allSkin = [...axis].every((s) => SKIN.has(s));
    if (allSkin) pureParents.push(pid);
    else mixedReview.push({ pid, values: [...axis] });
  }

  const sql: string[] = ['SET autocommit=0;', 'START TRANSACTION;', ''];
  // ensure pa_color terms exist for all skin-tone slugs in play
  const created = new Map<string, string>(); let cf = 0;
  const colorExpr = (slug: string) => colorTT.has(slug) ? String(colorTT.get(slug)) : created.get(slug)!;
  const ensureColor = (slug: string) => { if (colorTT.has(slug) || created.has(slug)) return; cf++; sql.push(`INSERT INTO wp_terms (name, slug, term_group) VALUES (${q(NAME[slug] || slug)}, ${q(slug)}, 0);`); sql.push(`SET @c${cf} := LAST_INSERT_ID();`); sql.push(`INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (@c${cf}, 'pa_color', '', 0, 0);`); sql.push(`SET @ct${cf} := LAST_INSERT_ID();`); created.set(slug, `@ct${cf}`); };
  for (const slug of skinFlavorTT.keys()) ensureColor(slug);

  // PURE axis products: repoint rels + rename variation meta_key + rewrite blob
  sql.push('', '-- pure skin-tone flavor-axis products -> pa_color axis');
  for (const slug of skinFlavorTT.keys()) {
    const srcTT = skinFlavorTT.get(slug)!.ttid;
    if (pureParents.length) {
      sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) SELECT object_id, ${colorExpr(slug)}, 0 FROM wp_term_relationships WHERE term_taxonomy_id=${srcTT} AND object_id IN (${pureParents.join(',')});`);
      sql.push(`DELETE FROM wp_term_relationships WHERE term_taxonomy_id=${srcTT} AND object_id IN (${pureParents.join(',')});`);
    }
  }
  for (let i = 0; i < pureParents.length; i += 400) {
    const chunk = pureParents.slice(i, i + 400);
    sql.push(`UPDATE wp_postmeta SET meta_key='attribute_pa_color' WHERE meta_key='attribute_pa_flavor' AND post_id IN (SELECT ID FROM wp_posts WHERE post_type='product_variation' AND post_parent IN (${chunk.join(',')}));`);
    sql.push(`UPDATE wp_postmeta SET meta_value=REPLACE(meta_value,'s:9:"pa_flavor"','s:8:"pa_color"') WHERE post_id IN (${chunk.join(',')}) AND meta_key IN ('_product_attributes','_default_attributes') AND meta_value LIKE '%pa_flavor%';`);
  }

  // TAG-only products: just repoint the relationship
  sql.push('', '-- skin-tone flavor tags (non-axis) -> repoint relationship to pa_color');
  for (const slug of skinFlavorTT.keys()) {
    const srcTT = skinFlavorTT.get(slug)!.ttid;
    if (tagOnly.length) {
      sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) SELECT object_id, ${colorExpr(slug)}, 0 FROM wp_term_relationships WHERE term_taxonomy_id=${srcTT} AND object_id IN (${tagOnly.join(',')});`);
      sql.push(`DELETE FROM wp_term_relationships WHERE term_taxonomy_id=${srcTT} AND object_id IN (${tagOnly.join(',')});`);
    }
  }

  // delete now-emptied skin-tone pa_flavor terms
  sql.push('', '-- delete emptied skin-tone pa_flavor terms');
  const flavorTermIds = [...skinFlavorTT.values()].map((x) => x.term_id);
  sql.push(`DELETE tt FROM wp_term_taxonomy tt WHERE tt.taxonomy='pa_flavor' AND tt.term_id IN (${flavorTermIds.join(',')}) AND NOT EXISTS (SELECT 1 FROM wp_term_relationships r WHERE r.term_taxonomy_id=tt.term_taxonomy_id);`);
  sql.push(`DELETE FROM wp_terms WHERE term_id IN (${flavorTermIds.join(',')}) AND term_id NOT IN (SELECT term_id FROM wp_term_taxonomy);`);

  sql.push('', `UPDATE wp_term_taxonomy tt SET count=(SELECT COUNT(*) FROM wp_term_relationships tr WHERE tr.term_taxonomy_id=tt.term_taxonomy_id) WHERE tt.taxonomy IN ('pa_flavor','pa_color');`);
  sql.push('COMMIT;');
  writeFileSync('scripts/migrate-fix-skintone.sql', sql.join('\n') + '\n');
  writeFileSync('scripts/skintone-mixed-review.json', JSON.stringify(mixedReview, null, 2));
  console.log(`Wrote scripts/migrate-fix-skintone.sql`);
  console.log(`  pure flavor-axis products -> pa_color: ${pureParents.length}`);
  console.log(`  tag-only products repointed: ${tagOnly.length}`);
  console.log(`  MIXED (deferred to review): ${mixedReview.length}`);
  console.log(`  pa_color terms created: ${cf}`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
