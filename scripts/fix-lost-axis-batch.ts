/**
 * Batch fix for the "lost axis" / scrambled-attribute family (next batch after King Cock Cock).
 *
 * Each product below had its variation axes scrambled at import (length/size numbers
 * written into attribute_pa_color, single-axis variations, duplicate combos). True axis
 * values were reconstructed from two agreeing signals: the variation image filename and
 * the Williams Trading _wt_sku (descriptive for Realrock/B-Vibe, PD#### codes for King Cock).
 *
 * Scope of THIS batch (high-confidence toys, length×color or color-only):
 *   193202  King Cock Cock w/ Balls           in-place  flesh/tan/brown × 7..14in
 *   193266  King Cock Elite Dual Density       in-place  flesh/tan/brown × 6..11in  (+move 2 vibrating out)
 *   193279  King Cock Elite Vibrating Dual D.  in-place  flesh/tan/brown × 6..9in   (+receive the 2)
 *   446539  Realrock Crystal Clear Straight    in-place  blue/purple/turquoise × 6..11in  (1 ambiguous var left as-is)
 *   594387  Realrock Extra Thick 9in           in-place  color-only beige/tan/black (length fixed 9in)
 *   594366  Realrock Non-Realistic Suction     in-place  purple/blue × 4.5/6.7in
 *   195462  Wide Silicone Donut Ring           in-place  black/blue × 1.5/1.75/2in
 *
 * Note: King Cock Elite's pale tone "light" is mapped to the canonical color `flesh`
 * (same brand/tone as the plain King Cock line; no "light" color term exists).
 *
 * Safe by default: ONE transaction, ROLLS BACK + prints resulting grids. Pass --apply to COMMIT.
 *   npx tsx scripts/fix-lost-axis-batch.ts            # dry-run
 *   npx tsx scripts/fix-lost-axis-batch.ts --apply    # commit
 * After --apply, on PROD: wp cache flush; wc tool run regenerate_product_lookup_tables;
 *                         wc tool run regenerate_product_attributes_lookup_table
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';
import {
  moveVariationsToParent,
  updateParentProductAttributes,
  ensureAttributeTerm,
  linkTermToProduct,
  updateMetaLookup,
} from './lib/variant-manager/db-mutations';

const APPLY = process.argv.includes('--apply');

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// "1-5-in" -> "1.5 in", "6-7-in" -> "6.7 in", "11-in" -> "11 in"
const lenName = (slug: string) => slug.replace(/-in$/, '').replace(/-/g, '.') + ' in';
const lenSort = (s: string) => parseFloat(s.replace(/-in$/, '').replace(/-/g, '.'));

type Axis = { color?: string; length?: string };
type Var = { id: number } & Axis;

/** Remove all term_relationships for a taxonomy on a product, decrementing counts. */
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

/** Rewrite a variation's color/length attribute meta + title. Only sets the axes present. */
async function setVar(db: Connection, v: Var, title: string) {
  await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key IN ('attribute_pa_color','attribute_pa_length')`, [v.id]);
  const parts: string[] = [];
  if (v.color) {
    await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_color', ?)`, [v.id, v.color]);
    parts.push(cap(v.color));
  }
  if (v.length) {
    await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_length', ?)`, [v.id, v.length]);
    parts.push(lenName(v.length));
  }
  await db.query(`UPDATE wp_posts SET post_title = ? WHERE ID = ?`, [`${title} - ${parts.join(', ')}`, v.id]);
}

/**
 * Fix a product in place: set each variation's axes, rebuild _product_attributes + term links.
 * variationAxes = which axes are dropdowns; fixed = single-valued non-variation attrs (e.g. length 9-in).
 */
