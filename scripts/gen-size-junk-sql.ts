/**
 * Curated long-tail cleanup of the remaining pa_size junk (post-split).
 *   DELETE  : orphan terms (0 products)
 *   MERGE   : apparel + pack typos -> canonical pa_size term (rels + variation postmeta consolidated)
 *   MOVE    : leaked flavors/colors -> pa_flavor / pa_color (rels repointed; variation slug may
 *             dangle cosmetically per the [[flavor-attribute-cleanup]] precedent)
 * Conservative: only high-confidence terms; ambiguous 1-product junk left untouched.
 *
 * Usage: bun run scripts/gen-size-junk-sql.ts   # PROD via tunnel -> scripts/migrate-size-junk.sql
 */
import { getConnection } from './lib/db';
import { writeFileSync } from 'fs';

const q = (s: string) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// apparel/pack typo slug -> canonical pa_size slug (canonical term must already exist)
const MERGE: Record<string, string> = {
  // apparel
  'xlxxl': 'xl-2xl', 'xxl-2xl': '2xl',
  'osqueen': 'one-size', 'os-navy': 'one-size', 'gging-o-s': 'one-size',
  'dress-q-s': 'queen', 'ngria-q-s': 'queen', 'gloved-qs': 'queen', 'rim-garnet-o-s-queen': 'queen', 'qn': 'queen',
  'b-lxl': 'l-xl', 'hot-p-s-m': 's-m', 'y-set-s-m': 's-m',
  'lar': 'l', 'llg': 'l', 'prowler-white-blue-open-brief-lg': 'l',
  'scallop-stretch-lace-microfiber-inner-bra-babydoll-black-lg': 'l',
  'sma': 's', 'smmed': 's',
  'md': 'm', 'black-md': 'm', 'royal-md': 'm', 'cocksox-enhancing-pouch-slingshot-jet-black-md': 'm',
  // pack
  'elite-3pk': '3-pk', 'lubed-3pk': '3-pk', 'lubricated-3pk': '3-pk', 'regular-3pknon-lube': '3-pk',
  'thin-3-pack': '3-pk', '12p': '12-pk', '36p': '36-pk', 'wow-6-pack': '6-pk', 'extra-sensitive-12-pack': '12-pk',
};

// leaked flavor slug -> display name
const FLAVOR: Record<string, string> = {
  'mai-tai': 'Mai Tai', 'mimosa': 'Mimosa', 'mojito-flavored-lube': 'Mojito',
  'pina-colada-flavored-lube': 'Pina Colada', 'sex-on-the-beach-flavored-lube': 'Sex on the Beach',
  'cosmopolitan': 'Cosmopolitan', 'creme-brulee': 'Creme Brulee', 'mint-chocolate': 'Mint Chocolate',
  'coconut-pineapple': 'Coconut Pineapple', 'red-raspberry': 'Red Raspberry', 'beach-daze': 'Beach Daze',
  'sunsational': 'Sunsational', 'skinny-dip': 'Skinny Dip', 'h2o-candy-shop-bubblegum': 'Bubble Gum',
};

// leaked color slug -> display name
const COLOR: Record<string, string> = {
  'hot-pink': 'Hot Pink', 'light-pink': 'Light Pink', 'cobalt': 'Cobalt', 'garnet': 'Garnet',
  'periwinkle': 'Periwinkle', 'neon': 'Neon', 'royal': 'Royal', 'teddy-red': 'Red', 'translucent': 'Translucent',
};

