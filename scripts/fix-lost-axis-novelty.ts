/**
 * Batch fix for the "lost axis" family — NOVELTY / PLUSH / PARTY group.
 *
 * Same scramble (real axis values dumped into pa_color). Reconstructed from descriptive
 * _wt_sku + image filenames. Axis varies by product (length / color / flavor / pack).
 *
 * Scope of THIS batch:
 *   195215  Penis Stuffy (plush)            size-only pa_length: 12/24/35-in
 *   197387  Cock Suckers Pecker Straws      pa_flavor: chocolate/vanilla/caramel (10-pk fixed)
 *   446722  Shots Short Penis Stuffy        pa_length × pa_color: 11.8/19.7-in × beige/brown/black
 *   445652  Sport Fucker Ergo Balls         pa_length(mm) × pa_color: 30/40/60mm × blue/red/black
 *
 * Deferred:
 *   188578 Cock Rockets — 6 candy flavors + a 36-piece bulk DISPLAY box (mixed flavor/pack
 *                         semantics). Splitting the display into its own product is a
 *                         merchandising call -> left for review.
 *
 * Safe by default: ONE transaction, ROLLS BACK + prints grids. Pass --apply to COMMIT.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';
import { updateParentProductAttributes, ensureAttributeTerm, linkTermToProduct, updateMetaLookup } from './lib/variant-manager/db-mutations';

const APPLY = process.argv.includes('--apply');
type Tax = 'pa_color' | 'pa_length' | 'pa_flavor' | 'pa_pack';
const ALL_TAX: Tax[] = ['pa_color', 'pa_length', 'pa_flavor', 'pa_pack'];

function termName(tax: Tax, slug: string): string {
  if (tax === 'pa_length') {
    const m = slug.match(/-(in|mm|cm|ft)$/);
    const unit = m ? m[1] : '';
    const num = slug.replace(/-(in|mm|cm|ft)$/, '').replace(/-/g, '.');
    return `${num} ${unit}`.trim();
  }
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
const lenKey = (slug: string) => parseFloat(slug.replace(/-(in|mm|cm|ft)$/, '').replace(/-/g, '.')) || 0;

type Var = { id: number } & Partial<Record<Tax, string>>;

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
  await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key IN (${ALL_TAX.map(() => '?').join(',')})`,
    [v.id, ...ALL_TAX.map((t) => `attribute_${t}`)]);
  const parts: string[] = [];
  for (const t of ALL_TAX) {
    const val = v[t];
    if (val) { await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`, [v.id, `attribute_${t}`, val]); parts.push(termName(t, val)); }
  }
  await db.query(`UPDATE wp_posts SET post_title = ? WHERE ID = ?`, [`${title} - ${parts.join(', ')}`, v.id]);
}

async function fixGeneric(db: Connection, id: number, title: string, vars: Var[], variationAxes: Tax[], fixed?: Partial<Record<Tax, string>>) {
  for (const v of vars) await setVar(db, v, title);
  const attrs: Record<string, any> = {}; let pos = 0;
  const valuesFor = (t: Tax) => {
    if (variationAxes.includes(t)) {
      const vals = [...new Set(vars.map((v) => v[t]).filter(Boolean) as string[])];
      return t === 'pa_length' ? vals.sort((a, b) => lenKey(a) - lenKey(b)) : vals;
    }
    return fixed?.[t] ? [fixed[t]!] : [];
  };
  for (const t of ALL_TAX) {
    const vals = valuesFor(t);
    if (!vals.length) continue;
    attrs[t] = { name: t, value: vals.join(' | '), position: pos++, is_visible: 1, is_variation: variationAxes.includes(t) ? 1 : 0, is_taxonomy: 1 };
  }
  await updateParentProductAttributes(db, id, attrs);
  for (const t of ALL_TAX) await unlinkTaxonomy(db, id, t);
  for (const t of ALL_TAX) for (const s of valuesFor(t)) await linkTermToProduct(db, id, await ensureAttributeTerm(db, t, termName(t, s), s));
  await updateMetaLookup(db, id);
}

function showGrid(label: string, vars: Var[], rowAxis: Tax, colAxis?: Tax) {
  const rows = [...new Set(vars.map((v) => v[rowAxis] || '(fixed)'))].sort((a, b) => (rowAxis === 'pa_length' ? lenKey(a) - lenKey(b) : 0));
  console.log(`  ${label}:`);
  for (const r of rows) {
    const cell = colAxis ? vars.filter((v) => (v[rowAxis] || '(fixed)') === r).map((v) => v[colAxis]).join(', ') : vars.filter((v) => (v[rowAxis] || '(fixed)') === r).length + ' var(s)';
    console.log(`    ${String(r).padEnd(10)} -> ${cell}`);
  }
}

// ---------------- Reconstructed specs ----------------
const STUFFY: Var[] = [ // 195215 Penis Stuffy — pa_length only
  { id: 195216, pa_length: '12-in' }, { id: 195219, pa_length: '24-in' }, { id: 195220, pa_length: '35-in' },
];
const STRAWS: Var[] = [ // 197387 Cock Suckers Pecker Straws — pa_flavor, 10-pk fixed
  { id: 197388, pa_flavor: 'chocolate' }, { id: 197389, pa_flavor: 'vanilla' }, { id: 197390, pa_flavor: 'caramel' },
];
const SHOTS_STUFFY: Var[] = [ // 446722 Shots Short Penis Stuffy — pa_length × pa_color
  { id: 537366, pa_length: '19-7-in', pa_color: 'beige' }, { id: 538844, pa_length: '11-8-in', pa_color: 'brown' },
  { id: 538845, pa_length: '19-7-in', pa_color: 'black' }, { id: 472539, pa_length: '19-7-in', pa_color: 'brown' },
];
const ERGO: Var[] = [ // 445652 Sport Fucker Ergo Balls — pa_length(mm) × pa_color
  { id: 538722, pa_length: '30-mm', pa_color: 'blue' }, { id: 538723, pa_length: '30-mm', pa_color: 'red' },
  { id: 538724, pa_length: '40-mm', pa_color: 'red' }, { id: 538725, pa_length: '60-mm', pa_color: 'black' },
  { id: 445654, pa_length: '40-mm', pa_color: 'blue' },
];

async function main() {
  const db = await getConnection();
  await db.query('START TRANSACTION');
  try {
    await fixGeneric(db, 195215, 'Penis Stuffy', STUFFY, ['pa_length']);
    await fixGeneric(db, 197387, 'Cock Suckers Pecker Straws', STRAWS, ['pa_flavor'], { pa_pack: '10-pk' });
    await fixGeneric(db, 446722, 'Shots Short Penis Stuffy', SHOTS_STUFFY, ['pa_length', 'pa_color']);
    await fixGeneric(db, 445652, 'Sport Fucker Ergo Balls', ERGO, ['pa_length', 'pa_color']);

    console.log('\n================ RESULTING STATE (in transaction) ================');
    const dupCheck = (vars: Var[], axes: Tax[]) => {
      const seen = new Set<string>(); let d = 0;
      for (const v of vars) { const k = axes.map((a) => v[a] || '').join('|'); if (seen.has(k)) d++; seen.add(k); } return d;
    };
    console.log(`\n195215 Penis Stuffy -> dup=${dupCheck(STUFFY, ['pa_length'])}`); showGrid('195215', STUFFY, 'pa_length');
    console.log(`\n197387 Cock Suckers Straws -> dup=${dupCheck(STRAWS, ['pa_flavor'])}`); showGrid('197387', STRAWS, 'pa_flavor');
    console.log(`\n446722 Shots Short Penis Stuffy -> dup=${dupCheck(SHOTS_STUFFY, ['pa_length', 'pa_color'])}`); showGrid('446722', SHOTS_STUFFY, 'pa_length', 'pa_color');
    console.log(`\n445652 Sport Fucker Ergo Balls -> dup=${dupCheck(ERGO, ['pa_length', 'pa_color'])}`); showGrid('445652', ERGO, 'pa_length', 'pa_color');

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
