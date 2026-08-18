/**
 * Decision D, batch 2 — lingerie size × COLOR (real values from STC feed name/color).
 *
 * Same as D1 but these vary in BOTH size and color; both parsed from the STC Product Name.
 *
 *   188767 G String                  one-size/XL × red/white/black/neon-pink
 *   193563 Crotchless Lace V Thong   S/M,M/L × black/red-black
 *   543726 Bustier & G-String        S/M,L/XL,Queen × black/red
 *   544648 Open Back Lace & Net Teddy S/M,M/L × black/red
 *   191294 Euro Male Mesh Thong      S/M,L/XL × black/white
 *
 * Deferred (unresolved color / dup pairs): 188855 Sheer Thigh High, 542516 Open Crotch Boy Short,
 *   545425 Teacher's Pet Schoolgirl.
 *
 * Safe by default: ONE transaction, ROLLS BACK + prints. Pass --apply to COMMIT. Idempotent.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';
import { updateParentProductAttributes, ensureAttributeTerm, linkTermToProduct, updateMetaLookup } from './lib/variant-manager/db-mutations';

const APPLY = process.argv.includes('--apply');
const SIZE_ORDER = ['xs', 's', 's-m', 'm', 'm-l', 'l', 'l-xl', 'xl', '1x', 'xxl', 'queen', 'one-size'];
const sizeIdx = (s: string) => { const i = SIZE_ORDER.indexOf(s); return i === -1 ? 99 : i; };
const sizeName = (s: string) => ({ 'one-size': 'One Size', 's-m': 'S/M', 'm-l': 'M/L', 'l-xl': 'L/XL' } as Record<string, string>)[s] || s.toUpperCase();
const cap = (s: string) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const CLR = ['attribute_pa_size', 'attribute_pa_length', 'attribute_pa_color'];

async function unlinkTaxonomy(db: Connection, pid: number, tax: string) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT tr.term_taxonomy_id ttid FROM wp_term_relationships tr JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id=tt.term_taxonomy_id WHERE tr.object_id=? AND tt.taxonomy=?`, [pid, tax]);
  for (const r of rows) { await db.query(`DELETE FROM wp_term_relationships WHERE object_id=? AND term_taxonomy_id=?`, [pid, r.ttid]); await db.query(`UPDATE wp_term_taxonomy SET count=GREATEST(count-1,0) WHERE term_taxonomy_id=?`, [r.ttid]); }
}
async function setVar(db: Connection, id: number, size: string, color: string, title: string) {
  await db.query(`DELETE FROM wp_postmeta WHERE post_id=? AND meta_key IN (${CLR.map(() => '?').join(',')})`, [id, ...CLR]);
  await db.query(`INSERT INTO wp_postmeta (post_id,meta_key,meta_value) VALUES (?, 'attribute_pa_size', ?)`, [id, size]);
  await db.query(`INSERT INTO wp_postmeta (post_id,meta_key,meta_value) VALUES (?, 'attribute_pa_color', ?)`, [id, color]);
  await db.query(`UPDATE wp_posts SET post_title=? WHERE ID=?`, [`${title} - ${sizeName(size)}, ${cap(color)}`, id]);
}
type Job = { id: number; title: string; vars: [number, string, string][] }; // [id, size, color]
async function fix(db: Connection, j: Job) {
  for (const [id, sz, c] of j.vars) await setVar(db, id, sz, c, j.title);
  const sizes = [...new Set(j.vars.map((v) => v[1]))].sort((a, b) => sizeIdx(a) - sizeIdx(b));
  const colors = [...new Set(j.vars.map((v) => v[2]))];
  await updateParentProductAttributes(db, j.id, {
    pa_size: { name: 'pa_size', value: sizes.join(' | '), position: 0, is_visible: 1, is_variation: 1, is_taxonomy: 1 },
    pa_color: { name: 'pa_color', value: colors.join(' | '), position: 1, is_visible: 1, is_variation: 1, is_taxonomy: 1 },
  });
  for (const t of ['pa_size', 'pa_length', 'pa_color']) await unlinkTaxonomy(db, j.id, t);
  for (const s of sizes) await linkTermToProduct(db, j.id, await ensureAttributeTerm(db, 'pa_size', sizeName(s), s));
  for (const c of colors) await linkTermToProduct(db, j.id, await ensureAttributeTerm(db, 'pa_color', cap(c), c));
  await updateMetaLookup(db, j.id);
}
const dup = (vars: [number, string, string][]) => { const s = new Set<string>(); let d = 0; for (const v of vars) { const k = `${v[1]}|${v[2]}`; if (s.has(k)) d++; s.add(k); } return d; };

const JOBS: Job[] = [
  { id: 188767, title: 'G String', vars: [[188769, 'one-size', 'red'], [188770, 'one-size', 'white'], [188771, 'xl', 'black'], [188772, 'one-size', 'neon-pink'], [188773, 'xl', 'red']] },
  { id: 193563, title: 'Crotchless Lace V Thong', vars: [[193564, 'm-l', 'black'], [193565, 's-m', 'black'], [193566, 'm-l', 'red-black'], [193567, 's-m', 'red-black']] },
  { id: 543726, title: 'Luv Lace Bustier & G-String', vars: [[543727, 's-m', 'black'], [543728, 'l-xl', 'red'], [543729, 's-m', 'red'], [543730, 'queen', 'black']] },
  { id: 544648, title: 'Open Back Lace & Net Teddy', vars: [[544649, 'm-l', 'black'], [544650, 's-m', 'black'], [544651, 'm-l', 'red'], [544652, 's-m', 'red']] },
  { id: 191294, title: 'Euro Male Mesh Thong', vars: [[191295, 'l-xl', 'black'], [191296, 's-m', 'black'], [191297, 'l-xl', 'white']] },
];

async function main() {
  const db = await getConnection();
  await db.query('START TRANSACTION');
  try {
    for (const j of JOBS) await fix(db, j);
    console.log('\n================ RESULTING STATE (in transaction) ================');
    for (const j of JOBS) {
      const [cnt] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) c FROM wp_posts WHERE post_parent=? AND post_type='product_variation'`, [j.id]);
      const sizes = [...new Set(j.vars.map((v) => v[1]))].sort((a, b) => sizeIdx(a) - sizeIdx(b)).map(sizeName);
      const colors = [...new Set(j.vars.map((v) => v[2]))];
      console.log(`${j.id} "${j.title}" -> ${cnt[0].c} vars, ${j.vars.length} fixed, dup=${dup(j.vars)} | size[${sizes.join(',')}] × color[${colors.join(',')}]`);
    }
    if (APPLY) { await db.query('COMMIT'); console.log('\n✅ COMMITTED.\nPROD follow-up: wp cache flush; wc tool run regenerate_product_lookup_tables; wc tool run regenerate_product_attributes_lookup_table'); }
    else { await db.query('ROLLBACK'); console.log('\n🔄 DRY RUN — rolled back. Re-run with --apply to commit.'); }
  } catch (e) { await db.query('ROLLBACK'); console.error('\n❌ Error — rolled back.', e); process.exitCode = 1; }
  finally { await db.end(); }
}
main();
