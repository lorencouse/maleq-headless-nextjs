/**
 * Decision A — split batch 1 (+ one reclassified 2-axis fix).
 * Authoritative names/colors/sizes resolved from the STC source feed (data/product-feeds/stc-product-feed.csv).
 *
 *   445034 Femme Funn Ultra Wand  → SPLIT: keep "Femme Funn Ultra Wand" (full: Purple, Turquoise);
 *                                   create "Femme Funn Ultra Wand Mini" (Purple, Turquoise, Pink).
 *   193841 Ring O Pro             → NOT merged models — feed shows Large/XL/XXL × black/blue/red.
 *                                   In-place pa_size × pa_color fix (no split).
 *
 * (188500 Gaia Eco = 3 distinct single-SKU products → needs variation→SIMPLE conversion mechanic; deferred.)
 *
 * Femme Funn creates 1 product → NON-IDEMPOTENT, run once. Ring O Pro part is idempotent.
 * Safe by default: ONE transaction, ROLLS BACK + prints. Pass --apply to COMMIT.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';
import { createParentProduct, moveVariationsToParent, updateParentProductAttributes, ensureAttributeTerm, linkTermToProduct, updateMetaLookup } from './lib/variant-manager/db-mutations';

const APPLY = process.argv.includes('--apply');
const cap = (s: string) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const sizeName = (s: string) => ({ large: 'Large', xl: 'XL', xxl: 'XXL' } as Record<string, string>)[s] || s.toUpperCase();

async function unlinkTaxonomy(db: Connection, pid: number, tax: string) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT tr.term_taxonomy_id ttid FROM wp_term_relationships tr JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id=tt.term_taxonomy_id WHERE tr.object_id=? AND tt.taxonomy=?`, [pid, tax]);
  for (const r of rows) { await db.query(`DELETE FROM wp_term_relationships WHERE object_id=? AND term_taxonomy_id=?`, [pid, r.ttid]); await db.query(`UPDATE wp_term_taxonomy SET count=GREATEST(count-1,0) WHERE term_taxonomy_id=?`, [r.ttid]); }
}
const CLR = ['attribute_pa_color', 'attribute_pa_size', 'attribute_pa_length'];
async function setColorVar(db: Connection, id: number, color: string, title: string) {
  await db.query(`DELETE FROM wp_postmeta WHERE post_id=? AND meta_key IN (${CLR.map(() => '?').join(',')})`, [id, ...CLR]);
  await db.query(`INSERT INTO wp_postmeta (post_id,meta_key,meta_value) VALUES (?, 'attribute_pa_color', ?)`, [id, color]);
  await db.query(`UPDATE wp_posts SET post_title=? WHERE ID=?`, [`${title} - ${cap(color)}`, id]);
}
async function setSizeColorVar(db: Connection, id: number, size: string, color: string, title: string) {
  await db.query(`DELETE FROM wp_postmeta WHERE post_id=? AND meta_key IN (${CLR.map(() => '?').join(',')})`, [id, ...CLR]);
  await db.query(`INSERT INTO wp_postmeta (post_id,meta_key,meta_value) VALUES (?, 'attribute_pa_size', ?)`, [id, size]);
  await db.query(`INSERT INTO wp_postmeta (post_id,meta_key,meta_value) VALUES (?, 'attribute_pa_color', ?)`, [id, color]);
  await db.query(`UPDATE wp_posts SET post_title=? WHERE ID=?`, [`${title} - ${sizeName(size)}, ${cap(color)}`, id]);
}
async function colorAxis(db: Connection, pid: number, colors: string[], thumb: number) {
  await updateParentProductAttributes(db, pid, { pa_color: { name: 'pa_color', value: colors.join(' | '), position: 0, is_visible: 1, is_variation: 1, is_taxonomy: 1 } });
  await unlinkTaxonomy(db, pid, 'pa_color'); await unlinkTaxonomy(db, pid, 'pa_length'); await unlinkTaxonomy(db, pid, 'pa_size');
  for (const c of colors) await linkTermToProduct(db, pid, await ensureAttributeTerm(db, 'pa_color', cap(c), c));
  await db.query(`UPDATE wp_postmeta SET meta_value=? WHERE post_id=? AND meta_key='_thumbnail_id'`, [thumb, pid]);
  await updateMetaLookup(db, pid);
}

async function main() {
  const db = await getConnection();
  await db.query('START TRANSACTION');
  try {
    // ---- Femme Funn split ----
    const miniId = await createParentProduct(db, 445034, 'Femme Funn Ultra Wand Mini', 'femme-funn-ultra-wand-mini');
    await moveVariationsToParent(db, [445035, 539625, 445036], miniId);
    await setColorVar(db, 445035, 'purple', 'Femme Funn Ultra Wand Mini');
    await setColorVar(db, 539625, 'turquoise', 'Femme Funn Ultra Wand Mini');
    await setColorVar(db, 445036, 'pink', 'Femme Funn Ultra Wand Mini');
    await db.query(`DELETE FROM wp_postmeta WHERE post_id=? AND meta_key IN ('_sku','_wt_sku')`, [miniId]);
    await colorAxis(db, miniId, ['purple', 'turquoise', 'pink'], 485291);
    // full wand keeps 537687(purple), 478535(turquoise)
    await setColorVar(db, 537687, 'purple', 'Femme Funn Ultra Wand');
    await setColorVar(db, 478535, 'turquoise', 'Femme Funn Ultra Wand');
    await colorAxis(db, 445034, ['purple', 'turquoise'], 532116);

    // ---- Ring O Pro: size × color (Large/XL/XXL × black/blue/red) ----
    const RP: [number, string, string][] = [
      [193842, 'large', 'black'], [193843, 'large', 'blue'], [193844, 'large', 'red'],
      [193847, 'xl', 'black'], [193848, 'xl', 'blue'], [193849, 'xl', 'red'],
      [193845, 'xxl', 'black'], [193846, 'xxl', 'blue'],
    ];
    for (const [id, s, c] of RP) await setSizeColorVar(db, id, s, c, 'Ring O Pro');
    const sizes = ['large', 'xl', 'xxl'], colors = ['black', 'blue', 'red'];
    await updateParentProductAttributes(db, 193841, {
      pa_size: { name: 'pa_size', value: sizes.join(' | '), position: 0, is_visible: 1, is_variation: 1, is_taxonomy: 1 },
      pa_color: { name: 'pa_color', value: colors.join(' | '), position: 1, is_visible: 1, is_variation: 1, is_taxonomy: 1 },
    });
    await unlinkTaxonomy(db, 193841, 'pa_length'); await unlinkTaxonomy(db, 193841, 'pa_size'); await unlinkTaxonomy(db, 193841, 'pa_color');
    for (const s of sizes) await linkTermToProduct(db, 193841, await ensureAttributeTerm(db, 'pa_size', sizeName(s), s));
    for (const c of colors) await linkTermToProduct(db, 193841, await ensureAttributeTerm(db, 'pa_color', cap(c), c));
    await updateMetaLookup(db, 193841);

    // ---- verify ----
    console.log('\n================ RESULTING STATE (in transaction) ================');
    for (const [id, label] of [[445034, 'Femme Funn Ultra Wand (full)'], [miniId, 'Femme Funn Ultra Wand Mini (NEW)'], [193841, 'Ring O Pro']] as [number, string][]) {
      const [vs] = await db.query<RowDataPacket[]>(`SELECT v.ID, MAX(CASE WHEN pm.meta_key='attribute_pa_color' THEN pm.meta_value END) col, MAX(CASE WHEN pm.meta_key='attribute_pa_size' THEN pm.meta_value END) sz FROM wp_posts v LEFT JOIN wp_postmeta pm ON pm.post_id=v.ID AND pm.meta_key LIKE 'attribute_%' WHERE v.post_parent=? AND v.post_type='product_variation' GROUP BY v.ID`, [id]);
      const seen = new Set<string>(); let dup = 0;
      const combos = (vs as any[]).map((r) => { const k = `${r.sz || ''}|${r.col || ''}`; if (seen.has(k)) dup++; seen.add(k); return r.sz ? `${r.sz}/${r.col}` : r.col; });
      console.log(`${id} "${label}" -> ${vs.length} vars, dup=${dup} :: ${combos.join(', ')}`);
    }
    if (APPLY) { await db.query('COMMIT'); console.log('\n✅ COMMITTED.\nPROD follow-up: wp cache flush; wc tool run regenerate_product_lookup_tables; wc tool run regenerate_product_attributes_lookup_table'); }
    else { await db.query('ROLLBACK'); console.log('\n🔄 DRY RUN — rolled back. Re-run with --apply to commit.'); }
  } catch (e) { await db.query('ROLLBACK'); console.error('\n❌ Error — rolled back.', e); process.exitCode = 1; }
  finally { await db.end(); }
}
main();
