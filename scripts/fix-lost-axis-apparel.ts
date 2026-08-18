/**
 * Batch fix for the "lost axis" family — APPAREL group (size × color).
 *
 * Same scramble as the toy batch, but the numbers/sizes were dumped into pa_color and the
 * real axes are apparel-size (pa_size) × color. True values reconstructed from the descriptive
 * _wt_sku (e.g. malebasics-...-red-2xl) and image filenames; supplier codes (MSM###/DG####)
 * decoded by their COLOR+SIZE suffix.
 *
 * Scope of THIS batch (clean, no color-vocab guesses needed):
 *   472131  Fantasy Lingerie Tease Parker      size-only (black fixed): M-L,L-XL,1XL-2XL,3XL-4XL
 *   472153  Fantasy Lingerie Tease Vaughn      size-only (red fixed):   S-M,M-L,L-XL,1XL-2XL,3XL-4XL
 *   594529  Open Crotch Panty                  size-only (black fixed): M,L,XL,2XL
 *   543816  Risque Business Garter & Panty     color×size: black/red × M,L,2XL
 *   191380  Sassy Bra Garter & Rouched Panty   color×size: black/blue × L,2XL
 *
 * Deferred (need decisions, NOT in this batch):
 *   468393 / 468431 Malebasics Bikini/Tanga — many fashion colors incl. neon-green/metal-green
 *                                              (missing terms); all OOS -> handle with color vocab.
 *   188902 Bodystocking — 7+ distinct bodystocking STYLES merged as fake variations -> needs splitting.
 *
 * Safe by default: ONE transaction, ROLLS BACK + prints grids. Pass --apply to COMMIT.
 *   npx tsx scripts/fix-lost-axis-apparel.ts            # dry-run
 *   npx tsx scripts/fix-lost-axis-apparel.ts --apply    # commit
 * After --apply, on PROD: wp cache flush; wc tool run regenerate_product_lookup_tables;
 *                         wc tool run regenerate_product_attributes_lookup_table
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';
import { updateParentProductAttributes, ensureAttributeTerm, linkTermToProduct, updateMetaLookup } from './lib/variant-manager/db-mutations';

const APPLY = process.argv.includes('--apply');

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sizeName = (slug: string) => slug.toUpperCase().replace(/-/g, '-'); // "1xl-2xl" -> "1XL-2XL"
const SIZE_ORDER = ['xs', 's', 's-m', 'm', 'm-l', 'l', 'l-xl', 'xl', '1xl-2xl', '2xl', '3xl-4xl', '3xl', '4xl'];
const sizeIdx = (s: string) => { const i = SIZE_ORDER.indexOf(s); return i === -1 ? 99 : i; };

type Var = { id: number; color?: string; size?: string };

async function unlinkTaxonomy(db: Connection, productId: number, taxonomy: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT tr.term_taxonomy_id ttid FROM wp_term_relationships tr
     JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
     WHERE tr.object_id = ? AND tt.taxonomy = ?`, [productId, taxonomy]);
  for (const r of rows) {
    await db.query(`DELETE FROM wp_term_relationships WHERE object_id = ? AND term_taxonomy_id = ?`, [productId, r.ttid]);
    await db.query(`UPDATE wp_term_taxonomy SET count = GREATEST(count - 1, 0) WHERE term_taxonomy_id = ?`, [r.ttid]);
  }
}

async function setVar(db: Connection, v: Var, title: string) {
  await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key IN ('attribute_pa_color','attribute_pa_size')`, [v.id]);
  const parts: string[] = [];
  if (v.color) { await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_color', ?)`, [v.id, v.color]); parts.push(cap(v.color)); }
  if (v.size) { await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_size', ?)`, [v.id, v.size]); parts.push(sizeName(v.size)); }
  await db.query(`UPDATE wp_posts SET post_title = ? WHERE ID = ?`, [`${title} - ${parts.join(', ')}`, v.id]);
}

async function fixInPlace(db: Connection, id: number, title: string, vars: Var[], opts: {
  variationAxes: ('color' | 'size')[]; fixed?: { color?: string; size?: string };
}) {
  for (const v of vars) await setVar(db, v, title);
  const colors = [...new Set(vars.map((v) => v.color).filter(Boolean) as string[])];
  const sizes = [...new Set(vars.map((v) => v.size).filter(Boolean) as string[])].sort((a, b) => sizeIdx(a) - sizeIdx(b));
  const colorVar = opts.variationAxes.includes('color');
  const sizeVar = opts.variationAxes.includes('size');
  const colorVals = colorVar ? colors : opts.fixed?.color ? [opts.fixed.color] : [];
  const sizeVals = sizeVar ? sizes : opts.fixed?.size ? [opts.fixed.size] : [];
  const attrs: Record<string, any> = {}; let pos = 0;
  if (sizeVals.length) attrs.pa_size = { name: 'pa_size', value: sizeVals.join(' | '), position: pos++, is_visible: 1, is_variation: sizeVar ? 1 : 0, is_taxonomy: 1 };
  if (colorVals.length) attrs.pa_color = { name: 'pa_color', value: colorVals.join(' | '), position: pos++, is_visible: 1, is_variation: colorVar ? 1 : 0, is_taxonomy: 1 };
  await updateParentProductAttributes(db, id, attrs);
  await unlinkTaxonomy(db, id, 'pa_color');
  await unlinkTaxonomy(db, id, 'pa_size');
  for (const c of colorVals) await linkTermToProduct(db, id, await ensureAttributeTerm(db, 'pa_color', cap(c), c));
  for (const s of sizeVals) await linkTermToProduct(db, id, await ensureAttributeTerm(db, 'pa_size', sizeName(s), s));
  await updateMetaLookup(db, id);
}

function grid(label: string, vars: Var[]) {
  const sizes = [...new Set(vars.map((v) => v.size || '(fixed)'))].sort((a, b) => sizeIdx(a) - sizeIdx(b));
  console.log(`  ${label}:`);
  for (const s of sizes) console.log(`    ${String(sizeName(s)).padEnd(9)} -> ${vars.filter((v) => (v.size || '(fixed)') === s).map((v) => v.color || '-').join(', ')}`);
}

// ---------------- Reconstructed specs ----------------
const PARKER: Var[] = [ // 472131 — all black, size axis
  { id: 472130, size: 'm-l' }, { id: 536724, size: 'l-xl' }, { id: 540766, size: '1xl-2xl' }, { id: 540767, size: '3xl-4xl' },
];
const VAUGHN: Var[] = [ // 472153 — all red, size axis
  { id: 472151, size: 's-m' }, { id: 472152, size: 'm-l' }, { id: 536218, size: 'l-xl' }, { id: 540770, size: '1xl-2xl' }, { id: 540771, size: '3xl-4xl' },
];
const OPEN_CROTCH: Var[] = [ // 594529 — all black, size axis (DG1442BK..)
  { id: 542477, size: 'm' }, { id: 542475, size: 'l' }, { id: 542476, size: 'xl' }, { id: 542478, size: '2xl' },
];
const RISQUE: Var[] = [ // 543816 — color×size (MSM224 + COLOR + SIZE)
  { id: 543817, color: 'black', size: 'm' }, { id: 543818, color: 'red', size: 'm' },
  { id: 543820, color: 'red', size: 'l' }, { id: 543819, color: 'red', size: '2xl' },
];
const SASSY: Var[] = [ // 191380 — color×size (MSM260 + COLOR + SIZE); cobalt-blue -> blue
  { id: 191381, color: 'black', size: '2xl' }, { id: 191382, color: 'blue', size: '2xl' }, { id: 191383, color: 'blue', size: 'l' },
];

async function main() {
  const db = await getConnection();
  await db.query('START TRANSACTION');
  try {
    await fixInPlace(db, 472131, 'Fantasy Lingerie Tease Parker Gartered Lace Bustier & Panty', PARKER, { variationAxes: ['size'], fixed: { color: 'black' } });
    await fixInPlace(db, 472153, 'Fantasy Lingerie Tease Vaughn Harness Bralette, Gartered Skirt & G-String', VAUGHN, { variationAxes: ['size'], fixed: { color: 'red' } });
    await fixInPlace(db, 594529, 'Open Crotch Panty', OPEN_CROTCH, { variationAxes: ['size'], fixed: { color: 'black' } });
    await fixInPlace(db, 543816, 'Risque Business Cupless B Garter & Crotchless Panty Set', RISQUE, { variationAxes: ['color', 'size'] });
    await fixInPlace(db, 191380, 'Sassy Bra Garter & Rouched Panty', SASSY, { variationAxes: ['color', 'size'] });

    console.log('\n================ RESULTING STATE (in transaction) ================');
    const checks: [number, string, Var[]][] = [
      [472131, 'Fantasy Parker (size-only, black)', PARKER], [472153, 'Fantasy Vaughn (size-only, red)', VAUGHN],
      [594529, 'Open Crotch Panty (size-only, black)', OPEN_CROTCH], [543816, 'Risque Business', RISQUE], [191380, 'Sassy Bra Garter', SASSY],
    ];
    for (const [id, label, vars] of checks) {
      const [cnt] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) c FROM wp_posts WHERE post_parent=? AND post_type='product_variation'`, [id]);
      const seen = new Set<string>(); let dups = 0;
      for (const v of vars) { const k = `${v.color || ''}|${v.size || ''}`; if (seen.has(k)) dups++; seen.add(k); }
      console.log(`\n${id} "${label}" -> ${cnt[0].c} vars in DB, ${vars.length} reconstructed, dup-combos=${dups}`);
      grid(`${id}`, vars);
    }

    if (APPLY) {
      await db.query('COMMIT');
      console.log('\n✅ COMMITTED.');
      console.log('PROD follow-up: wp cache flush; wc tool run regenerate_product_lookup_tables; wc tool run regenerate_product_attributes_lookup_table');
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