async function fixInPlace(db: Connection, id: number, title: string, vars: Var[], opts: {
  variationAxes: ('color' | 'length')[];
  fixed?: { color?: string; length?: string };
}) {
  for (const v of vars) await setVar(db, v, title);

  const colors = [...new Set(vars.map((v) => v.color).filter(Boolean) as string[])];
  const lengths = [...new Set(vars.map((v) => v.length).filter(Boolean) as string[])].sort((a, b) => lenSort(a) - lenSort(b));

  // Build _product_attributes (position by declared order; color first by convention)
  const attrs: Record<string, any> = {};
  let pos = 0;
  const colorVar = opts.variationAxes.includes('color');
  const lengthVar = opts.variationAxes.includes('length');
  const colorVals = colorVar ? colors : opts.fixed?.color ? [opts.fixed.color] : [];
  const lengthVals = lengthVar ? lengths : opts.fixed?.length ? [opts.fixed.length] : [];
  if (colorVals.length) attrs.pa_color = { name: 'pa_color', value: colorVals.join(' | '), position: pos++, is_visible: 1, is_variation: colorVar ? 1 : 0, is_taxonomy: 1 };
  if (lengthVals.length) attrs.pa_length = { name: 'pa_length', value: lengthVals.join(' | '), position: pos++, is_visible: 1, is_variation: lengthVar ? 1 : 0, is_taxonomy: 1 };
  await updateParentProductAttributes(db, id, attrs);

  // Reset term relationships to exactly the values used
  await unlinkTaxonomy(db, id, 'pa_color');
  await unlinkTaxonomy(db, id, 'pa_length');
  for (const c of colorVals) await linkTermToProduct(db, id, await ensureAttributeTerm(db, 'pa_color', cap(c), c));
  for (const l of lengthVals) await linkTermToProduct(db, id, await ensureAttributeTerm(db, 'pa_length', lenName(l), l));
  await updateMetaLookup(db, id);
}

function grid(label: string, vars: Var[]) {
  const lens = [...new Set(vars.map((v) => v.length || '(fixed)'))].sort((a, b) => lenSort(a) - lenSort(b));
  console.log(`  ${label}:`);
  for (const len of lens) {
    const cols = vars.filter((v) => (v.length || '(fixed)') === len).map((v) => v.color || '-');
    console.log(`    ${String(len).padEnd(8)} -> ${cols.join(', ')}`);
  }
}

// ---------------- Reconstructed specs ----------------
const KCWB: Var[] = [ // 193202 King Cock Cock w/ Balls
  { id: 193203, length: '7-in', color: 'flesh' }, { id: 193204, length: '7-in', color: 'tan' },
  { id: 193205, length: '8-in', color: 'flesh' }, { id: 193206, length: '8-in', color: 'tan' }, { id: 193207, length: '8-in', color: 'brown' },
  { id: 193208, length: '9-in', color: 'flesh' }, { id: 193209, length: '9-in', color: 'tan' }, { id: 193210, length: '9-in', color: 'brown' },
  { id: 193211, length: '10-in', color: 'flesh' }, { id: 193212, length: '10-in', color: 'tan' }, { id: 193213, length: '10-in', color: 'brown' },
  { id: 193214, length: '11-in', color: 'flesh' }, { id: 193215, length: '12-in', color: 'flesh' },
  { id: 193216, length: '14-in', color: 'tan' }, { id: 193217, length: '14-in', color: 'brown' },
];
const ELITE_PLAIN: Var[] = [ // 193266 King Cock Elite Dual Density (light->flesh)
  { id: 193267, length: '6-in', color: 'flesh' }, { id: 193268, length: '6-in', color: 'tan' },
  { id: 193269, length: '7-in', color: 'flesh' }, { id: 193270, length: '7-in', color: 'tan' },
  { id: 193271, length: '8-in', color: 'flesh' }, { id: 193272, length: '8-in', color: 'tan' }, { id: 193273, length: '8-in', color: 'brown' },
  { id: 193274, length: '10-in', color: 'flesh' }, { id: 193275, length: '11-in', color: 'flesh' }, { id: 193276, length: '11-in', color: 'brown' },
];
const ELITE_VIB_EXISTING: Var[] = [ // 193279 existing vibrating vars
  { id: 193280, length: '6-in', color: 'tan' }, { id: 193281, length: '7-in', color: 'brown' }, { id: 193282, length: '8-in', color: 'tan' },
];
const ELITE_VIB_INCOMING: Var[] = [ // moved from 193266 into 193279
  { id: 193277, length: '6-in', color: 'flesh' }, { id: 193278, length: '9-in', color: 'flesh' },
];
const RR_STRAIGHT: Var[] = [ // 446539 Realrock Crystal Clear Straight (446540 left as-is: ambiguous SHTREA150PNK)
  { id: 538059, length: '10-in', color: 'blue' }, { id: 538060, length: '8-in', color: 'purple' },
  { id: 538558, length: '10-in', color: 'purple' }, { id: 538559, length: '11-in', color: 'blue' },
  { id: 538560, length: '11-in', color: 'purple' }, { id: 538561, length: '11-in', color: 'turquoise' },
  { id: 538562, length: '6-in', color: 'blue' }, { id: 538563, length: '6-in', color: 'turquoise' },
  { id: 538564, length: '8-in', color: 'blue' }, { id: 538565, length: '9-in', color: 'turquoise' },
  { id: 446541, length: '6-in', color: 'purple' }, { id: 471583, length: '8-in', color: 'turquoise' },
  { id: 471587, length: '10-in', color: 'turquoise' },
];
const RR_THICK9: Var[] = [ // 594387 Realrock Extra Thick 9in — color only, length fixed 9-in
  { id: 538655, color: 'beige' }, { id: 538656, color: 'tan' }, { id: 447543, color: 'black' },
];
const RR_SUCTION: Var[] = [ // 594366 Realrock Non-Realistic Suction Cup
  { id: 540225, length: '4-5-in', color: 'purple' }, { id: 445222, length: '6-7-in', color: 'blue' },
];
const DONUT: Var[] = [ // 195462 Wide Silicone Donut Ring (cock ring, diameter as length)
  { id: 195463, length: '1-5-in', color: 'black' }, { id: 195464, length: '1-75-in', color: 'black' },
  { id: 195465, length: '2-in', color: 'black' }, { id: 195466, length: '2-in', color: 'blue' },
];

