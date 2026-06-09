/**
 * Generate a single SQL transaction performing the pa_flavor TERM cleanup, for fast
 * SERVER-SIDE execution (pipe over SSH: ssh hetzner "mysql ... maleq-wp" < out.sql).
 *
 * Layers handled here (term-relationship + variation value):
 *   MERGE  -> repoint product rels to the canonical flavor term (create term if it doesn't exist yet)
 *   MOVE   -> repoint product rels to pa_size / pa_color (reuse or create target term)
 *   DELETE -> detach product rels, remove the term
 *   variation attribute_pa_flavor meta_value: consolidate MERGE-source slugs -> canonical (collision-guarded)
 *
 * NOTE: the variation-axis KEY rename (attribute_pa_flavor -> attribute_pa_size/color) for
 * products that used flavor as a size/color axis is handled separately by gen-flavor-axis-sql.ts.
 * Run order on prod: this file first, then migrate-flavor-axis.sql.
 *
 * Usage: bun run scripts/gen-flavor-sql.ts            # reads PROD via tunnel, writes scripts/migrate-flavor.sql
 *        bun run scripts/gen-flavor-sql.ts --local
 */
import { getConnection } from './lib/db';
import map from './flavor-cleanup-map.generated.json';
import { writeFileSync } from 'fs';

type Mapping = {
  term_id: number; name: string; slug: string; products: number; variations: number;
  action: 'KEEP' | 'MERGE' | 'MOVE' | 'DELETE';
  flavor?: string; taxonomy?: string; value?: string; variationValue?: string; note?: string;
};
const mappings = map as Mapping[];

const q = (s: string) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// display name for a canonical flavor slug (so newly-created terms are titled nicely)
const CANON_NAME: Record<string, string> = {
  'cola': 'Cola', 'pineapple-sage': 'Pineapple Sage', 'strawberry-champagne': 'Strawberry Champagne',
  'green-tea': 'Green Tea',
};

