/**
 * Generate a PER-PRODUCT migration that resolves ambiguous BARE-NUMBER pa_size
 * terms ("8", "6.5", "03") into proper "N in" / "N oz" terms using the product's
 * CATEGORY (the user's heuristic):
 *   lube / cleaner / oil / cream / lotion / spray / hygiene / douche  -> VOLUME  -> "N oz"  (value <= 64)
 *   lingerie / clothing / costume / apparel                          -> APPAREL -> leave untouched
 *   everything else (toys: dildos, anal, cock-rings, harnesses, …)   -> LENGTH  -> "N in"  (0.5 <= value <= 14)
 * Out-of-range values (e.g. cock-ring "75" = mm, lingerie "420") are LEFT untouched.
 *
 * Per-relationship (not per-term): a bare term split across categories repoints
 * each product to the right target; the bare term is deleted only if fully emptied.
 *
 * Usage: bun run scripts/gen-size-bare-sql.ts   # reads PROD via tunnel, writes scripts/migrate-size-bare.sql
 */
import { getConnection } from './lib/db';
import { writeFileSync } from 'fs';

const q = (s: string) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const VOLUME_CAT = /lube|lubric|cleaner|clean|oil|cream|lotion|spray|hygiene|douche|enema|moistur|masturbation/i;
const APPAREL_CAT = /lingerie|clothing|costume|apparel|underwear|bodystocking/i;

function bucket(cats: string[]): 'volume' | 'apparel' | 'length' {
  if (cats.some((c) => VOLUME_CAT.test(c))) return 'volume';
  if (cats.some((c) => APPAREL_CAT.test(c))) return 'apparel';
  return 'length';
}

// returns the canonical target {name,slug} for a (bucket,value), or null = leave untouched
function target(b: 'volume' | 'apparel' | 'length', value: number): { name: string; slug: string } | null {
  if (b === 'volume' && value > 0 && value <= 64) return { name: `${value} oz`, slug: slugify(`${value} oz`) };
  if (b === 'length' && value >= 0.5 && value <= 14) return { name: `${value} in`, slug: slugify(`${value} in`) };
  return null; // apparel, or out-of-range -> keep as-is
}

