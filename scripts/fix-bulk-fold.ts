/**
 * Decision B — fold bulk/packaging variants instead of leaving junk in the axis.
 *
 *   188578 Cock Rockets   — candy: pa_flavor axis (6 flavors) + the 36-pc display folded in
 *                           as an "Assorted" flavor option (title notes "36 Pc Display").
 *   188663 Ass Ballz      — packaging dups: pa_size (M/L/XL) × pa_pack (boxed/clamshell).
 *                           Lossless — both packagings kept (clamshell is sometimes the only in-stock).
 *
 * (194043 Expandable Butt Plug NOT here — it's merged models (Expandable vs Colt) -> Decision A split.)
 *
 * Safe by default: ONE transaction, ROLLS BACK + prints. Pass --apply to COMMIT.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';
import { updateParentProductAttributes, ensureAttributeTerm, linkTermToProduct, updateMetaLookup } from './lib/variant-manager/db-mutations';

const APPLY = process.argv.includes('--apply');
type Tax = 'pa_color' | 'pa_length' | 'pa_size' | 'pa_flavor' | 'pa_pack';
const ALL: Tax[] = ['pa_color', 'pa_length', 'pa_size', 'pa_flavor', 'pa_pack'];
const cap = (s: string) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const name = (t: Tax, s: string) => (t === 'pa_size' ? s.toUpperCase() : cap(s));

type Var = { id: number; note?: string } & Partial<Record<Tax, string>>;

async function unlinkTaxonomy(db: Connection, pid: number, tax: string) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT tr.term_taxonomy_id ttid FROM wp_term_relationships tr JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id=tt.term_taxonomy_id WHERE tr.object_id=? AND tt.taxonomy=?`, [pid, tax]);
  for (const r of rows) { await db.query(`DELETE FROM wp_term_relationships WHERE object_id=? AND term_taxonomy_id=?`, [pid, r.ttid]); await db.query(`UPDATE wp_term_taxonomy SET count=GREATEST(count-1,0) WHERE term_taxonomy_id=?`, [r.ttid]); }
}
async function setVar(db: Connection, v: Var, title: string) {
  await db.query(`DELETE FROM wp_postmeta WHERE post_id=? AND meta_key IN (${ALL.map(() => '?').join(',')})`, [v.id, ...ALL.map((t) => `attribute_${t}`)]);
  const parts: string[] = [];
  for (const t of ALL) if (v[t]) { await db.query(`INSERT INTO wp_postmeta (post_id,meta_key,meta_value) VALUES (?,?,?)`, [v.id, `attribute_${t}`, v[t]]); parts.push(name(t, v[t]!)); }
  if (v.note) parts.push(v.note);
  await db.query(`UPDATE wp_posts SET post_title=? WHERE ID=?`, [`${title} - ${parts.join(', ')}`, v.id]);
}
async function fix(db: Connection, id: number, title: string, vars: Var[], axes: Tax[]) {
  for (const v of vars) await setVar(db, v, title);
  const attrs: Record<string, any> = {}; let pos = 0;
  for (const t of axes) { const vals = [...new Set(vars.map((v) => v[t]).filter(Boolean) as string[])]; attrs[t] = { name: t, value: vals.join(' | '), position: pos++, is_visible: 1, is_variation: 1, is_taxonomy: 1 }; }
  await updateParentProductAttributes(db, id, attrs);
  for (const t of ALL) await unlinkTaxonomy(db, id, t);
  for (const t of axes) for (const s of [...new Set(vars.map((v) => v[t]).filter(Boolean) as string[])]) await linkTermToProduct(db, id, await ensureAttributeTerm(db, t, name(t, s), s));
  await updateMetaLookup(db, id);
}
const dup = (vars: Var[], axes: Tax[]) => { const s = new Set<string>(); let d = 0; for (const v of vars) { const k = axes.map((a) => v[a] || '').join('|'); if (s.has(k)) d++; s.add(k); } return d; };

const COCK_ROCKETS: Var[] = [
  { id: 188579, pa_flavor: 'grape' }, { id: 188580, pa_flavor: 'strawberry' }, { id: 188581, pa_flavor: 'watermelon' },
  { id: 188582, pa_flavor: 'green-apple' }, { id: 188583, pa_flavor: 'orange' }, { id: 188585, pa_flavor: 'fruit-punch' },
  { id: 188584, pa_flavor: 'assorted', note: '36 Pc Display' },
];
const ASS_BALLZ: Var[] = [
  { id: 188664, pa_size: 'm', pa_pack: 'boxed' }, { id: 188665, pa_size: 'm', pa_pack: 'clamshell' },
  { id: 188666, pa_size: 'l', pa_pack: 'boxed' }, { id: 188667, pa_size: 'l', pa_pack: 'clamshell' },
  { id: 188668, pa_size: 'xl', pa_pack: 'boxed' }, { id: 188669, pa_size: 'xl', pa_pack: 'clamshell' },
];

type Job = { id: number; title: string; vars: Var[]; axes: Tax[] };
const JOBS: Job[] = [
  { id: 188578, title: 'Cock Rockets', vars: COCK_ROCKETS, axes: ['pa_flavor'] },
  { id: 188663, title: 'Ass Ballz', vars: ASS_BALLZ, axes: ['pa_size', 'pa_pack'] },
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
