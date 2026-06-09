/**
 * Split pa_size -> pa_volume / pa_length (apparel/count/other stay pa_size).
 *
 * Mechanism (per-product repoint; mixed-axis products deferred, never broken):
 *   - VARIABLE product with a PURE volume axis  -> move whole axis to pa_volume
 *   - VARIABLE product with a PURE length axis  -> move whole axis to pa_length
 *   - SIMPLE product: repoint its volume/length pa_size relationships per-dim
 *   - MIXED-axis variable products              -> LEFT on pa_size (logged to JSON)
 *
 * Per moved product:
 *   - INSERT IGNORE term_relationships to the pa_volume/pa_length term (slug reused;
 *     wp_terms.slug is NOT unique, so the same slug may exist in both taxonomies)
 *   - DELETE the old pa_size relationship for that object
 *   - (variable) rename variation postmeta meta_key attribute_pa_size -> attribute_pa_volume/length
 *   - (variable+simple) rewrite _product_attributes / _default_attributes blob token
 *       s:7:"pa_size" -> s:9:"pa_volume" / s:9:"pa_length"   (fixed-token REPLACE, valid PHP)
 *   - emptied pa_size terms (no rels left) are deleted; pinned ones (used by mixed) stay
 *
 * Usage: bun run scripts/gen-size-split-sql.ts   # PROD via tunnel -> scripts/migrate-size-split.sql + scripts/size-split-mixed-review.json
 */
import { getConnection } from './lib/db';
import { writeFileSync } from 'fs';

