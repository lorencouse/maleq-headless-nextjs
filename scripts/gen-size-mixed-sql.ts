/**
 * Resolve the 73 DEFERRED mixed-axis products by committing each one's WHOLE
 * pa_size variation axis to a single taxonomy chosen by the product's CATEGORY:
 *   volume category (lube/cream/oil/spray/douche/…) -> pa_volume
 *   toy category    (dildo/anal/cock/plug/vibe/…)   -> pa_length
 *   apparel/lingerie or ambiguous                   -> LEFT on pa_size (no-op)
 *
 * Full per-product axis migration (same mechanics as gen-size-split-sql.ts):
 * create target terms for every value, repoint rels, rename variation meta_key,
 * rewrite _product_attributes/_default_attributes blob, delete emptied terms.
 * Stray off-dim junk values (e.g. a "king" on a length product) ride along into
 * the target taxonomy — pre-existing data errors, contained to that product.
 *
 * Usage: bun run scripts/gen-size-mixed-sql.ts   # PROD via tunnel -> scripts/migrate-size-mixed.sql
 */
import { getConnection } from './lib/db';
import mixed from './size-split-mixed-review.json';
import { writeFileSync } from 'fs';

const q = (s: string) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const VOLUME_CAT = /lube|lubric|cleaner|clean|oil|cream|lotion|spray|hygiene|douche|enema|moistur|masturbation|gel|flavored/i;
const APPAREL_CAT = /lingerie|clothing|costume|apparel|underwear|bodystocking|panty|panties|thong|jock|bra-|halloween/i;
const LENGTH_CAT = /dildo|dong|anal|butt-plug|cock|dilator|extension|sleeve|sound|plug|vibrat|masturbator|stroker|prostate|ring|bullet|egg|wand|clit/i;

function targetTax(cats: string[], dims: string[]): 'pa_volume' | 'pa_length' | null {
  if (!dims.includes('volume') && !dims.includes('length')) return null; // nothing to split
  if (cats.some((c) => VOLUME_CAT.test(c))) return 'pa_volume';
  if (cats.some((c) => APPAREL_CAT.test(c))) return null;  // apparel product -> stays pa_size
  if (cats.some((c) => LENGTH_CAT.test(c))) return 'pa_length';
  return null; // ambiguous -> leave
}

