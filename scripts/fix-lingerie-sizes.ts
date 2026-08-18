/**
 * Decision D, batch 1 — restore real apparel sizes from the STC source feed.
 *
 * These lingerie products had pa_size polluted with toy dimension-strings / oz (real size LOST).
 * The authoritative size is in the STC feed Product Name suffix (e.g. "... S/m", "... Queen",
 * "... O/s", "... 1x", "... Large"). Verified each via data/product-feeds/stc-product-feed.csv (UPC lookup).
 *
 * THIS batch = single-color products, pure pa_size axis (color set as a fixed visible attribute):
 *   594402 Vinyl Bikini... (Red)          M/L, S/M
 *   470872 Magic Silk Peek-a-Boo (Black)  L/XL, Queen, S/M
 *   470881 Magic Silk Tanga (Red)         L/XL, Queen, S/M
 *   594488 Male Power Sassy Jock (Black)  S/M, L/XL
 *   594494 Teacher's Pet Tie Top (Black)  One-Size, 1X
 *   474588 Teacher's Pet Tie Top (White)  One-Size, 1X
 *   594541 Sugar & Spice (Red)            Queen, L/XL, S/M
 *   191043 Mini Short Sheer Lips (Black)  S, M, L, XL
 *
 * Deferred to later D batches: size×color (188767 G String, 188855 Sheer Thigh High, 193563,
 *   543726, 544648, 191294, 542516, 545425) and merged-styles (188890 Body Stocking → Decision A),
 *   plus truncated-name 188933, and 190987/192098/187845 (not in STC / not apparel).
 *
 * Safe by default: ONE transaction, ROLLS BACK + prints. Pass --apply to COMMIT. Idempotent.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';
import { updateParentProductAttributes, ensureAttributeTerm, linkTermToProduct, updateMetaLookup } from './lib/variant-manager/db-mutations';

const APPLY = process.argv.includes('--apply');
const SIZE_ORDER = ['xs', 's', 's-m', 'm', 'm-l', 'l', 'l-xl', 'xl', '1x', 'xxl', 'queen', 'one-size', 'plus', 'petite'];
const sizeIdx = (s: string) => { const i = SIZE_ORDER.indexOf(s); return i === -1 ? 99 : i; };
const sizeName = (s: string) => ({ 'one-size': 'One Size', 's-m': 'S/M', 'm-l': 'M/L', 'l-xl': 'L/XL', '1x': '1X', xxl: 'XXL' } as Record<string, string>)[s] || s.toUpperCase();
const cap = (s: string) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const CLR = ['attribute_pa_size', 'attribute_pa_length', 'attribute_pa_color'];

async function unlinkTaxonomy(db: Connection, pid: number, tax: string) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT tr.term_taxonomy_id ttid FROM wp_term_relationships tr JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id=tt.term_taxonomy_id WHERE tr.object_id=? AND tt.taxonomy=?`, [pid, tax]);
  for (const r of rows) { await db.query(`DELETE FROM wp_term_relationships WHERE object_id=? AND term_taxonomy_id=?`, [pid, r.ttid]); await db.query(`UPDATE wp_term_taxonomy SET count=GREATEST(count-1,0) WHERE term_taxonomy_id=?`, [r.ttid]); }
}
async function setVar(db: Connection, id: number, size: string, title: string, color: string) {
  await db.query(`DELETE FROM wp_postmeta WHERE post_id=? AND meta_key IN (${CLR.map(() => '?').join(',')})`, [id, ...CLR]);
  await db.query(`INSERT INTO wp_postmeta (post_id,meta_key,meta_value) VALUES (?, 'attribute_pa_size', ?)`, [id, size]);
  await db.query(`UPDATE wp_posts SET post_title=? WHERE ID=?`, [`${title} - ${sizeName(size)}`, id]);
}
type Job = { id: number; title: string; color: string; vars: [number, string][] };
async function fix(db: Connection, j: Job) {
  for (const [id, sz] of j.vars) await setVar(db, id, sz, j.title, j.color);
  const sizes = [...new Set(j.vars.map((v) => v[1]))].sort((a, b) => sizeIdx(a) - sizeIdx(b));
  await updateParentProductAttributes(db, j.id, {
    pa_size: { name: 'pa_size', value: sizes.join(' | '), position: 0, is_visible: 1, is_variation: 1, is_taxonomy: 1 },
    pa_color: { name: 'pa_color', value: j.color, position: 1, is_visible: 1, is_variation: 0, is_taxonomy: 1 },
  });
  for (const t of CLR.map((c) => c.replace('attribute_', ''))) await unlinkTaxonomy(db, j.id, t);
  for (const s of sizes) await linkTermToProduct(db, j.id, await ensureAttributeTerm(db, 'pa_size', sizeName(s), s));
  await linkTermToProduct(db, j.id, await ensureAttributeTerm(db, 'pa_color', cap(j.color), j.color));
  await updateMetaLookup(db, j.id);
}

const JOBS: Job[] = [
  { id: 594402, title: 'Vinyl Bikini Top, Heart Accent G-String Garter Belt Red', color: 'red', vars: [[540563, 'm-l'], [457981, 's-m']] },
  { id: 470872, title: 'Magic Silk Ooh La Lace Peek-a-Boo Cheeky Panty', color: 'black', vars: [[536093, 'l-xl'], [538407, 'queen'], [470871, 's-m']] },
  { id: 470881, title: 'Magic Silk Ooh La Lace Cross Strap Split Crotch Tanga', color: 'red', vars: [[470884, 'l-xl'], [470885, 'queen'], [470883, 's-m']] },
  { id: 594488, title: 'Male Power Sassy Lace Skirt Jock Black', color: 'black', vars: [[536260, 's-m'], [539934, 'l-xl']] },
  { id: 594494, title: "Teacher's Pet School Girl Tie Top Black", color: 'black', vars: [[537416, 'one-size'], [539307, '1x']] },
  { id: 474588, title: "Teacher's Pet School Girl Tie Top White", color: 'white', vars: [[539308, '1x'], [474589, 'one-size']] },
  { id: 594541, title: 'Magic Silk Sugar & Spice Ribbon-Tie Bra & Panty Set', color: 'red', vars: [[543849, 'queen'], [543852, 'l-xl'], [543853, 's-m']] },
  { id: 191043, title: 'Male Power Kiss Me Mini Short Sheer Lips', color: 'black', vars: [[191044, 'l'], [191045, 'm'], [191046, 's'], [191047, 'xl']] },
];

async function main() {
  const db = await getConnection();
  await db.query('START TRANSACTION');
  try {
    for (const j of JOBS) await fix(db, j);
    console.log('\n================ RESULTING STATE (in transaction) ================');
    for (const j of JOBS) {
      const [cnt] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) c FROM wp_posts WHERE post_parent=? AND post_type='product_variation'`, [j.id]);
      const sizes = [...new Set(j.vars.map((v) => v[1]))].sort((a, b) => sizeIdx(a) - sizeIdx(b));
      const dup = j.vars.length - new Set(j.vars.map((v) => v[1])).size;
      console.log(`${j.id} "${j.title.slice(0, 42)}" -> ${cnt[0].c} vars, ${j.vars.length} fixed, dup=${dup} | ${j.color} × size[${sizes.map(sizeName).join(', ')}]`);
    }
    if (APPLY) { await db.query('COMMIT'); console.log('\n✅ COMMITTED.\nPROD follow-up: wp cache flush; wc tool run regenerate_product_lookup_tables; wc tool run regenerate_product_attributes_lookup_table'); }
    else { await db.query('ROLLBACK'); console.log('\n🔄 DRY RUN — rolled back. Re-run with --apply to commit.'); }
  } catch (e) { await db.query('ROLLBACK'); console.error('\n❌ Error — rolled back.', e); process.exitCode = 1; }
  finally { await db.end(); }
}
main();
