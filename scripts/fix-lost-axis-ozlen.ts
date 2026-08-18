/**
 * Batch fix — oz-in-pa_length group (the CLEAN subset).
 *
 * These toys had a junk oz WEIGHT value leak into pa_length (a toy length axis should never
 * hold "0.25-oz"). The offending variation's real identity is in its image filename. Only the
 * products below are cleanly reconstructable straight from images; the rest of the 19 oz-in-length
 * products are entangled with the deferred dimension-string / merged-model mess and are left alone.
 *
 * Scope (5 products):
 *   188126  Dr Skin Glide Self Lubricating Dildo  pa_length × pa_color : 7/7.5/8/8.5-in × vanilla/chocolate/mocha
 *   188546  Temptasia Bling Plug                  pa_size × pa_color   : S/L × purple/black
 *   189009  Platinum Minis Smooth                 pa_size × pa_color   : S/M × black/pink
 *   198807  Cloud 9 (20-speed bullet)             pa_color             : pink/blue
 *   541890  Silk                                  pa_size × pa_color   : S/M/L × black/purple-haze
 *
 * Deferred (NOT clean — merged models / packaging dups / dimension-string axis): 187939 Power Bullet,
 *   188500 Gaia Eco Aqua, 188663 Ass Ballz, 189608 Glas, 192248 Firefly Halo, 193841 Ring O Pro,
 *   194043 Expandable Plug, 194179 Butterfly Kiss, 194320 Pocket Exotic, 195984 Cloud 9 Gems,
 *   196052 Pro Sensual Dong, 445034 Femme Funn, 545103, 545343.
 *
 * Safe by default: ONE transaction, ROLLS BACK + prints grids. Pass --apply to COMMIT.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';
import { updateParentProductAttributes, ensureAttributeTerm, linkTermToProduct, updateMetaLookup } from './lib/variant-manager/db-mutations';

const APPLY = process.argv.includes('--apply');
type Tax = 'pa_color' | 'pa_length' | 'pa_size';
const ALL: Tax[] = ['pa_color', 'pa_length', 'pa_size'];
const SIZE_ORDER = ['xs', 's', 'm', 'l', 'xl', '2xl'];
const cap = (s: string) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
function termName(t: Tax, s: string) {
  if (t === 'pa_length') { const m = s.match(/-(in|mm|cm)$/); const u = m ? m[1] : ''; return `${s.replace(/-(in|mm|cm)$/, '').replace(/-/g, '.')} ${u}`.trim(); }
  if (t === 'pa_size') return s.toUpperCase();
  return cap(s);
}
const lenKey = (s: string) => parseFloat(s.replace(/-(in|mm|cm)$/, '').replace(/-/g, '.')) || 0;
const key = (t: Tax, s: string) => (t === 'pa_length' ? lenKey(s) : (t === 'pa_size' ? SIZE_ORDER.indexOf(s) : 0));

type Var = { id: number } & Partial<Record<Tax, string>>;

async function unlinkTaxonomy(db: Connection, pid: number, tax: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT tr.term_taxonomy_id ttid FROM wp_term_relationships tr JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id=tt.term_taxonomy_id WHERE tr.object_id=? AND tt.taxonomy=?`, [pid, tax]);
  for (const r of rows) {
    await db.query(`DELETE FROM wp_term_relationships WHERE object_id=? AND term_taxonomy_id=?`, [pid, r.ttid]);
    await db.query(`UPDATE wp_term_taxonomy SET count=GREATEST(count-1,0) WHERE term_taxonomy_id=?`, [r.ttid]);
  }
}
async function setVar(db: Connection, v: Var, title: string) {
  await db.query(`DELETE FROM wp_postmeta WHERE post_id=? AND meta_key IN (${ALL.map(() => '?').join(',')})`, [v.id, ...ALL.map((t) => `attribute_${t}`)]);
  const parts: string[] = [];
  for (const t of ALL) if (v[t]) { await db.query(`INSERT INTO wp_postmeta (post_id,meta_key,meta_value) VALUES (?,?,?)`, [v.id, `attribute_${t}`, v[t]]); parts.push(termName(t, v[t]!)); }
  await db.query(`UPDATE wp_posts SET post_title=? WHERE ID=?`, [`${title} - ${parts.join(', ')}`, v.id]);
}
async function fix(db: Connection, id: number, title: string, vars: Var[], axes: Tax[]) {
  for (const v of vars) await setVar(db, v, title);
  const attrs: Record<string, any> = {}; let pos = 0;
  for (const t of axes) {
    const vals = [...new Set(vars.map((v) => v[t]).filter(Boolean) as string[])].sort((a, b) => key(t, a) - key(t, b));
    attrs[t] = { name: t, value: vals.join(' | '), position: pos++, is_visible: 1, is_variation: 1, is_taxonomy: 1 };
  }
  await updateParentProductAttributes(db, id, attrs);
  for (const t of ALL) await unlinkTaxonomy(db, id, t);
  for (const t of axes) for (const s of [...new Set(vars.map((v) => v[t]).filter(Boolean) as string[])]) await linkTermToProduct(db, id, await ensureAttributeTerm(db, t, termName(t, s), s));
  await updateMetaLookup(db, id);
}
const dup = (vars: Var[], axes: Tax[]) => { const s = new Set<string>(); let d = 0; for (const v of vars) { const k = axes.map((a) => v[a] || '').join('|'); if (s.has(k)) d++; s.add(k); } return d; };

const DRSKIN: Var[] = [
  { id: 188127, pa_length: '7-5-in', pa_color: 'vanilla' }, { id: 188128, pa_length: '7-5-in', pa_color: 'chocolate' }, { id: 188129, pa_length: '7-5-in', pa_color: 'mocha' },
  { id: 188130, pa_length: '7-in', pa_color: 'chocolate' }, { id: 188131, pa_length: '7-in', pa_color: 'mocha' },
  { id: 188132, pa_length: '8-5-in', pa_color: 'chocolate' }, { id: 188133, pa_length: '8-5-in', pa_color: 'mocha' },
  { id: 188134, pa_length: '8-in', pa_color: 'vanilla' }, { id: 188135, pa_length: '8-in', pa_color: 'chocolate' }, { id: 188136, pa_length: '8-in', pa_color: 'mocha' },
];
const TEMPTASIA: Var[] = [{ id: 188547, pa_size: 's', pa_color: 'purple' }, { id: 188548, pa_size: 's', pa_color: 'black' }, { id: 188551, pa_size: 'l', pa_color: 'black' }];
const PLATINUM: Var[] = [{ id: 189010, pa_size: 's', pa_color: 'black' }, { id: 189011, pa_size: 's', pa_color: 'pink' }, { id: 189012, pa_size: 'm', pa_color: 'black' }];
const CLOUD9: Var[] = [{ id: 198808, pa_color: 'pink' }, { id: 198809, pa_color: 'blue' }];
const SILK: Var[] = [
  { id: 541891, pa_size: 'm', pa_color: 'black' }, { id: 541892, pa_size: 'm', pa_color: 'purple-haze' },
  { id: 541893, pa_size: 's', pa_color: 'black' }, { id: 541894, pa_size: 's', pa_color: 'purple-haze' },
  { id: 541895, pa_size: 'l', pa_color: 'purple-haze' }, { id: 541896, pa_size: 'l', pa_color: 'black' },
];

type Job = { id: number; title: string; vars: Var[]; axes: Tax[] };
const JOBS: Job[] = [
  { id: 188126, title: 'Dr Skin Glide Self Lubricating Dildo', vars: DRSKIN, axes: ['pa_length', 'pa_color'] },
  { id: 188546, title: 'Temptasia Bling Plug', vars: TEMPTASIA, axes: ['pa_size', 'pa_color'] },
  { id: 189009, title: 'Platinum Minis Smooth', vars: PLATINUM, axes: ['pa_size', 'pa_color'] },
  { id: 198807, title: 'Cloud 9', vars: CLOUD9, axes: ['pa_color'] },
  { id: 541890, title: 'Silk', vars: SILK, axes: ['pa_size', 'pa_color'] },
];

async function main() {
  const db = await getConnection();
  await db.query('START TRANSACTION');
  try {
    for (const j of JOBS) await fix(db, j.id, j.title, j.vars, j.axes);
    console.log('\n================ RESULTING STATE (in transaction) ================');
    for (const j of JOBS) {
      const [cnt] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) c FROM wp_posts WHERE post_parent=? AND post_type='product_variation'`, [j.id]);
      const desc = j.axes.map((a) => `${a.replace('pa_', '')}[${[...new Set(j.vars.map((v) => v[a]).filter(Boolean))].join(',')}]`).join(' × ');
      console.log(`${j.id} "${j.title}" -> ${cnt[0].c} vars, ${j.vars.length} fixed, dup=${dup(j.vars, j.axes)} | ${desc}`);
    }
    if (APPLY) { await db.query('COMMIT'); console.log('\n✅ COMMITTED.\nPROD follow-up: wp cache flush; wc tool run regenerate_product_lookup_tables; wc tool run regenerate_product_attributes_lookup_table'); }
    else { await db.query('ROLLBACK'); console.log('\n🔄 DRY RUN — rolled back. Re-run with --apply to commit.'); }
  } catch (e) { await db.query('ROLLBACK'); console.error('\n❌ Error — rolled back.', e); process.exitCode = 1; }
  finally { await db.end(); }
}
main();