async function main() {
  const db = await getConnection();
  await db.query('START TRANSACTION');
  try {
    await fixInPlace(db, 193202, 'King Cock Cock w/ Balls', KCWB, { variationAxes: ['color', 'length'] });

    // Elite: move the 2 vibrating vars out FIRST, then fix both products
    await moveVariationsToParent(db, ELITE_VIB_INCOMING.map((v) => v.id), 193279);
    await fixInPlace(db, 193266, 'King Cock Elite Dual Density', ELITE_PLAIN, { variationAxes: ['color', 'length'] });
    await fixInPlace(db, 193279, 'King Cock Elite Vibrating Dual Density', [...ELITE_VIB_EXISTING, ...ELITE_VIB_INCOMING], { variationAxes: ['color', 'length'] });

    await fixInPlace(db, 446539, 'Realrock Crystal Clear Straight Dildo Without Balls', RR_STRAIGHT, { variationAxes: ['color', 'length'] });
    await fixInPlace(db, 594387, 'Realrock Extra Thick 9 In. Dildo with Balls', RR_THICK9, { variationAxes: ['color'], fixed: { length: '9-in' } });
    await fixInPlace(db, 594366, 'Realrock Crystal Clear Non-Realistic Dildo with Suction Cup', RR_SUCTION, { variationAxes: ['color', 'length'] });
    await fixInPlace(db, 195462, 'Wide Silicone Donut Ring', DONUT, { variationAxes: ['color', 'length'] });

    // ---- verify ----
    console.log('\n================ RESULTING STATE (in transaction) ================');
    const checks: [number, string, Var[]][] = [
      [193202, 'King Cock Cock w/ Balls', KCWB],
      [193266, 'King Cock Elite Dual Density', ELITE_PLAIN],
      [193279, 'King Cock Elite Vibrating Dual Density', [...ELITE_VIB_EXISTING, ...ELITE_VIB_INCOMING]],
      [446539, 'Realrock Crystal Clear Straight', RR_STRAIGHT],
      [594387, 'Realrock Extra Thick 9in (color-only, 9-in)', RR_THICK9],
      [594366, 'Realrock Non-Realistic Suction', RR_SUCTION],
      [195462, 'Wide Silicone Donut Ring', DONUT],
    ];
    for (const [id, label, vars] of checks) {
      const [cnt] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) c FROM wp_posts WHERE post_parent=? AND post_type='product_variation'`, [id]);
      // duplicate combo check
      const seen = new Set<string>(); let dups = 0;
      for (const v of vars) { const k = `${v.color || ''}|${v.length || ''}`; if (seen.has(k)) dups++; seen.add(k); }
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
