/**
 * Batch fix for the "lost axis" family — BULLETS / PUMPS / SINGLE-ITEM group.
 *
 * Mostly color-axis products where the scramble left numbers / bulk-pack values in pa_color.
 * Reconstructed from descriptive _wt_sku + image filenames.
 *
 * Scope of THIS batch:
 *   195101  Pumped Basic Pump        pa_size(1,2) × pa_color(8)  — the "1"/"2" were pump sizes, not colors
 *   194952  Ouch! Fluffy Handcuffs   pa_color (17 colors/patterns) — fixes real dup collisions:
 *                                    powder-blue/green/pink were mislabeled plain blue/green/pink,
 *                                    "1"/"2" are multicolor-1/2 patterns, "leopard" is really tiger
 *   191702  Jaguar Powerful Bullet   pa_color(blue,pink,purple,yellow) + 12-pc display -> "multicolor"
 *   195777  Vedo Nitro Recharg Bullet pa_color(black,pink,purple,turquoise) + 16-pc assorted -> "multicolor"
 *
 * Deferred (need decisions):
 *   190403 Jimmyjane Reflexx Rabbit — 3rd color unknown (image just "-3-")
 *   447849 Womanizer Liberty        — duplicate "...-2" variations, ambiguous colors
 *   193362 Pdx Elite Moto Bator     — different MODELS merged (Moto Bator / 2 / X), not colors
 *   189385 Rock Solid Ez Top        — color-coded SIZES (S/M/L) + a set-of-3 bundle + stray "top"
 *
 * Safe by default: ONE transaction, ROLLS BACK + prints grids. Pass --apply to COMMIT.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';
import { updateParentProductAttributes, ensureAttributeTerm, linkTermToProduct, updateMetaLookup } from './lib/variant-manager/db-mutations';

const APPLY = process.argv.includes('--apply');
const cap = (s: string) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const SIZE_ORDER = ['xs', 's', 's-m', 'm', 'm-l', 'l', 'l-xl', 'xl', '1xl-2xl', '2xl', '3xl-4xl'];
const sizeIdx = (s: string) => (/^\d+$/.test(s) ? Number(s) : (SIZE_ORDER.indexOf(s) === -1 ? 99 : 100 + SIZE_ORDER.indexOf(s)));

type Var = { id: number; color?: string; size?: string; note?: string };

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
  if (v.size) { await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_size', ?)`, [v.id, v.size]); parts.push(`Size ${v.size.toUpperCase()}`); }
  if (v.color) { await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_color', ?)`, [v.id, v.color]); parts.push(cap(v.color)); }
  if (v.note) parts.push(v.note);
  await db.query(`UPDATE wp_posts SET post_title = ? WHERE ID = ?`, [`${title} - ${parts.join(', ')}`, v.id]);
}

async function fixInPlace(db: Connection, id: number, title: string, vars: Var[], variationAxes: ('color' | 'size')[]) {
  for (const v of vars) await setVar(db, v, title);
  const colors = [...new Set(vars.map((v) => v.color).filter(Boolean) as string[])];
  const sizes = [...new Set(vars.map((v) => v.size).filter(Boolean) as string[])].sort((a, b) => sizeIdx(a) - sizeIdx(b));
  const attrs: Record<string, any> = {}; let pos = 0;
  if (variationAxes.includes('size') && sizes.length) attrs.pa_size = { name: 'pa_size', value: sizes.join(' | '), position: pos++, is_visible: 1, is_variation: 1, is_taxonomy: 1 };
  if (variationAxes.includes('color') && colors.length) attrs.pa_color = { name: 'pa_color', value: colors.join(' | '), position: pos++, is_visible: 1, is_variation: 1, is_taxonomy: 1 };
  await updateParentProductAttributes(db, id, attrs);
  await unlinkTaxonomy(db, id, 'pa_color');
  await unlinkTaxonomy(db, id, 'pa_size');
  if (variationAxes.includes('color')) for (const c of colors) await linkTermToProduct(db, id, await ensureAttributeTerm(db, 'pa_color', cap(c), c));
  if (variationAxes.includes('size')) for (const s of sizes) await linkTermToProduct(db, id, await ensureAttributeTerm(db, 'pa_size', s.toUpperCase(), s));
  await updateMetaLookup(db, id);
}

const dup = (vars: Var[]) => { const seen = new Set<string>(); let d = 0; for (const v of vars) { const k = `${v.color || ''}|${v.size || ''}`; if (seen.has(k)) d++; seen.add(k); } return d; };

// ---------------- specs ----------------
const PUMP: Var[] = (() => {
  const colors = ['black', 'blue', 'green', 'orange', 'purple', 'red', 'yellow', 'clear'];
  const s1 = [195102, 195103, 195104, 195105, 195106, 195107, 195108, 195109];
  const s2 = [195111, 195112, 195113, 195114, 195115, 195116, 195117, 195118];
  const out: Var[] = [];
  colors.forEach((c, i) => { out.push({ id: s1[i], size: '1', color: c }); out.push({ id: s2[i], size: '2', color: c }); });
  return out;
})();
const HANDCUFFS: Var[] = [
  { id: 194953, color: 'blue' }, { id: 194954, color: 'green' }, { id: 194955, color: 'lavender' }, { id: 194956, color: 'navy' },
  { id: 194957, color: 'orange' }, { id: 194958, color: 'pink' }, { id: 194959, color: 'red' }, { id: 194960, color: 'white' },
  { id: 194961, color: 'yellow' }, { id: 194962, color: 'burgundy' }, { id: 194963, color: 'multicolor-1' }, { id: 194964, color: 'multicolor-2' },
  { id: 194965, color: 'powder-blue' }, { id: 194966, color: 'powder-green' }, { id: 194967, color: 'powder-pink' },
  { id: 194968, color: 'snow-leopard' }, { id: 194969, color: 'tiger' },
];
const JAGUAR: Var[] = [
  { id: 191704, color: 'blue' }, { id: 191705, color: 'pink' }, { id: 191706, color: 'purple' }, { id: 191707, color: 'yellow' },
  { id: 191703, color: 'multicolor', note: '12 Pc Display' },
];
const VEDO: Var[] = [
  { id: 195779, color: 'black' }, { id: 195780, color: 'pink' }, { id: 195781, color: 'purple' }, { id: 540541, color: 'turquoise' },
  { id: 195778, color: 'multicolor', note: '16 Pc Assorted Display' },
];

async function main() {
  const db = await getConnection();
  await db.query('START TRANSACTION');
  try {
    await fixInPlace(db, 195101, 'Pumped Basic Pump', PUMP, ['size', 'color']);
    await fixInPlace(db, 194952, 'Ouch! Heavy Duty Fluffy Handcuffs', HANDCUFFS, ['color']);
    await fixInPlace(db, 191702, 'Jaguar Powerful Bullet', JAGUAR, ['color']);
    await fixInPlace(db, 195777, 'Vedo Nitro Recharg Bullet', VEDO, ['color']);

    console.log('\n================ RESULTING STATE (in transaction) ================');
    for (const [id, label, vars] of [[195101, 'Pumped Basic Pump (size×color)', PUMP], [194952, 'Ouch Handcuffs (color)', HANDCUFFS], [191702, 'Jaguar Bullet (color)', JAGUAR], [195777, 'Vedo Nitro (color)', VEDO]] as [number, string, Var[]][]) {
      const [cnt] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) c FROM wp_posts WHERE post_parent=? AND post_type='product_variation'`, [id]);
      const colors = [...new Set(vars.map((v) => v.color).filter(Boolean))];
      const sizes = [...new Set(vars.map((v) => v.size).filter(Boolean))];
      console.log(`\n${id} "${label}" -> ${cnt[0].c} vars, dup-combos=${dup(vars)}`);
      if (sizes.length) console.log(`   sizes: ${sizes.join(', ')}`);
      console.log(`   colors: ${colors.join(', ')}`);
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