async function main() {
  const db = await getConnection();

  // ---- batched reads ----
  const [flavorTerms] = await db.query<any[]>(
    `SELECT t.term_id, t.slug, tt.term_taxonomy_id ttid
     FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy='pa_flavor'`);
  const ttByTermId = new Map<number, number>();
  const ttBySlug = new Map<string, number>();
  const termIdBySlug = new Map<string, number>();
  for (const r of flavorTerms as any[]) { ttByTermId.set(r.term_id, r.ttid); ttBySlug.set(r.slug, r.ttid); termIdBySlug.set(r.slug, r.term_id); }

  const [otherTerms] = await db.query<any[]>(
    `SELECT t.slug, tt.term_taxonomy_id ttid, tt.taxonomy
     FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy IN ('pa_size','pa_color')`);
  const targetTT = new Map<string, number>(); // "tax:slug" -> ttid
  for (const r of otherTerms as any[]) targetTT.set(`${r.taxonomy}:${r.slug}`, r.ttid);

  // canonical flavor slugs that MERGE targets point at; protected from deletion
  const canonSlugs = new Set<string>();
  for (const m of mappings) if (m.action === 'MERGE') canonSlugs.add(m.flavor!);
  for (const m of mappings) if (m.action === 'KEEP') canonSlugs.add(m.slug);
  const protectedTermIds = new Set<number>();
  for (const m of mappings) if (m.action === 'KEEP') protectedTermIds.add(m.term_id);
  for (const slug of canonSlugs) { const tid = termIdBySlug.get(slug); if (tid != null) protectedTermIds.add(tid); }

  // ---- Phase B reads: variations on MERGE-source slugs + existing (parent,canonical) collisions ----
  const mergeSrc = mappings.filter((m) => m.action === 'MERGE' && m.slug !== m.flavor);
  const srcSlugs = mergeSrc.map((m) => m.slug);
  const slugToCanon = new Map<string, string>(); mergeSrc.forEach((m) => slugToCanon.set(m.slug, m.flavor!));
  const phaseBUpdates = new Map<string, number[]>(); // canonical -> [meta_id]
  let varRewritten = 0, varSkipped = 0;
  if (srcSlugs.length) {
    const [vars] = await db.query<any[]>(
      `SELECT pm.meta_id, p.post_parent, pm.meta_value
       FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation'
       WHERE pm.meta_key='attribute_pa_flavor' AND pm.meta_value IN (${srcSlugs.map(q).join(',')})`);
    const [existing] = await db.query<any[]>(
      `SELECT DISTINCT p.post_parent, pm.meta_value
       FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation'
       WHERE pm.meta_key='attribute_pa_flavor' AND pm.meta_value IN (${[...canonSlugs].map(q).join(',')})`);
    const present = new Set<string>(); // "parent|canonical"
    for (const r of existing as any[]) present.add(`${r.post_parent}|${r.meta_value}`);
    for (const v of vars as any[]) {
      const canon = slugToCanon.get(v.meta_value)!;
      const key = `${v.post_parent}|${canon}`;
      if (present.has(key)) { varSkipped++; continue; }
      present.add(key);
      (phaseBUpdates.get(canon) || phaseBUpdates.set(canon, []).get(canon)!).push(v.meta_id);
      varRewritten++;
    }
  }

  // ---- build SQL ----
  const sql: string[] = [];
  sql.push('SET autocommit=0;', 'START TRANSACTION;', '');

  // Pre: create any missing canonical flavor terms (MERGE targets with no existing term)
  sql.push('-- create missing canonical flavor terms');
  const createdFlavorVar = new Map<string, string>(); // slug -> @var holding its ttid
  let cf = 0;
  for (const slug of canonSlugs) {
    if (ttBySlug.has(slug)) continue;
    cf++;
    const name = CANON_NAME[slug] || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    sql.push(`INSERT INTO wp_terms (name, slug, term_group) VALUES (${q(name)}, ${q(slug)}, 0);`);
    sql.push(`SET @cf${cf} := LAST_INSERT_ID();`);
    sql.push(`INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (@cf${cf}, 'pa_flavor', '', 0, 0);`);
    sql.push(`SET @cft${cf} := LAST_INSERT_ID();`);
    createdFlavorVar.set(slug, `@cft${cf}`);
  }
  const flavorTTExpr = (slug: string): string => createdFlavorVar.get(slug) ?? String(ttBySlug.get(slug));

  // Phase A: MERGE repoints grouped by canonical target
  const sourcesByCanon = new Map<string, number[]>();
  const allSourceTT: number[] = [];
  const allSourceTermIds: number[] = [];
  for (const m of mappings) {
    if (m.action === 'KEEP' || protectedTermIds.has(m.term_id)) continue;
    const srcTT = ttByTermId.get(m.term_id);
    if (srcTT == null) continue;
    allSourceTT.push(srcTT); allSourceTermIds.push(m.term_id);
    if (m.action === 'MERGE') (sourcesByCanon.get(m.flavor!) || sourcesByCanon.set(m.flavor!, []).get(m.flavor!)!).push(srcTT);
  }
  sql.push('', '-- Phase A: repoint MERGE terms to canonical flavor');
  for (const [canon, srcTTs] of sourcesByCanon) {
    sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
  SELECT object_id, ${flavorTTExpr(canon)}, 0 FROM wp_term_relationships WHERE term_taxonomy_id IN (${srcTTs.join(',')});`);
  }

  // Phase A: MOVE to pa_size / pa_color (reuse or create target term)
  sql.push('', '-- Phase A: move non-flavor terms to pa_size / pa_color');
  const moveByTarget = new Map<string, { tax: string; slug: string; name: string; srcTTs: number[] }>();
  for (const m of mappings) {
    if (m.action !== 'MOVE') continue;
    const srcTT = ttByTermId.get(m.term_id); if (srcTT == null) continue;
    const tax = m.taxonomy || 'pa_size';
    const tslug = slugify(m.value || m.name);
    const key = `${tax}:${tslug}`;
    const e = moveByTarget.get(key) || moveByTarget.set(key, { tax, slug: tslug, name: (m.value || m.name).trim(), srcTTs: [] }).get(key)!;
    e.srcTTs.push(srcTT);
  }
  let mv = 0;
  for (const [key, e] of moveByTarget) {
    let ttExpr: string;
    if (targetTT.has(key)) {
      ttExpr = String(targetTT.get(key));
    } else {
      mv++;
      sql.push(`INSERT INTO wp_terms (name, slug, term_group) VALUES (${q(e.name)}, ${q(e.slug)}, 0);`);
      sql.push(`SET @mt${mv} := LAST_INSERT_ID();`);
      sql.push(`INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (@mt${mv}, ${q(e.tax)}, '', 0, 0);`);
      sql.push(`SET @mtt${mv} := LAST_INSERT_ID();`);
      ttExpr = `@mtt${mv}`;
    }
    sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
  SELECT object_id, ${ttExpr}, 0 FROM wp_term_relationships WHERE term_taxonomy_id IN (${e.srcTTs.join(',')});`);
  }

  // Phase A: delete ALL source relationships (MERGE + MOVE + DELETE) in one shot
  sql.push('', '-- Phase A: drop all source pa_flavor relationships');
  if (allSourceTT.length) sql.push(`DELETE FROM wp_term_relationships WHERE term_taxonomy_id IN (${allSourceTT.join(',')});`);

  // Phase B: consolidate variation MERGE-synonym slugs (collision-guarded)
  sql.push('', '-- Phase B: consolidate MERGE-source slugs on variation attribute_pa_flavor');
  for (const [canon, ids] of phaseBUpdates) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      sql.push(`UPDATE wp_postmeta SET meta_value=${q(canon)} WHERE meta_id IN (${chunk.join(',')});`);
    }
  }

  // Phase C: delete emptied source terms
  sql.push('', '-- Phase C: remove emptied source terms');
  if (allSourceTermIds.length) {
    sql.push(`DELETE FROM wp_term_taxonomy WHERE term_id IN (${allSourceTermIds.join(',')}) AND taxonomy='pa_flavor';`);
    sql.push(`DELETE FROM wp_termmeta WHERE term_id IN (${allSourceTermIds.join(',')});`);
    sql.push(`DELETE FROM wp_terms WHERE term_id IN (${allSourceTermIds.join(',')}) AND term_id NOT IN (SELECT term_id FROM wp_term_taxonomy);`);
  }

  // recount
  sql.push('', '-- recount');
  sql.push(`UPDATE wp_term_taxonomy tt SET count=(SELECT COUNT(*) FROM wp_term_relationships tr WHERE tr.term_taxonomy_id=tt.term_taxonomy_id) WHERE tt.taxonomy IN ('pa_flavor','pa_size','pa_color');`);

  sql.push('', 'COMMIT;');
  sql.push(`SELECT CONCAT('pa_flavor terms now: ', COUNT(*)) AS result FROM wp_term_taxonomy WHERE taxonomy='pa_flavor';`);

  writeFileSync('scripts/migrate-flavor.sql', sql.join('\n') + '\n');
  console.log('Wrote scripts/migrate-flavor.sql');
  console.log(`  MERGE canonical targets: ${sourcesByCanon.size} (created ${cf} new flavor terms)`);
  console.log(`  MOVE targets: ${moveByTarget.size} (created ${mv} new size/color terms)`);
  console.log(`  source terms removed: ${allSourceTermIds.length}`);
  console.log(`  Phase B: ${varRewritten} variation rewrites (${varSkipped} skipped for collision)`);
  console.log(`  statements: ${sql.filter((s) => s.trim().endsWith(';')).length}`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