async function main() {
  const db = await getConnection();
  const parentIds = (mixed as any[]).map((m) => m.parent);

  // categories per parent
  const [catRows] = await db.query<any[]>(
    `SELECT p.ID, GROUP_CONCAT(DISTINCT ct.slug) cats FROM wp_posts p
       LEFT JOIN wp_term_relationships cr ON cr.object_id=p.ID
       LEFT JOIN wp_term_taxonomy ctt ON ctt.term_taxonomy_id=cr.term_taxonomy_id AND ctt.taxonomy='product_cat'
       LEFT JOIN wp_terms ct ON ct.term_id=ctt.term_id WHERE p.ID IN (${parentIds.join(',')}) GROUP BY p.ID`);
  const catById = new Map<number, string[]>();
  for (const r of catRows as any[]) catById.set(r.ID, (r.cats || '').split(',').filter(Boolean));

  // target per parent
  const parentTarget = new Map<number, 'pa_volume' | 'pa_length'>();
  for (const m of mixed as any[]) {
    const t = targetTax(catById.get(m.parent) || [], m.dims);
    if (t) parentTarget.set(m.parent, t);
  }
  const targetParents = [...parentTarget.keys()];
  console.log(`resolving ${targetParents.length} of ${parentIds.length} mixed products`);

  // pa_size terms (slug -> {name, term_id, ttid})
  const [sizeTerms] = await db.query<any[]>(
    `SELECT t.term_id, t.name, t.slug, tt.term_taxonomy_id ttid FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy='pa_size'`);
  const bySlug = new Map<string, { term_id: number; name: string; ttid: number }>();
  for (const r of sizeTerms as any[]) bySlug.set(r.slug, { term_id: r.term_id, name: r.name, ttid: r.ttid });

  // existing pa_volume/pa_length terms (reuse if present)
  const [tgtTerms] = await db.query<any[]>(
    `SELECT t.slug, tt.taxonomy, tt.term_taxonomy_id ttid FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy IN ('pa_volume','pa_length')`);
  const tgtBySlug = new Map<string, number>(); // "tax|slug" -> ttid
  for (const r of tgtTerms as any[]) tgtBySlug.set(`${r.taxonomy}|${r.slug}`, r.ttid);

  // variation values for target parents
  const [varRows] = await db.query<any[]>(
    `SELECT p.post_parent parent, pm.meta_value slug FROM wp_postmeta pm
       JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation'
      WHERE pm.meta_key='attribute_pa_size' AND p.post_parent IN (${targetParents.join(',')}) AND pm.meta_value<>''`);
  const parentValues = new Map<number, Set<string>>();
  for (const v of varRows as any[]) (parentValues.get(v.parent) || parentValues.set(v.parent, new Set()).get(v.parent)!).add(v.slug);

  // pa_size relationships for target parents
  const sizeTTs = (sizeTerms as any[]).map((r) => r.ttid);
  const [relRows] = await db.query<any[]>(
    `SELECT object_id, term_taxonomy_id FROM wp_term_relationships WHERE object_id IN (${targetParents.join(',')}) AND term_taxonomy_id IN (${sizeTTs.join(',')})`);
  const ttidToSlug = new Map<number, string>(); for (const r of sizeTerms as any[]) ttidToSlug.set(r.ttid, r.slug);
  const parentRelSlugs = new Map<number, Set<string>>();
  for (const r of relRows as any[]) { const s = ttidToSlug.get(r.term_taxonomy_id); if (s) (parentRelSlugs.get(r.object_id) || parentRelSlugs.set(r.object_id, new Set()).get(r.object_id)!).add(s); }

  // ---- build SQL ----
  const sql: string[] = ['SET autocommit=0;', 'START TRANSACTION;', ''];
  // create needed target terms (union of variation + rel slugs per parent)
  const needTarget = new Map<string, string>(); // "tax|slug" -> name
  for (const [parent, tax] of parentTarget) {
    const slugs = new Set<string>([...(parentValues.get(parent) || []), ...(parentRelSlugs.get(parent) || [])]);
    for (const slug of slugs) {
      const key = `${tax}|${slug}`;
      if (!tgtBySlug.has(key)) needTarget.set(key, bySlug.get(slug)?.name || slug.replace(/-/g, ' '));
    }
  }
  sql.push('-- create target pa_volume/pa_length terms');
  const createdVar = new Map<string, string>(); let ct = 0;
  for (const [key, name] of needTarget) {
    const [tax] = key.split('|'); const slug = key.slice(tax.length + 1);
    ct++;
    sql.push(`INSERT INTO wp_terms (name, slug, term_group) VALUES (${q(name)}, ${q(slug)}, 0);`);
    sql.push(`SET @m${ct} := LAST_INSERT_ID();`);
    sql.push(`INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (@m${ct}, ${q(tax)}, '', 0, 0);`);
    sql.push(`SET @mt${ct} := LAST_INSERT_ID();`);
    createdVar.set(key, `@mt${ct}`);
  }
  const ttExpr = (tax: string, slug: string) => createdVar.get(`${tax}|${slug}`) ?? String(tgtBySlug.get(`${tax}|${slug}`));

  // repoint relationships + rename variation meta + rewrite blob, grouped by target tax
  sql.push('', '-- repoint relationships to target taxonomy');
  const addByTT = new Map<string, number[]>(); // ttExpr -> parents
  const movedSizeTTids = new Set<number>();
  for (const [parent, tax] of parentTarget) {
    const slugs = new Set<string>([...(parentValues.get(parent) || []), ...(parentRelSlugs.get(parent) || [])]);
    for (const slug of slugs) {
      const e = ttExpr(tax, slug);
      (addByTT.get(e) || addByTT.set(e, []).get(e)!).push(parent);
      const st = bySlug.get(slug); if (st) movedSizeTTids.add(st.ttid);
    }
  }
  for (const [e, parents] of addByTT) {
    sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) SELECT ID, ${e}, 0 FROM wp_posts WHERE ID IN (${[...new Set(parents)].join(',')});`);
  }
  // delete old pa_size rels for these parents
  sql.push('', '-- detach parents from pa_size');
  sql.push(`DELETE FROM wp_term_relationships WHERE object_id IN (${targetParents.join(',')}) AND term_taxonomy_id IN (${sizeTTs.join(',')});`);

  // rename variation meta_key by parent + dim
  sql.push('', '-- rename variation axis meta_key');
  const volParents = targetParents.filter((p) => parentTarget.get(p) === 'pa_volume');
  const lenParents = targetParents.filter((p) => parentTarget.get(p) === 'pa_length');
  const renameMeta = (parents: number[], key: string) => { if (parents.length) sql.push(`UPDATE wp_postmeta SET meta_key=${q(key)} WHERE meta_key='attribute_pa_size' AND post_id IN (SELECT ID FROM wp_posts WHERE post_type='product_variation' AND post_parent IN (${parents.join(',')}));`); };
  renameMeta(volParents, 'attribute_pa_volume');
  renameMeta(lenParents, 'attribute_pa_length');

  // rewrite blobs
  sql.push('', '-- rewrite _product_attributes / _default_attributes blob tokens');
  const blob = (parents: number[], to: string) => { if (parents.length) sql.push(`UPDATE wp_postmeta SET meta_value=REPLACE(meta_value,'s:7:"pa_size"','s:9:"${to}"') WHERE post_id IN (${parents.join(',')}) AND meta_key IN ('_product_attributes','_default_attributes') AND meta_value LIKE '%s:7:"pa_size"%';`); };
  blob(volParents, 'pa_volume');
  blob(lenParents, 'pa_length');

  // delete emptied pa_size terms
  sql.push('', '-- delete emptied pa_size terms');
  const movedTermIds = [...movedSizeTTids].map((ttid) => (sizeTerms as any[]).find((r) => r.ttid === ttid)!.term_id);
  if (movedTermIds.length) {
    sql.push(`DELETE tt FROM wp_term_taxonomy tt WHERE tt.taxonomy='pa_size' AND tt.term_id IN (${movedTermIds.join(',')}) AND NOT EXISTS (SELECT 1 FROM wp_term_relationships r WHERE r.term_taxonomy_id=tt.term_taxonomy_id);`);
    sql.push(`DELETE FROM wp_terms WHERE term_id IN (${movedTermIds.join(',')}) AND term_id NOT IN (SELECT term_id FROM wp_term_taxonomy);`);
  }
  sql.push('', '-- recount');
  sql.push(`UPDATE wp_term_taxonomy tt SET count=(SELECT COUNT(*) FROM wp_term_relationships tr WHERE tr.term_taxonomy_id=tt.term_taxonomy_id) WHERE tt.taxonomy IN ('pa_size','pa_volume','pa_length');`);
  sql.push('', 'COMMIT;');
  sql.push(`SELECT CONCAT('pa_size=',(SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='pa_size'),' pa_volume=',(SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='pa_volume'),' pa_length=',(SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='pa_length')) result;`);

  writeFileSync('scripts/migrate-size-mixed.sql', sql.join('\n') + '\n');
  console.log(`Wrote scripts/migrate-size-mixed.sql`);
  console.log(`  volume parents: ${volParents.length}, length parents: ${lenParents.length}`);
  console.log(`  target terms created: ${ct}`);
  console.log(`  statements: ${sql.filter((s) => s.trim().endsWith(';')).length}`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
