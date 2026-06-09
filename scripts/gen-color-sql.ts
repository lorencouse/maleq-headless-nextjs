/**
 * Generate a single SQL transaction that performs the pa_color cleanup, for fast
 * SERVER-SIDE execution (pipe over SSH: ssh hetzner "mysql ... maleq-wp" < out.sql).
 *
 * Does the same surgical work as cleanup-colors.ts but with batched reads + one SQL file:
 *   COLOR  -> repoint product rels to canonical base color term(s)
 *   MOVE   -> move product rel to pa_size/pa_flavor (reuse or create term)
 *   DELETE -> detach product rels, remove term
 *   variation attribute_pa_color: consolidate single-color synonyms (collision-guarded)
 *
 * Usage: bun run scripts/gen-color-sql.ts            # reads PROD via tunnel, writes scripts/migrate-colors.sql
 *        bun run scripts/gen-color-sql.ts --local    # reads local
 */
import { getConnection } from './lib/db';
import map from './color-cleanup-map.generated.json';
import { writeFileSync } from 'fs';

type Mapping = {
  term_id: number; name: string; slug: string; products: number; variations: number;
  action: 'KEEP' | 'COLOR' | 'MOVE' | 'DELETE';
  colors?: string[]; taxonomy?: string; value?: string; variationValue?: string; note?: string;
};
const mappings = map as Mapping[];

