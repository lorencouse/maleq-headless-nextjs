/**
 * One-off fix for the scrambled "King Cock Cock" product line.
 *
 * Diagnosis (see the duplicate-variation / lost-axis family, ~347 products):
 *   Product 193174 "King Cock Cock" had its color × length axes scrambled at import:
 *   length numbers (6,7,8,9,10) were written into attribute_pa_color, and most
 *   variations only carried ONE of the two axes -> 24 vars collapsing to 16 combos.
 *   It also conflated THREE King Cock lines (plain / vibrating / vibrating w/ balls).
 *   A second product 443036 collides on the same slug 'king-cock-cock' (11-in + 14-in black).
 *
 * Authoritative source signal: variation image filename + Williams Trading code
 *   (PD550{len}{color}: 21=flesh, 22=tan, 29=brown, 23=black; PD540*=vibrating).
 *   Both signals agree on every variation.
 *
 * Plan (per user decisions 2026-06-12):
 *   1. 193174 becomes the clean PLAIN product: color × length, 17 plain vars
 *      + the 2 black sizes merged in from 443036 (11-in, 14-in) = 19 vars.
 *   2. Split the 5 vibrating (flesh) vars into a new "King Cock Cock Vibrating".
 *   3. Split the 2 vibrating-with-balls (flesh) vars into a new
 *      "King Cock Cock w/ Balls Vibrating".
 *   4. Trash 443036 and free the 'king-cock-cock' slug.
 *
 * Safe by default: runs everything in ONE transaction and ROLLS BACK, printing
 * the resulting state. Pass --apply to COMMIT.
 *
 * Usage:
 *   npx tsx scripts/fix-kingcock-cock.ts            # dry-run (rollback)
 *   npx tsx scripts/fix-kingcock-cock.ts --apply    # commit
 *
 * After --apply, on PROD run:
 *   wp cache flush
 *   wc tool run regenerate_product_lookup_tables
 *   wc tool run regenerate_product_attributes_lookup_table
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';
import {
  createParentProduct,
  moveVariationsToParent,
  updateVariationAttribute,
  updateParentProductAttributes,
  ensureAttributeTerm,
  linkTermToProduct,
  updateMetaLookup,
} from './lib/variant-manager/db-mutations';

const APPLY = process.argv.includes('--apply');
const PARENT = 193174;
const DUP = 443036;

// Color slug -> display name
const COLOR_NAME: Record<string, string> = { flesh: 'Flesh', tan: 'Tan', brown: 'Brown', black: 'Black' };
const LEN_NAME = (slug: string) => `${slug.replace('-in', '')} in`;

// length, color per variation (decoded from image filename + WT code, two agreeing signals)
type V = { id: number; len: string; color: string };

const PLAIN: V[] = [
  { id: 193182, len: '6-in', color: 'flesh' },
  { id: 193183, len: '6-in', color: 'tan' },
  { id: 193184, len: '6-in', color: 'brown' },
  { id: 193185, len: '7-in', color: 'flesh' },
  { id: 193186, len: '7-in', color: 'tan' },
  { id: 193187, len: '7-in', color: 'brown' },
  { id: 193188, len: '8-in', color: 'flesh' },
  { id: 193189, len: '8-in', color: 'tan' },
  { id: 193190, len: '8-in', color: 'black' },
  { id: 193191, len: '8-in', color: 'brown' },
  { id: 193192, len: '9-in', color: 'flesh' },
  { id: 193193, len: '9-in', color: 'tan' },
  { id: 193194, len: '9-in', color: 'brown' },
  { id: 193195, len: '10-in', color: 'flesh' },
  { id: 193196, len: '10-in', color: 'tan' },
  { id: 193197, len: '10-in', color: 'brown' },
  { id: 193198, len: '5-in', color: 'tan' },
];
// merged in from 443036 (both black, _wt_sku king-cock-11in/14in-cock-black)
const MERGED: V[] = [
  { id: 443038, len: '11-in', color: 'black' },
  { id: 539750, len: '14-in', color: 'black' },
];

const VIBRATING: V[] = [
  { id: 193175, len: '6-in', color: 'flesh' },
  { id: 193176, len: '7-in', color: 'flesh' },
  { id: 193177, len: '8-in', color: 'flesh' },
  { id: 193178, len: '9-in', color: 'flesh' },
  { id: 193179, len: '10-in', color: 'flesh' },
];
const VIB_THUMB = 212772; // king-cock-6-in-cock-flesh-vibrating

const VIB_BALLS: V[] = [
  { id: 193180, len: '7-in', color: 'flesh' },
  { id: 193181, len: '10-in', color: 'flesh' },
];
const VIB_BALLS_THUMB = 212783; // king-cock-7-in-cock-wballs-flesh-vibrating

/** Remove all term_relationships for a taxonomy on a product, decrementing counts. */
async function unlinkTaxonomy(db: Connection, productId: number, taxonomy: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT tr.term_taxonomy_id ttid
     FROM wp_term_relationships tr JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
     WHERE tr.object_id = ? AND tt.taxonomy = ?`,
    [productId, taxonomy]
  );
  for (const r of rows) {
    await db.query(`DELETE FROM wp_term_relationships WHERE object_id = ? AND term_taxonomy_id = ?`, [productId, r.ttid]);
    await db.query(`UPDATE wp_term_taxonomy SET count = GREATEST(count - 1, 0) WHERE term_taxonomy_id = ?`, [r.ttid]);
  }
}

/** Set a single variation's color+length attribute meta and title. */
async function setVarAttrs(db: Connection, v: V, parentTitle: string) {
  // color (current may be attribute_pa_color OR absent)
  await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key IN ('attribute_pa_color','attribute_pa_length')`, [v.id]);
  await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_color', ?)`, [v.id, v.color]);
  await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_length', ?)`, [v.id, v.len]);
  const title = `${parentTitle} - ${COLOR_NAME[v.color]}, ${LEN_NAME(v.len)}`;
  await db.query(`UPDATE wp_posts SET post_title = ? WHERE ID = ?`, [title, v.id]);
}