async function main() {
  const db = await getConnection();

  // 1. bare-number pa_size terms (name is a single number; skip ranges like "39 40")
  const [bareTerms] = await db.query<any[]>(
    `SELECT t.term_id, t.name, t.slug, tt.term_taxonomy_id ttid
       FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id
      WHERE tt.taxonomy='pa_size' AND t.name REGEXP '^[0-9]+(\\\\.[0-9]+)?$'`);
  const bare = (bareTerms as any[]).map((r) => ({ ...r, value: parseFloat(r.name) }));
  const bareTTs = bare.map((b) => b.ttid);
  console.log(`Bare-number pa_size terms: ${bare.length}`);
  if (!bare.length) { await db.end(); return; }

  // 2. product relationships + each product's categories
  const [prodRows] = await db.query<any[]>(
    `SELECT r.term_taxonomy_id AS bare_tt, p.ID AS product_id,
            GROUP_CONCAT(DISTINCT ct.slug) AS cats
       FROM wp_term_relationships r
       JOIN wp_posts p ON p.ID=r.object_id AND p.post_type='product'
       LEFT JOIN wp_term_relationships cr ON cr.object_id=p.ID
       LEFT JOIN wp_term_taxonomy ctt ON ctt.term_taxonomy_id=cr.term_taxonomy_id AND ctt.taxonomy='product_cat'
       LEFT JOIN wp_terms ct ON ct.term_id=ctt.term_id
      WHERE r.term_taxonomy_id IN (${bareTTs.join(',')})
      GROUP BY r.term_taxonomy_id, p.ID`);

  // 3. existing pa_size terms (to find/create target tt_ids)
  const [sizeTerms] = await db.query<any[]>(
    `SELECT t.slug, tt.term_taxonomy_id ttid FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy='pa_size'`);
  const ttBySlug = new Map<string, number>();
  for (const r of sizeTerms as any[]) ttBySlug.set(r.slug, r.ttid);

  const ttToBare = new Map<number, any>(); for (const b of bare) ttToBare.set(b.ttid, b);

  // plan: per target slug -> set of product_ids to add; per bare tt -> product_ids to detach
  const addByTarget = new Map<string, { name: string; products: Set<number> }>();
  const detachByBareTT = new Map<number, Set<number>>();
  const keptByBucket: Record<string, number> = { apparel: 0, 'out-of-range': 0 };
  let repointed = 0;
  const planSample: string[] = [];

  for (const row of prodRows as any[]) {
    const b = ttToBare.get(row.bare_tt); if (!b) continue;
    const cats = (row.cats || '').split(',').filter(Boolean);
    const bk = bucket(cats);
    const tgt = target(bk, b.value);
    if (!tgt) { keptByBucket[bk === 'apparel' ? 'apparel' : 'out-of-range']++; continue; }
    const e = addByTarget.get(tgt.slug) || addByTarget.set(tgt.slug, { name: tgt.name, products: new Set() }).get(tgt.slug)!;
    e.products.add(row.product_id);
    (detachByBareTT.get(row.bare_tt) || detachByBareTT.set(row.bare_tt, new Set()).get(row.bare_tt)!).add(row.product_id);
    repointed++;
    if (planSample.length < 25) planSample.push(`"${b.name}" p${row.product_id} ${bk} -> ${tgt.slug} [${cats[0] || '?'}]`);
  }

  // 4. variations on bare slugs + parent product categories
  const bareSlugs = bare.map((b) => b.slug);
  const [varRows] = await db.query<any[]>(
    `SELECT pm.meta_id, pm.meta_value AS bare_slug, p.post_parent AS parent_id,
            GROUP_CONCAT(DISTINCT ct.slug) AS cats
       FROM wp_postmeta pm
       JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation'
       LEFT JOIN wp_term_relationships cr ON cr.object_id=p.post_parent
       LEFT JOIN wp_term_taxonomy ctt ON ctt.term_taxonomy_id=cr.term_taxonomy_id AND ctt.taxonomy='product_cat'
       LEFT JOIN wp_terms ct ON ct.term_id=ctt.term_id
      WHERE pm.meta_key='attribute_pa_size' AND pm.meta_value IN (${bareSlugs.map(q).join(',')})
      GROUP BY pm.meta_id`);
  const slugToValue = new Map<string, number>(); for (const b of bare) slugToValue.set(b.slug, b.value);
  // existing (parent, targetSlug) variation values -> collision guard
  const [existingVar] = await db.query<any[]>(
    `SELECT DISTINCT p.post_parent, pm.meta_value FROM wp_postmeta pm
       JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation'
      WHERE pm.meta_key='attribute_pa_size'`);
  const presentVar = new Set<string>(); for (const r of existingVar as any[]) presentVar.add(`${r.post_parent}|${r.meta_value}`);
  const varUpdate = new Map<string, number[]>(); // targetSlug -> meta_ids
  let varRewritten = 0, varSkipped = 0;
  for (const v of varRows as any[]) {
    const value = slugToValue.get(v.bare_slug); if (value == null) continue;
    const cats = (v.cats || '').split(',').filter(Boolean);
    const tgt = target(bucket(cats), value); if (!tgt) continue;
    const key = `${v.parent_id}|${tgt.slug}`;
    if (presentVar.has(key)) { varSkipped++; continue; }
    presentVar.add(key);
    (varUpdate.get(tgt.slug) || varUpdate.set(tgt.slug, []).get(tgt.slug)!).push(v.meta_id);
    varRewritten++;
  }

  // ---- build SQL ----
  const sql: string[] = [];
  sql.push('SET autocommit=0;', 'START TRANSACTION;', '');

  // create any missing target terms
  sql.push('-- create missing target size terms');
  const createdVar = new Map<string, string>();
  let cf = 0;
  const allTargets = new Set<string>([...addByTarget.keys(), ...varUpdate.keys()]);
  for (const slug of allTargets) {
    if (ttBySlug.has(slug)) continue;
    cf++;
    const name = addByTarget.get(slug)?.name || slug.replace(/-/g, ' ');
    sql.push(`INSERT INTO wp_terms (name, slug, term_group) VALUES (${q(name)}, ${q(slug)}, 0);`);
    sql.push(`SET @cf${cf} := LAST_INSERT_ID();`);
    sql.push(`INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (@cf${cf}, 'pa_size', '', 0, 0);`);
    sql.push(`SET @cft${cf} := LAST_INSERT_ID();`);
    createdVar.set(slug, `@cft${cf}`);
  }
  const ttExpr = (slug: string) => createdVar.get(slug) ?? String(ttBySlug.get(slug));

  // repoint product relationships
  sql.push('', '-- repoint product relationships to N in / N oz by category');
  for (const [slug, e] of addByTarget) {
    const ids = [...e.products];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) SELECT ID, ${ttExpr(slug)}, 0 FROM wp_posts WHERE ID IN (${chunk.join(',')});`);
    }
  }
  // detach the repointed products from their bare term
  sql.push('', '-- detach repointed products from the bare-number term');
  for (const [bareTT, ids] of detachByBareTT) {
    const arr = [...ids];
    for (let i = 0; i < arr.length; i += 500) {
      const chunk = arr.slice(i, i + 500);
      sql.push(`DELETE FROM wp_term_relationships WHERE term_taxonomy_id=${bareTT} AND object_id IN (${chunk.join(',')});`);
    }
  }

  // variation postmeta consolidation
  sql.push('', '-- repoint variation attribute_pa_size values (collision-guarded)');
  for (const [slug, ids] of varUpdate) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      sql.push(`UPDATE wp_postmeta SET meta_value=${q(slug)} WHERE meta_id IN (${chunk.join(',')});`);
    }
  }

  // delete bare terms that are now fully empty (no remaining relationships)
  sql.push('', '-- delete emptied bare-number terms (kept if apparel/out-of-range products remain)');
  const bareTermIds = bare.map((b) => b.term_id);
  sql.push(`DELETE tt FROM wp_term_taxonomy tt WHERE tt.taxonomy='pa_size' AND tt.term_id IN (${bareTermIds.join(',')})
  AND NOT EXISTS (SELECT 1 FROM wp_term_relationships r WHERE r.term_taxonomy_id=tt.term_taxonomy_id);`);
  sql.push(`DELETE FROM wp_terms WHERE term_id IN (${bareTermIds.join(',')}) AND term_id NOT IN (SELECT term_id FROM wp_term_taxonomy);`);

  // recount
  sql.push('', '-- recount');
  sql.push(`UPDATE wp_term_taxonomy tt SET count=(SELECT COUNT(*) FROM wp_term_relationships tr WHERE tr.term_taxonomy_id=tt.term_taxonomy_id) WHERE tt.taxonomy='pa_size';`);

  sql.push('', 'COMMIT;');
  sql.push(`SELECT CONCAT('pa_size terms now: ', COUNT(*)) AS result FROM wp_term_taxonomy WHERE taxonomy='pa_size';`);

  writeFileSync('scripts/migrate-size-bare.sql', sql.join('\n') + '\n');
  console.log(`\nWrote scripts/migrate-size-bare.sql`);
  console.log(`  product relationships repointed: ${repointed}`);
  console.log(`  kept (apparel): ${keptByBucket.apparel}, kept (out-of-range): ${keptByBucket['out-of-range']}`);
  console.log(`  target terms: ${allTargets.size} (created ${cf} new)`);
  console.log(`  variation rewrites: ${varRewritten} (${varSkipped} skipped for collision)`);
  console.log(`  statements: ${sql.filter((s) => s.trim().endsWith(';')).length}`);
  console.log('\n  sample plan:');
  for (const s of planSample) console.log('   ' + s);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