async function main() {
  const db = await getConnection();
  const [terms] = await db.query<any[]>(
    `SELECT t.term_id, t.name, t.slug, tt.term_taxonomy_id ttid,
        (SELECT COUNT(*) FROM wp_term_relationships r WHERE r.term_taxonomy_id=tt.term_taxonomy_id) products
     FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy='pa_size'`);
  const ttBySlug = new Map<string, number>(); const termIdBySlug = new Map<string, number>(); const ttById = new Map<number, number>();
  for (const r of terms as any[]) { ttBySlug.set(r.slug, r.ttid); termIdBySlug.set(r.slug, r.term_id); ttById.set(r.term_id, r.ttid); }

  // existing color/flavor targets
  const [ct] = await db.query<any[]>(`SELECT t.slug, tt.taxonomy, tt.term_taxonomy_id ttid FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy IN ('pa_color','pa_flavor')`);
  const tgtTT = new Map<string, number>(); for (const r of ct as any[]) tgtTT.set(`${r.taxonomy}|${r.slug}`, r.ttid);

  const orphanTermIds: number[] = [];
  for (const r of terms as any[]) if (Number(r.products) === 0) orphanTermIds.push(r.term_id);

  // variation consolidation for MERGE (collision-guarded)
  const mergeSrc = Object.keys(MERGE).filter((s) => ttBySlug.has(s));
  const phaseB = new Map<string, number[]>(); // canonical -> meta_ids
  if (mergeSrc.length) {
    const [vars] = await db.query<any[]>(
      `SELECT pm.meta_id, p.post_parent, pm.meta_value FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation' WHERE pm.meta_key='attribute_pa_size' AND pm.meta_value IN (${mergeSrc.map(q).join(',')})`);
    const canonSet = new Set(Object.values(MERGE));
    const [existing] = await db.query<any[]>(
      `SELECT DISTINCT p.post_parent, pm.meta_value FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation' WHERE pm.meta_key='attribute_pa_size' AND pm.meta_value IN (${[...canonSet].map(q).join(',')})`);
    const present = new Set<string>(); for (const r of existing as any[]) present.add(`${r.post_parent}|${r.meta_value}`);
    for (const v of vars as any[]) { const canon = MERGE[v.meta_value]; const key = `${v.post_parent}|${canon}`; if (present.has(key)) continue; present.add(key); (phaseB.get(canon) || phaseB.set(canon, []).get(canon)!).push(v.meta_id); }
  }

  const sql: string[] = ['SET autocommit=0;', 'START TRANSACTION;', ''];

  // MERGE: repoint rels to canonical pa_size term
  sql.push('-- MERGE apparel/pack typos -> canonical pa_size');
  const removeTermIds = new Set<number>();
  for (const [src, canon] of Object.entries(MERGE)) {
    const srcTT = ttBySlug.get(src); const canonTT = ttBySlug.get(canon);
    if (srcTT == null || canonTT == null) continue;
    sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) SELECT object_id, ${canonTT}, 0 FROM wp_term_relationships WHERE term_taxonomy_id=${srcTT};`);
    sql.push(`DELETE FROM wp_term_relationships WHERE term_taxonomy_id=${srcTT};`);
    removeTermIds.add(termIdBySlug.get(src)!);
  }

  // MOVE: leaked flavor/color -> pa_flavor/pa_color (create target if missing)
  sql.push('', '-- MOVE leaked flavors/colors out of pa_size');
  let mv = 0;
  const moveOut = (map: Record<string, string>, tax: string) => {
    for (const [src, name] of Object.entries(map)) {
      const srcTT = ttBySlug.get(src); if (srcTT == null) continue;
      const tslug = slugify(name); const key = `${tax}|${tslug}`;
      let tt: string;
      if (tgtTT.has(key)) tt = String(tgtTT.get(key));
      else { mv++; sql.push(`INSERT INTO wp_terms (name, slug, term_group) VALUES (${q(name)}, ${q(tslug)}, 0);`); sql.push(`SET @j${mv} := LAST_INSERT_ID();`); sql.push(`INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (@j${mv}, ${q(tax)}, '', 0, 0);`); sql.push(`SET @jt${mv} := LAST_INSERT_ID();`); tt = `@jt${mv}`; tgtTT.set(key, -1); }
      sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) SELECT object_id, ${tt}, 0 FROM wp_term_relationships WHERE term_taxonomy_id=${srcTT};`);
      sql.push(`DELETE FROM wp_term_relationships WHERE term_taxonomy_id=${srcTT};`);
      removeTermIds.add(termIdBySlug.get(src)!);
    }
  };
  moveOut(FLAVOR, 'pa_flavor');
  moveOut(COLOR, 'pa_color');

  // Phase B: consolidate MERGE variation slugs
  sql.push('', '-- consolidate MERGE variation slugs');
  for (const [canon, ids] of phaseB) for (let i = 0; i < ids.length; i += 500) sql.push(`UPDATE wp_postmeta SET meta_value=${q(canon)} WHERE meta_id IN (${ids.slice(i, i + 500).join(',')});`);

  // DELETE orphans + emptied source terms
  sql.push('', '-- delete orphan + emptied source terms');
  const delIds = [...new Set([...orphanTermIds, ...removeTermIds])];
  if (delIds.length) {
    sql.push(`DELETE FROM wp_term_taxonomy WHERE taxonomy='pa_size' AND term_id IN (${delIds.join(',')});`);
    sql.push(`DELETE FROM wp_termmeta WHERE term_id IN (${delIds.join(',')});`);
    sql.push(`DELETE FROM wp_terms WHERE term_id IN (${delIds.join(',')}) AND term_id NOT IN (SELECT term_id FROM wp_term_taxonomy);`);
  }

  sql.push('', '-- recount');
  sql.push(`UPDATE wp_term_taxonomy tt SET count=(SELECT COUNT(*) FROM wp_term_relationships tr WHERE tr.term_taxonomy_id=tt.term_taxonomy_id) WHERE tt.taxonomy IN ('pa_size','pa_color','pa_flavor');`);
  sql.push('', 'COMMIT;');
  sql.push(`SELECT CONCAT('pa_size=',(SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='pa_size'),' pa_color=',(SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='pa_color'),' pa_flavor=',(SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='pa_flavor')) result;`);

  writeFileSync('scripts/migrate-size-junk.sql', sql.join('\n') + '\n');
  console.log('Wrote scripts/migrate-size-junk.sql');
  console.log(`  orphans deleted: ${orphanTermIds.length}`);
  console.log(`  MERGE sources: ${mergeSrc.length} (+${Object.keys(MERGE).length - mergeSrc.length} not found)`);
  console.log(`  MOVE flavors: ${Object.keys(FLAVOR).filter((s) => ttBySlug.has(s)).length}, colors: ${Object.keys(COLOR).filter((s) => ttBySlug.has(s)).length}`);
  console.log(`  terms removed total: ${delIds.length}`);
  console.log(`  statements: ${sql.filter((s) => s.trim().endsWith(';')).length}`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