const q = (s: string) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function main() {
  const db = await getConnection();

  // ---- batched reads ----
  const [colorTerms] = await db.query<any[]>(
    `SELECT t.term_id, t.slug, tt.term_taxonomy_id ttid
     FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy='pa_color'`);
  const ttByTermId = new Map<number, number>();
  const ttBySlug = new Map<string, number>();
  for (const r of colorTerms as any[]) { ttByTermId.set(r.term_id, r.ttid); ttBySlug.set(r.slug, r.ttid); }

  const [otherTerms] = await db.query<any[]>(
    `SELECT t.slug, tt.term_taxonomy_id ttid, tt.taxonomy
     FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy IN ('pa_size','pa_flavor')`);
  const targetTT = new Map<string, number>(); // "tax:slug" -> ttid
  for (const r of otherTerms as any[]) targetTT.set(`${r.taxonomy}:${r.slug}`, r.ttid);

  // base color slugs + protected term ids
  const baseSlugs = new Set<string>();
  for (const m of mappings) if (m.colors) m.colors.forEach((c) => baseSlugs.add(c));
  const protectedTermIds = new Set<number>();
  for (const m of mappings) if (m.action === 'KEEP') protectedTermIds.add(m.term_id);
  for (const slug of baseSlugs) { const tt = ttBySlug.get(slug); if (tt) { /* find term_id */ } }
  // map base slug -> { ttid, term_id }
  const baseTermId = new Map<string, number>();
  for (const r of colorTerms as any[]) if (baseSlugs.has(r.slug)) { baseTermId.set(r.slug, r.term_id); protectedTermIds.add(r.term_id); }

  // ---- Phase B reads: variations on single-color synonym slugs + existing (parent,base) ----
  const singleSyn = mappings.filter((m) => m.action === 'COLOR' && m.colors!.length === 1 && m.colors![0] !== m.slug);
  const synSlugs = singleSyn.map((m) => m.slug);
  const slugToBase = new Map<string, string>(); singleSyn.forEach((m) => slugToBase.set(m.slug, m.colors![0]));
  let phaseBUpdates = new Map<string, number[]>(); // base -> [meta_id]
  let varRewritten = 0, varSkipped = 0;
  if (synSlugs.length) {
    const [vars] = await db.query<any[]>(
      `SELECT pm.meta_id, p.post_parent, pm.meta_value
       FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation'
       WHERE pm.meta_key='attribute_pa_color' AND pm.meta_value IN (${synSlugs.map(q).join(',')})`);
    const [existing] = await db.query<any[]>(
      `SELECT DISTINCT p.post_parent, pm.meta_value
       FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation'
       WHERE pm.meta_key='attribute_pa_color' AND pm.meta_value IN (${[...baseSlugs].map(q).join(',')})`);
    const present = new Set<string>(); // "parent|base"
    for (const r of existing as any[]) present.add(`${r.post_parent}|${r.meta_value}`);
    for (const v of vars as any[]) {
      const base = slugToBase.get(v.meta_value)!;
      const key = `${v.post_parent}|${base}`;
      if (present.has(key)) { varSkipped++; continue; }
      present.add(key);
      (phaseBUpdates.get(base) || phaseBUpdates.set(base, []).get(base)!).push(v.meta_id);
      varRewritten++;
    }
  }

  // ---- build SQL ----
  const sql: string[] = [];
  sql.push('SET autocommit=0;', 'START TRANSACTION;', '');

  // PHASE A: COLOR repoints grouped by base
  const sourcesByBase = new Map<string, number[]>(); // base slug -> [source ttid]
  const allSourceTT: number[] = [];
  const allSourceTermIds: number[] = [];
  for (const m of mappings) {
    if (m.action === 'KEEP' || protectedTermIds.has(m.term_id)) continue;
    const srcTT = ttByTermId.get(m.term_id);
    if (srcTT == null) continue;
    allSourceTT.push(srcTT); allSourceTermIds.push(m.term_id);
    if (m.action === 'COLOR') {
      for (const c of m.colors!) {
        if (baseTermId.get(c) === m.term_id) continue;
        (sourcesByBase.get(c) || sourcesByBase.set(c, []).get(c)!).push(srcTT);
      }
    }
  }
  sql.push('-- Phase A: repoint COLOR terms to canonical base colors');
  for (const [base, srcTTs] of sourcesByBase) {
    const baseTT = ttBySlug.get(base)!;
    sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
  SELECT object_id, ${baseTT}, 0 FROM wp_term_relationships WHERE term_taxonomy_id IN (${srcTTs.join(',')});`);
  }

  // PHASE A: MOVE to pa_size/pa_flavor (reuse or create target term)
  sql.push('', '-- Phase A: move non-color terms to pa_size / pa_flavor');
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
  let varCounter = 0;
  for (const [key, e] of moveByTarget) {
    let ttExpr: string;
    if (targetTT.has(key)) {
      ttExpr = String(targetTT.get(key));
    } else {
      varCounter++;
      sql.push(`INSERT INTO wp_terms (name, slug, term_group) VALUES (${q(e.name)}, ${q(e.slug)}, 0);`);
      sql.push(`SET @term := LAST_INSERT_ID();`);
      sql.push(`INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (@term, ${q(e.tax)}, '', 0, 0);`);
      sql.push(`SET @tt${varCounter} := LAST_INSERT_ID();`);
      ttExpr = `@tt${varCounter}`;
    }
    sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
  SELECT object_id, ${ttExpr}, 0 FROM wp_term_relationships WHERE term_taxonomy_id IN (${e.srcTTs.join(',')});`);
  }

  // PHASE A: delete ALL source relationships (COLOR + MOVE + DELETE) in one shot
  sql.push('', '-- Phase A: drop all source pa_color relationships');
  if (allSourceTT.length) sql.push(`DELETE FROM wp_term_relationships WHERE term_taxonomy_id IN (${allSourceTT.join(',')});`);

  // PHASE B: consolidate variation synonyms (collision-guarded, computed above)
  sql.push('', '-- Phase B: consolidate single-color synonym slugs on variations');
  for (const [base, ids] of phaseBUpdates) {
    // chunk to keep statements reasonable
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      sql.push(`UPDATE wp_postmeta SET meta_value=${q(base)} WHERE meta_id IN (${chunk.join(',')});`);
    }
  }

  // PHASE C: delete emptied source terms
  sql.push('', '-- Phase C: remove emptied source terms');
  if (allSourceTermIds.length) {
    sql.push(`DELETE FROM wp_term_taxonomy WHERE term_id IN (${allSourceTermIds.join(',')}) AND taxonomy='pa_color';`);
    sql.push(`DELETE FROM wp_termmeta WHERE term_id IN (${allSourceTermIds.join(',')});`);
    sql.push(`DELETE FROM wp_terms WHERE term_id IN (${allSourceTermIds.join(',')}) AND term_id NOT IN (SELECT term_id FROM wp_term_taxonomy);`);
  }

  // recount
  sql.push('', '-- recount');
  sql.push(`UPDATE wp_term_taxonomy tt SET count=(SELECT COUNT(*) FROM wp_term_relationships tr WHERE tr.term_taxonomy_id=tt.term_taxonomy_id) WHERE tt.taxonomy IN ('pa_color','pa_size','pa_flavor');`);

  sql.push('', 'COMMIT;');
  sql.push(`SELECT CONCAT('pa_color terms now: ', COUNT(*)) AS result FROM wp_term_taxonomy WHERE taxonomy='pa_color';`);

  writeFileSync('scripts/migrate-colors.sql', sql.join('\n') + '\n');
  console.log('Wrote scripts/migrate-colors.sql');
  console.log(`  COLOR bases: ${sourcesByBase.size}, MOVE targets: ${moveByTarget.size}, source terms: ${allSourceTermIds.length}`);
  console.log(`  Phase B: ${varRewritten} variation rewrites (${varSkipped} skipped for collision)`);
  console.log(`  statements: ${sql.filter((s) => s.trim().endsWith(';')).length}`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