const q = (s: string) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const APPAREL = new Set(['xs', 's', 'm', 'l', 'xl', '2xl', '3xl', '4xl', 's-m', 'm-l', 'l-xl', 'xl-2xl', 'one-size', 'queen', '1x', '2x', '3x', '4x', '5x', 'plus', 'petite', 'king', 'mini']);
function dimOf(name: string, slug: string): 'volume' | 'length' | 'apparel' | 'count' | 'other' {
  const n = name.trim().toLowerCase();
  if (APPAREL.has(slug)) return 'apparel';
  if (/-(oz|ml|l|g|mg)$/.test(slug) || /\b\d+(\.\d+)?\s*(fl\.?\s*)?(oz|ml|l|liter|g|gram|mg|ounce)\b/.test(n)) return 'volume';
  if (/-(in|cm|mm|ft)$/.test(slug) || /\b\d+(\.\d+)?\s*(in|inch|inches|"|cm|mm|ft|foot|feet)\b/.test(n) || /\blong\b/.test(n)) return 'length';
  if (/\b\d+\s*(pcs?|pc|pack|pk|count|ct|display|piece)\b/.test(n) || /\bdisplay\b/.test(n)) return 'count';
  return 'other';
}

async function main() {
  const db = await getConnection();

  // 1. pa_size terms
  const [terms] = await db.query<any[]>(
    `SELECT t.term_id, t.name, t.slug, tt.term_taxonomy_id ttid FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy='pa_size'`);
  const term = new Map<number, { term_id: number; name: string; slug: string; dim: string }>(); // by ttid
  const ttBySlug = new Map<string, number>();
  for (const r of terms as any[]) { term.set(r.ttid, { term_id: r.term_id, name: r.name, slug: r.slug, dim: dimOf(r.name, r.slug) }); ttBySlug.set(r.slug, r.ttid); }

  // 2. all pa_size relationships
  const sizeTTs = [...term.keys()];
  const [rels] = await db.query<any[]>(
    `SELECT object_id, term_taxonomy_id FROM wp_term_relationships WHERE term_taxonomy_id IN (${sizeTTs.join(',')})`);
  const relsByObject = new Map<number, number[]>(); // object_id -> [size ttid]
  for (const r of rels as any[]) (relsByObject.get(r.object_id) || relsByObject.set(r.object_id, []).get(r.object_id)!).push(r.term_taxonomy_id);

  // 3. variable products (have variations) + their pa_size variation values
  const [vars] = await db.query<any[]>(
    `SELECT pm.meta_id, p.post_parent AS parent, pm.meta_value AS slug
       FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation'
      WHERE pm.meta_key='attribute_pa_size' AND pm.meta_value<>''`);
  const parentVarMeta = new Map<number, number[]>();   // parent -> [meta_id]
  const parentSlugs = new Map<number, Set<string>>();
  for (const v of vars as any[]) {
    (parentVarMeta.get(v.parent) || parentVarMeta.set(v.parent, []).get(v.parent)!).push(v.meta_id);
    (parentSlugs.get(v.parent) || parentSlugs.set(v.parent, new Set()).get(v.parent)!).add(v.slug);
  }
  const slugDim = new Map<string, string>(); for (const t of term.values()) slugDim.set(t.slug, t.dim);

  // classify variable products
  const pureVolParents = new Set<number>(), pureLenParents = new Set<number>();
  const mixedReview: any[] = [];
  for (const [parent, slugs] of parentSlugs) {
    const dims = new Set([...slugs].map((s) => slugDim.get(s) || 'other'));
    const real = [...dims].filter((d) => d !== 'other');
    const uniq = new Set(real.length ? real : [...dims]);
    if (uniq.size === 1) {
      const d = [...uniq][0];
      if (d === 'volume') pureVolParents.add(parent);
      else if (d === 'length') pureLenParents.add(parent);
      // apparel/count/other pure axes stay pa_size
    } else {
      mixedReview.push({ parent, dims: [...dims], values: [...slugs] });
    }
  }
  const variableIds = new Set<number>(parentSlugs.keys());

  // 4. plan: movable (object_id, fromSizeTT|null, targetTax) repoints
  type Repoint = { object_id: number; fromTT: number | null; slug: string; name: string; tax: 'pa_volume' | 'pa_length' };
  const repoints: Repoint[] = [];
  const seenRepoint = new Set<string>();
  const slugName = new Map<string, string>(); for (const t of term.values()) slugName.set(t.slug, t.name);
  const deriveName = (slug: string) => slugName.get(slug) || slug.replace(/-/g, ' ');
  const addRepoint = (object_id: number, fromTT: number | null, slug: string, tax: 'pa_volume' | 'pa_length') => {
    const k = `${object_id}|${tax}|${slug}`; if (seenRepoint.has(k)) return; seenRepoint.add(k);
    repoints.push({ object_id, fromTT, slug, name: deriveName(slug), tax });
  };

  // 4a. variable pure products: move every existing size rel to the target tax
  for (const [object_id, ttids] of relsByObject) {
    if (pureVolParents.has(object_id)) { for (const tt of ttids) if (term.get(tt)!.dim === 'volume') addRepoint(object_id, tt, term.get(tt)!.slug, 'pa_volume'); }
    else if (pureLenParents.has(object_id)) { for (const tt of ttids) if (term.get(tt)!.dim === 'length') addRepoint(object_id, tt, term.get(tt)!.slug, 'pa_length'); }
    else if (!variableIds.has(object_id)) {
      // 4b. SIMPLE product: repoint volume/length rels per-dim
      for (const tt of ttids) {
        const d = term.get(tt)!.dim;
        if (d === 'volume') addRepoint(object_id, tt, term.get(tt)!.slug, 'pa_volume');
        else if (d === 'length') addRepoint(object_id, tt, term.get(tt)!.slug, 'pa_length');
      }
    }
    // mixed variable + apparel/count/other variable: untouched
  }

  // 4c. ALSO ensure a target term + parent relationship for every VARIATION value of a
  // pure parent — variation postmeta is the source of truth and a value may lack a
  // parent term_relationship (common WC inconsistency); without this the renamed
  // attribute_pa_volume/length value would point at a non-existent term.
  for (const [parent, slugs] of parentSlugs) {
    const tax = pureVolParents.has(parent) ? 'pa_volume' : pureLenParents.has(parent) ? 'pa_length' : null;
    if (!tax) continue;
    for (const slug of slugs) addRepoint(parent, ttBySlug.get(slug) ?? null, slug, tax);
  }

  // 5. target terms needed: (tax, slug) -> create (slug reused from pa_size; new term row)
  const targetKey = (tax: string, slug: string) => `${tax}|${slug}`;
  const targetName = new Map<string, string>();
  for (const r of repoints) targetName.set(targetKey(r.tax, r.slug), r.name);

  // ---- build SQL ----
  const sql: string[] = [];
  sql.push('SET autocommit=0;', 'START TRANSACTION;', '');

  // create target pa_volume/pa_length terms (fresh rows; duplicate slug across taxonomy is allowed)
  sql.push('-- create pa_volume / pa_length terms');
  const targetTTVar = new Map<string, string>(); // key -> @var with ttid
  let ct = 0;
  for (const [key, name] of targetName) {
    const [tax, slug] = key.split('|');
    ct++;
    sql.push(`INSERT INTO wp_terms (name, slug, term_group) VALUES (${q(name)}, ${q(slug)}, 0);`);
    sql.push(`SET @t${ct} := LAST_INSERT_ID();`);
    sql.push(`INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (@t${ct}, ${q(tax)}, '', 0, 0);`);
    sql.push(`SET @tt${ct} := LAST_INSERT_ID();`);
    targetTTVar.set(key, `@tt${ct}`);
  }

  // repoint relationships: group by (target tt) -> object_ids ; and (fromTT)->object_ids to delete
  sql.push('', '-- repoint relationships to pa_volume / pa_length');
  const addByTarget = new Map<string, Set<number>>(); // targetKey -> object_ids
  const delByFromTT = new Map<number, Set<number>>();  // fromTT -> object_ids
  for (const r of repoints) {
    (addByTarget.get(targetKey(r.tax, r.slug)) || addByTarget.set(targetKey(r.tax, r.slug), new Set()).get(targetKey(r.tax, r.slug))!).add(r.object_id);
    if (r.fromTT != null) (delByFromTT.get(r.fromTT) || delByFromTT.set(r.fromTT, new Set()).get(r.fromTT)!).add(r.object_id);
  }
  for (const [key, ids] of addByTarget) {
    const arr = [...ids];
    for (let i = 0; i < arr.length; i += 500) {
      const chunk = arr.slice(i, i + 500);
      sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) SELECT ID, ${targetTTVar.get(key)}, 0 FROM wp_posts WHERE ID IN (${chunk.join(',')});`);
    }
  }
  sql.push('', '-- detach moved objects from their pa_size term');
  for (const [fromTT, ids] of delByFromTT) {
    const arr = [...ids];
    for (let i = 0; i < arr.length; i += 500) {
      const chunk = arr.slice(i, i + 500);
      sql.push(`DELETE FROM wp_term_relationships WHERE term_taxonomy_id=${fromTT} AND object_id IN (${chunk.join(',')});`);
    }
  }

  // variation meta_key rename for pure variable products — keyed by PARENT so that
  // empty-value ("Any") attribute_pa_size variations are renamed too.
  sql.push('', '-- rename variation axis meta_key for pure variable products');
  const renameByParents = (parents: number[], key: string) => {
    for (let i = 0; i < parents.length; i += 500) {
      const chunk = parents.slice(i, i + 500);
      sql.push(`UPDATE wp_postmeta SET meta_key=${q(key)} WHERE meta_key='attribute_pa_size' AND post_id IN (SELECT ID FROM wp_posts WHERE post_type='product_variation' AND post_parent IN (${chunk.join(',')}));`);
    }
  };
  renameByParents([...pureVolParents], 'attribute_pa_volume');
  renameByParents([...pureLenParents], 'attribute_pa_length');

  // parent + simple-product blob rewrite (_product_attributes, _default_attributes)
  sql.push('', '-- rewrite _product_attributes / _default_attributes blob tokens');
  const volProducts = new Set<number>([...pureVolParents]);
  const lenProducts = new Set<number>([...pureLenParents]);
  // simple products: assign blob target by the dim they were repointed to (single-dim assumed)
  for (const r of repoints) { if (!variableIds.has(r.object_id)) { if (r.tax === 'pa_volume') volProducts.add(r.object_id); else lenProducts.add(r.object_id); } }
  const blobRewrite = (ids: number[], to: string) => {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      sql.push(`UPDATE wp_postmeta SET meta_value=REPLACE(meta_value,'s:7:"pa_size"','s:9:"${to}"') WHERE post_id IN (${chunk.join(',')}) AND meta_key IN ('_product_attributes','_default_attributes') AND meta_value LIKE '%s:7:"pa_size"%';`);
    }
  };
  blobRewrite([...volProducts], 'pa_volume');
  blobRewrite([...lenProducts], 'pa_length');

  // catch-all: any child variation of a moved product that still carries
  // attribute_pa_size (e.g. an empty "Any" value on a product mis-seen as simple)
  // gets its key aligned to the new taxonomy so nothing dangles.
  sql.push('', '-- align any leftover child attribute_pa_size on moved products');
  const alignLeftover = (ids: number[], key: string) => {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      sql.push(`UPDATE wp_postmeta SET meta_key=${q(key)} WHERE meta_key='attribute_pa_size' AND post_id IN (SELECT ID FROM wp_posts WHERE post_type='product_variation' AND post_parent IN (${chunk.join(',')}));`);
    }
  };
  alignLeftover([...volProducts], 'attribute_pa_volume');
  alignLeftover([...lenProducts], 'attribute_pa_length');

  // delete emptied pa_size terms (no relationships left); pinned (mixed) terms stay
  sql.push('', '-- delete emptied pa_size terms');
  const movedTermIds = [...new Set(repoints.filter((r) => r.fromTT != null).map((r) => term.get(r.fromTT!)!.term_id))];
  sql.push(`DELETE tt FROM wp_term_taxonomy tt WHERE tt.taxonomy='pa_size' AND tt.term_id IN (${movedTermIds.join(',')})
  AND NOT EXISTS (SELECT 1 FROM wp_term_relationships r WHERE r.term_taxonomy_id=tt.term_taxonomy_id);`);
  sql.push(`DELETE FROM wp_terms WHERE term_id IN (${movedTermIds.join(',')}) AND term_id NOT IN (SELECT term_id FROM wp_term_taxonomy);`);

  // recount
  sql.push('', '-- recount');
  sql.push(`UPDATE wp_term_taxonomy tt SET count=(SELECT COUNT(*) FROM wp_term_relationships tr WHERE tr.term_taxonomy_id=tt.term_taxonomy_id) WHERE tt.taxonomy IN ('pa_size','pa_volume','pa_length');`);

  sql.push('', 'COMMIT;');
  sql.push(`SELECT CONCAT('pa_size=',(SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='pa_size'),' pa_volume=',(SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='pa_volume'),' pa_length=',(SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='pa_length')) AS result;`);

  writeFileSync('scripts/migrate-size-split.sql', sql.join('\n') + '\n');
  writeFileSync('scripts/size-split-mixed-review.json', JSON.stringify(mixedReview, null, 2));
  console.log('Wrote scripts/migrate-size-split.sql + scripts/size-split-mixed-review.json');
  console.log(`  pure-volume variable products: ${pureVolParents.size}`);
  console.log(`  pure-length variable products: ${pureLenParents.size}`);
  console.log(`  total repoints (rels): ${repoints.length}`);
  console.log(`  target terms created: ${ct}`);
  console.log(`  variation meta renamed: vol=${volMetaIds.length} len=${lenMetaIds.length}`);
  console.log(`  blob products: vol=${volProducts.size} len=${lenProducts.size}`);
  console.log(`  pa_size terms candidate for deletion: ${movedTermIds.length}`);
  console.log(`  MIXED products deferred (review JSON): ${mixedReview.length}`);
  console.log(`  statements: ${sql.filter((s) => s.trim().endsWith(';')).length}`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