/** Set a length-only variation (single-axis vibrating products): length axis, no color axis meta. */
async function setVarLengthOnly(db: Connection, v: V, parentTitle: string) {
  await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key IN ('attribute_pa_color','attribute_pa_length')`, [v.id]);
  await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_length', ?)`, [v.id, v.len]);
  await db.query(`UPDATE wp_posts SET post_title = ? WHERE ID = ?`, [`${parentTitle} - ${LEN_NAME(v.len)}`, v.id]);
}

function printGrid(label: string, vars: V[]) {
  const lens = [...new Set(vars.map((v) => v.len))].sort((a, b) => parseInt(a) - parseInt(b));
  const cols = [...new Set(vars.map((v) => v.color))];
  console.log(`\n  ${label}:`);
  for (const len of lens) {
    const here = cols.filter((c) => vars.some((v) => v.len === len && v.color === c));
    console.log(`    ${len.padEnd(6)} -> ${here.join(', ')}`);
  }
}

async function main() {
  const db = await getConnection();
  await db.query('START TRANSACTION');
  try {
    // ---- 1. 193174 plain product: fix the 17 plain variations ----
    for (const v of PLAIN) await setVarAttrs(db, v, 'King Cock Cock');

    // ---- 2. Merge 443036's 2 black sizes into 193174 ----
    await moveVariationsToParent(db, MERGED.map((v) => v.id), PARENT);
    for (const v of MERGED) {
      // 539750 currently has attribute_pa_length='king'; setVarAttrs rewrites cleanly
      await setVarAttrs(db, v, 'King Cock Cock');
    }

    // 193174 product-level attributes: color × length (sorted lengths)
    const plainAll = [...PLAIN, ...MERGED];
    const plainColors = ['flesh', 'tan', 'brown', 'black'];
    const plainLens = [...new Set(plainAll.map((v) => v.len))].sort((a, b) => parseInt(a) - parseInt(b));
    await updateParentProductAttributes(db, PARENT, {
      pa_color: { name: 'pa_color', value: plainColors.join(' | '), position: 0, is_visible: 1, is_variation: 1, is_taxonomy: 1 },
      pa_length: { name: 'pa_length', value: plainLens.join(' | '), position: 1, is_visible: 1, is_variation: 1, is_taxonomy: 1 },
    });
    // Reset 193174 pa_color / pa_length term relationships to exactly what's used
    await unlinkTaxonomy(db, PARENT, 'pa_color');
    await unlinkTaxonomy(db, PARENT, 'pa_length');
    for (const c of plainColors) await linkTermToProduct(db, PARENT, await ensureAttributeTerm(db, 'pa_color', COLOR_NAME[c], c));
    for (const l of plainLens) await linkTermToProduct(db, PARENT, await ensureAttributeTerm(db, 'pa_length', LEN_NAME(l), l));
    await updateMetaLookup(db, PARENT);

    // ---- 3. New product: King Cock Cock Vibrating (flesh, length axis) ----
    const vibId = await createParentProduct(db, PARENT, 'King Cock Cock Vibrating', 'king-cock-cock-vibrating');
    await moveVariationsToParent(db, VIBRATING.map((v) => v.id), vibId);
    for (const v of VIBRATING) await setVarLengthOnly(db, v, 'King Cock Cock Vibrating');
    const vibLens = [...new Set(VIBRATING.map((v) => v.len))].sort((a, b) => parseInt(a) - parseInt(b));
    await updateParentProductAttributes(db, vibId, {
      pa_length: { name: 'pa_length', value: vibLens.join(' | '), position: 0, is_visible: 1, is_variation: 1, is_taxonomy: 1 },
      pa_color: { name: 'pa_color', value: 'flesh', position: 1, is_visible: 1, is_variation: 0, is_taxonomy: 1 },
    });
    await unlinkTaxonomy(db, vibId, 'pa_color');
    await unlinkTaxonomy(db, vibId, 'pa_length');
    await linkTermToProduct(db, vibId, await ensureAttributeTerm(db, 'pa_color', 'Flesh', 'flesh'));
    for (const l of vibLens) await linkTermToProduct(db, vibId, await ensureAttributeTerm(db, 'pa_length', LEN_NAME(l), l));
    await db.query(`UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_thumbnail_id'`, [VIB_THUMB, vibId]);
    await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key IN ('_sku','_wt_sku')`, [vibId]);
    await updateMetaLookup(db, vibId);

    // ---- 4. New product: King Cock Cock w/ Balls Vibrating ----
    const vbId = await createParentProduct(db, PARENT, 'King Cock Cock w/ Balls Vibrating', 'king-cock-cock-w-balls-vibrating');
    await moveVariationsToParent(db, VIB_BALLS.map((v) => v.id), vbId);
    for (const v of VIB_BALLS) await setVarLengthOnly(db, v, 'King Cock Cock w/ Balls Vibrating');
    const vbLens = [...new Set(VIB_BALLS.map((v) => v.len))].sort((a, b) => parseInt(a) - parseInt(b));
    await updateParentProductAttributes(db, vbId, {
      pa_length: { name: 'pa_length', value: vbLens.join(' | '), position: 0, is_visible: 1, is_variation: 1, is_taxonomy: 1 },
      pa_color: { name: 'pa_color', value: 'flesh', position: 1, is_visible: 1, is_variation: 0, is_taxonomy: 1 },
    });
    await unlinkTaxonomy(db, vbId, 'pa_color');
    await unlinkTaxonomy(db, vbId, 'pa_length');
    await linkTermToProduct(db, vbId, await ensureAttributeTerm(db, 'pa_color', 'Flesh', 'flesh'));
    for (const l of vbLens) await linkTermToProduct(db, vbId, await ensureAttributeTerm(db, 'pa_length', LEN_NAME(l), l));
    await db.query(`UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_thumbnail_id'`, [VIB_BALLS_THUMB, vbId]);
    await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key IN ('_sku','_wt_sku')`, [vbId]);
    await updateMetaLookup(db, vbId);

    // ---- 5. Trash 443036 and free the slug ----
    await db.query(`UPDATE wp_posts SET post_status = 'trash', post_name = 'king-cock-cock-443036-trashed' WHERE ID = ?`, [DUP]);

    // ---- Verify (inside txn) ----
    const [pCount] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) c FROM wp_posts WHERE post_parent = ? AND post_type='product_variation'`, [PARENT]);
    console.log('\n================ RESULTING STATE (in transaction) ================');
    console.log(`193174 "King Cock Cock" -> ${pCount[0].c} variations`);
    printGrid('193174 grid', plainAll);
    console.log(`\n${vibId} "King Cock Cock Vibrating" -> ${VIBRATING.length} variations (flesh): ${vibLens.join(', ')}`);
    console.log(`${vbId} "King Cock Cock w/ Balls Vibrating" -> ${VIB_BALLS.length} variations (flesh): ${vbLens.join(', ')}`);
    console.log(`443036 -> trashed, slug freed`);

    // duplicate-combo check on 193174
    const [combos] = await db.query<RowDataPacket[]>(
      `SELECT v.ID, MAX(CASE WHEN pm.meta_key='attribute_pa_color' THEN pm.meta_value END) col,
              MAX(CASE WHEN pm.meta_key='attribute_pa_length' THEN pm.meta_value END) len
       FROM wp_posts v JOIN wp_postmeta pm ON pm.post_id=v.ID AND pm.meta_key LIKE 'attribute_%'
       WHERE v.post_parent=? AND v.post_type='product_variation' GROUP BY v.ID`, [PARENT]);
    const seen = new Set<string>(); let dups = 0;
    for (const r of combos as any[]) { const k = `${r.col}|${r.len}`; if (seen.has(k)) dups++; seen.add(k); }
    console.log(`\n193174 duplicate combos after fix: ${dups} (expect 0)`);

    if (APPLY) {
      await db.query('COMMIT');
      console.log('\n✅ COMMITTED.');
      console.log('Next, on PROD: wp cache flush; wc tool run regenerate_product_lookup_tables; wc tool run regenerate_product_attributes_lookup_table');
    } else {
      await db.query('ROLLBACK');
      console.log('\n🔄 DRY RUN — rolled back. Re-run with --apply to commit.');
    }
  } catch (e) {
    await db.query('ROLLBACK');
    console.error('\n❌ Error — rolled back.', e);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
main();
