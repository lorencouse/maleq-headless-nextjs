/**
 * Batch fix for the "lost axis" family — LUBE/TOPICAL flavor-misplaced group (round 2).
 *
 * Second class of contamination found by the cross-taxonomy audit: the FLAVOR/SCENT axis
 * was dumped into pa_volume (and sometimes pa_size) instead of pa_flavor. Real flavor+volume
 * reconstructed from the variation image filename (e.g. coochy-shave-cream-au-natural-34-oz
 * -> flavor=au-natural, volume=3.4-oz). Volume decimals decoded against each product's
 * canonical volume set (34->3.4, 72->7.2, 125->12.5, 32->32).
 *
 * Scope (13 products; flavor clearly the axis, full variation data, volumes unambiguous):
 *   fixed-volume (flavor-only):  190790 Problo Deep Throat (1oz), 190798 Problo Oral Gel (1.5oz),
 *                                190647 Divine Nectars (2oz), 594536 Honey Dust (6oz), 190514 Jo Gelato (1oz)
 *   flavor × volume:             188601 Coochy Shave Cream, 189497 Massage & Body Oil,
 *                                189543 Edible Massage Lotion, 543414 Honey Dust, 190303 Id Frutopia,
 *                                190761 Smack Tarts, 190829 Af Lube, 190834 Juicy Af Lube
 *
 * Deferred (messy / not a clean flavor axis): Astroglide & Wet & Cgc (product TYPES merged),
 *   192726/544358/544362/544368/544375 Personal Moisturizers (decimal vols + type mixing),
 *   195906/594332 Wicked Aqua, 590597 Kimono Swirl (condom+lubes), 189527 Relaxing Oil (prepack),
 *   191322/191633/191639/191643 scented panties (size×flavor, line-mixed).
 *
 * Safe by default: ONE transaction, ROLLS BACK + prints grids. Pass --apply to COMMIT.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';
import { updateParentProductAttributes, ensureAttributeTerm, linkTermToProduct, updateMetaLookup } from './lib/variant-manager/db-mutations';

const APPLY = process.argv.includes('--apply');
const titleCase = (slug: string) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const volName = (slug: string) => slug.replace(/-oz$/, '').replace(/-/g, '.') + ' oz';
const volSort = (slug: string) => parseFloat(slug.replace(/-oz$/, '').replace(/-/g, '.'));
const CLEAR = ['attribute_pa_color', 'attribute_pa_size', 'attribute_pa_flavor', 'attribute_pa_volume'];

type Var = { id: number; flavor: string; volume?: string };

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

async function setVar(db: Connection, v: Var, title: string, fixedVol?: string) {
  await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key IN (${CLEAR.map(() => '?').join(',')})`, [v.id, ...CLEAR]);
  const vol = v.volume || fixedVol;
  await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_flavor', ?)`, [v.id, v.flavor]);
  if (vol) await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_volume', ?)`, [v.id, vol]);
  await db.query(`UPDATE wp_posts SET post_title = ? WHERE ID = ?`, [`${title} - ${titleCase(v.flavor)}${vol ? ', ' + volName(vol) : ''}`, v.id]);
}

async function fixInPlace(db: Connection, id: number, title: string, vars: Var[], opts: { volumeIsAxis: boolean; fixedVol?: string }) {
  for (const v of vars) await setVar(db, v, title, opts.fixedVol);
  const flavors = [...new Set(vars.map((v) => v.flavor))];
  const volumes = opts.volumeIsAxis
    ? [...new Set(vars.map((v) => v.volume!).filter(Boolean))].sort((a, b) => volSort(a) - volSort(b))
    : (opts.fixedVol ? [opts.fixedVol] : []);
  const attrs: Record<string, any> = {}; let pos = 0;
  attrs.pa_flavor = { name: 'pa_flavor', value: flavors.join(' | '), position: pos++, is_visible: 1, is_variation: 1, is_taxonomy: 1 };
  if (volumes.length) attrs.pa_volume = { name: 'pa_volume', value: volumes.join(' | '), position: pos++, is_visible: 1, is_variation: opts.volumeIsAxis ? 1 : 0, is_taxonomy: 1 };
  await updateParentProductAttributes(db, id, attrs);
  for (const t of ['pa_color', 'pa_size', 'pa_flavor', 'pa_volume']) await unlinkTaxonomy(db, id, t);
  for (const f of flavors) await linkTermToProduct(db, id, await ensureAttributeTerm(db, 'pa_flavor', titleCase(f), f));
  for (const vol of volumes) await linkTermToProduct(db, id, await ensureAttributeTerm(db, 'pa_volume', volName(vol), vol));
  await updateMetaLookup(db, id);
}

const dup = (vars: Var[], axis: boolean) => { const s = new Set<string>(); let d = 0; for (const v of vars) { const k = `${v.flavor}|${axis ? v.volume : ''}`; if (s.has(k)) d++; s.add(k); } return d; };

// ---------------- specs (flavor [+ volume] from image filename) ----------------
const PROBLO_DT: Var[] = [{ id: 190791, flavor: 'cherry' }, { id: 190792, flavor: 'peach' }, { id: 190793, flavor: 'strawberry' }, { id: 190794, flavor: 'watermelon' }, { id: 190795, flavor: 'cotton-candy' }, { id: 190796, flavor: 'cupcake' }, { id: 190797, flavor: 'bubblegum' }];
const PROBLO_GEL: Var[] = [{ id: 190799, flavor: 'bubblegum' }, { id: 190800, flavor: 'strawberry' }, { id: 190801, flavor: 'watermelon' }, { id: 190802, flavor: 'peach' }, { id: 190803, flavor: 'blue-raspberry' }, { id: 190804, flavor: 'passion-fruit' }, { id: 190805, flavor: 'cotton-candy' }];
const DIVINE: Var[] = [{ id: 190651, flavor: 'coconut-pineapple' }, { id: 190652, flavor: 'raspberry' }, { id: 190653, flavor: 'strawberry' }, { id: 190654, flavor: 'tropical-mango' }, { id: 190655, flavor: 'vanilla' }];
const HONEY6: Var[] = [{ id: 543416, flavor: 'raspberry' }, { id: 543417, flavor: 'strawberry' }, { id: 543418, flavor: 'vanilla' }];
const JO_GELATO: Var[] = [{ id: 190515, flavor: 'creme-brulee' }, { id: 190516, flavor: 'mint-chocolate' }, { id: 190517, flavor: 'salted-caramel' }];
const EDIBLE: Var[] = [{ id: 189544, flavor: 'cherry', volume: '8-oz' }, { id: 189545, flavor: 'strawberry', volume: '8-oz' }, { id: 189546, flavor: 'watermelon', volume: '8-oz' }, { id: 189547, flavor: 'cherry', volume: '2-oz' }, { id: 189548, flavor: 'strawberry', volume: '2-oz' }, { id: 189549, flavor: 'watermelon', volume: '2-oz' }];
const HONEY81: Var[] = [{ id: 543415, flavor: 'strawberry', volume: '8-oz' }, { id: 543419, flavor: 'raspberry', volume: '1-oz' }, { id: 543420, flavor: 'strawberry', volume: '1-oz' }, { id: 543421, flavor: 'tropical-mango', volume: '1-oz' }, { id: 543422, flavor: 'vanilla', volume: '1-oz' }];
const COOCHY: Var[] = [
  { id: 188602, flavor: 'au-natural', volume: '3-4-oz' }, { id: 188603, flavor: 'au-natural', volume: '7-2-oz' }, { id: 188604, flavor: 'au-natural', volume: '12-5-oz' },
  { id: 188605, flavor: 'frosted-cake', volume: '3-4-oz' }, { id: 188606, flavor: 'floral-haze', volume: '3-4-oz' }, { id: 188607, flavor: 'island-paradise', volume: '3-4-oz' }, { id: 188608, flavor: 'peachy-keen', volume: '3-4-oz' },
  { id: 188609, flavor: 'frosted-cake', volume: '7-2-oz' }, { id: 188610, flavor: 'floral-haze', volume: '7-2-oz' }, { id: 188611, flavor: 'island-paradise', volume: '7-2-oz' }, { id: 188612, flavor: 'sweet-nectar', volume: '7-2-oz' }, { id: 188613, flavor: 'peachy-keen', volume: '7-2-oz' },
  { id: 188614, flavor: 'frosted-cake', volume: '12-5-oz' }, { id: 188615, flavor: 'floral-haze', volume: '12-5-oz' }, { id: 188616, flavor: 'island-paradise', volume: '12-5-oz' }, { id: 188617, flavor: 'sweet-nectar', volume: '12-5-oz' }, { id: 188618, flavor: 'peachy-keen', volume: '12-5-oz' },
  { id: 188620, flavor: 'sweet-nectar', volume: '32-oz' },
];
const MASSAGE_OIL: Var[] = [
  { id: 189498, flavor: 'dreamsicle', volume: '8-oz' }, { id: 189499, flavor: 'lavender', volume: '8-oz' }, { id: 189500, flavor: 'kashmir-musk', volume: '8-oz' }, { id: 189501, flavor: 'zen-berry-rose', volume: '8-oz' }, { id: 189502, flavor: 'skinny-dip', volume: '8-oz' }, { id: 189503, flavor: 'nag-champa', volume: '8-oz' }, { id: 189504, flavor: 'high-tide', volume: '8-oz' }, { id: 189505, flavor: 'guavalava', volume: '8-oz' },
  { id: 189506, flavor: 'dreamsicle', volume: '2-oz' }, { id: 189507, flavor: 'lavender', volume: '2-oz' }, { id: 189508, flavor: 'skinny-dip', volume: '2-oz' }, { id: 189509, flavor: 'high-tide', volume: '2-oz' }, { id: 189510, flavor: 'guavalava', volume: '2-oz' }, { id: 189511, flavor: 'kashmir-musk', volume: '2-oz' }, { id: 189512, flavor: 'zen-berry-rose', volume: '2-oz' },
];
const FRUTOPIA: Var[] = [
  { id: 190304, flavor: 'banana', volume: '1-oz' }, { id: 190305, flavor: 'mango-passion', volume: '1-oz' }, { id: 190311, flavor: 'cherry', volume: '1-oz' }, { id: 190312, flavor: 'red-raspberry', volume: '1-oz' }, { id: 190313, flavor: 'strawberry', volume: '1-oz' }, { id: 190314, flavor: 'watermelon', volume: '1-oz' },
  { id: 190306, flavor: 'banana', volume: '3-4-oz' }, { id: 190307, flavor: 'cherry', volume: '3-4-oz' }, { id: 190308, flavor: 'mango-passion', volume: '3-4-oz' }, { id: 190309, flavor: 'red-raspberry', volume: '3-4-oz' }, { id: 190310, flavor: 'strawberry', volume: '3-4-oz' }, { id: 190315, flavor: 'watermelon', volume: '3-4-oz' },
];
const SMACK_TARTS: Var[] = [
  { id: 190762, flavor: 'cherry', volume: '4-oz' }, { id: 190763, flavor: 'grape', volume: '4-oz' }, { id: 190764, flavor: 'green-apple', volume: '4-oz' }, { id: 190765, flavor: 'strawberry', volume: '4-oz' }, { id: 190766, flavor: 'watermelon', volume: '4-oz' }, { id: 190767, flavor: 'pineapple', volume: '4-oz' },
  { id: 190768, flavor: 'cherry', volume: '2-oz' }, { id: 190769, flavor: 'grape', volume: '2-oz' }, { id: 190770, flavor: 'green-apple', volume: '2-oz' }, { id: 190771, flavor: 'strawberry', volume: '2-oz' }, { id: 190772, flavor: 'watermelon', volume: '2-oz' }, { id: 190773, flavor: 'pineapple', volume: '2-oz' },
];
const AF_LUBE: Var[] = [{ id: 190830, flavor: 'natural', volume: '4-oz' }, { id: 190831, flavor: 'watermelon', volume: '4-oz' }, { id: 190832, flavor: 'natural', volume: '2-oz' }, { id: 190833, flavor: 'watermelon', volume: '2-oz' }];
const JUICY_AF: Var[] = [{ id: 190835, flavor: 'blue-raspberry', volume: '4-oz' }, { id: 190836, flavor: 'strawberry', volume: '4-oz' }, { id: 190837, flavor: 'blue-raspberry', volume: '2-oz' }, { id: 190838, flavor: 'strawberry', volume: '2-oz' }];

type Job = { id: number; title: string; vars: Var[]; axis: boolean; fixedVol?: string };
const JOBS: Job[] = [
  { id: 190790, title: 'Problo Deep Throat Spray', vars: PROBLO_DT, axis: false, fixedVol: '1-oz' },
  { id: 190798, title: 'Problo Oral Pleasure Gel', vars: PROBLO_GEL, axis: false, fixedVol: '1-5-oz' },
  { id: 190647, title: 'Divine Nectars', vars: DIVINE, axis: false, fixedVol: '2-oz' },
  { id: 594536, title: 'Honey Dust', vars: HONEY6, axis: false, fixedVol: '6-oz' },
  { id: 190514, title: 'Jo Gelato', vars: JO_GELATO, axis: false, fixedVol: '1-oz' },
  { id: 189543, title: 'Edible Massage Lotion', vars: EDIBLE, axis: true },
  { id: 543414, title: 'Honey Dust', vars: HONEY81, axis: true },
  { id: 188601, title: 'Coochy Shave Cream', vars: COOCHY, axis: true },
  { id: 189497, title: 'Massage & Body Oil', vars: MASSAGE_OIL, axis: true },
  { id: 190303, title: 'Id Frutopia', vars: FRUTOPIA, axis: true },
  { id: 190761, title: 'Smack Tarts Lickable Lube Sour', vars: SMACK_TARTS, axis: true },
  { id: 190829, title: 'Af Lube', vars: AF_LUBE, axis: true },
  { id: 190834, title: 'Juicy Af Lube', vars: JUICY_AF, axis: true },
];

async function main() {
  const db = await getConnection();
  await db.query('START TRANSACTION');
  try {
    for (const j of JOBS) await fixInPlace(db, j.id, j.title, j.vars, { volumeIsAxis: j.axis, fixedVol: j.fixedVol });
    console.log('\n================ RESULTING STATE (in transaction) ================');
    for (const j of JOBS) {
      const [cnt] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) c FROM wp_posts WHERE post_parent=? AND post_type='product_variation'`, [j.id]);
      const flavors = [...new Set(j.vars.map((v) => v.flavor))];
      const vols = j.axis ? [...new Set(j.vars.map((v) => v.volume))] : [j.fixedVol];
      console.log(`${j.id} "${j.title}" -> ${cnt[0].c} vars, ${j.vars.length} fixed, dup=${dup(j.vars, j.axis)} | ${flavors.length} flavors × vol(${vols.join(',')})`);
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
