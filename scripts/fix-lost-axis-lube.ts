/**
 * Batch fix for the "lost axis" family — LUBE / TOPICAL group (flavor × volume).
 *
 * Per the category→attribute rules (CLAUDE.md), lubes/oils/sprays may only carry
 * volume + flavor. These products had their FLAVOR encoded as a bogus pa_color value
 * (e.g. "blue", "yellow", "peach-2-oz"); the true flavor+volume is in the image filename.
 *
 * Scope of THIS batch:
 *   195315  Sliquid Swirl                       flavor × volume (8 flavors × 4.2-oz/2-oz, 11 vars)
 *   196816  Smack (warming massage oil)         flavor-only (2-oz fixed): 6 flavors
 *   189222  Goodhead Juicy Head Sours Spray     flavor-only (2-oz fixed): 5 flavors
 *
 * Deferred / left alone:
 *   192113 "Rsh"      — garbage title, wrong category (Lingerie), duplicate NPR##/V## variation
 *                       pairs, mixed volume+color, no images -> needs triage, not relabeling.
 *   190724 Sex Slime  — already correct (colored slime: color×volume is legit and not duplicated).
 *
 * Safe by default: ONE transaction, ROLLS BACK + prints grids. Pass --apply to COMMIT.
 *   npx tsx scripts/fix-lost-axis-lube.ts            # dry-run
 *   npx tsx scripts/fix-lost-axis-lube.ts --apply    # commit
 * After --apply, on PROD: wp cache flush; wc tool run regenerate_product_lookup_tables;
 *                         wc tool run regenerate_product_attributes_lookup_table
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';
import { updateParentProductAttributes, ensureAttributeTerm, linkTermToProduct, updateMetaLookup } from './lib/variant-manager/db-mutations';

const APPLY = process.argv.includes('--apply');

const titleCase = (slug: string) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const volName = (slug: string) => slug.replace(/-oz$/, '').replace(/-/g, '.') + ' oz'; // "4.2-oz"->"4.2 oz", "2-oz"->"2 oz"
const volSort = (slug: string) => parseFloat(slug.replace(/-oz$/, '').replace(/-/g, '.'));

type Var = { id: number; flavor?: string; volume?: string };

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
  // these products mis-stored flavor in pa_color; clear all three to be safe, then set the right ones
  await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key IN ('attribute_pa_color','attribute_pa_flavor','attribute_pa_volume')`, [v.id]);
  const parts: string[] = [];
  if (v.flavor) { await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_flavor', ?)`, [v.id, v.flavor]); parts.push(titleCase(v.flavor)); }
  if (v.volume) { await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_volume', ?)`, [v.id, v.volume]); parts.push(volName(v.volume)); }
  await db.query(`UPDATE wp_posts SET post_title = ? WHERE ID = ?`, [`${title} - ${parts.join(', ')}`, v.id]);
}

async function fixInPlace(db: Connection, id: number, title: string, vars: Var[], opts: {
  variationAxes: ('flavor' | 'volume')[]; fixed?: { flavor?: string; volume?: string };
}) {
  for (const v of vars) await setVar(db, v, title);
  const flavors = [...new Set(vars.map((v) => v.flavor).filter(Boolean) as string[])];
  const volumes = [...new Set(vars.map((v) => v.volume).filter(Boolean) as string[])].sort((a, b) => volSort(a) - volSort(b));
  const flavorVar = opts.variationAxes.includes('flavor');
  const volumeVar = opts.variationAxes.includes('volume');
  const flavorVals = flavorVar ? flavors : opts.fixed?.flavor ? [opts.fixed.flavor] : [];
  const volumeVals = volumeVar ? volumes : opts.fixed?.volume ? [opts.fixed.volume] : [];
  const attrs: Record<string, any> = {}; let pos = 0;
  if (flavorVals.length) attrs.pa_flavor = { name: 'pa_flavor', value: flavorVals.join(' | '), position: pos++, is_visible: 1, is_variation: flavorVar ? 1 : 0, is_taxonomy: 1 };
  if (volumeVals.length) attrs.pa_volume = { name: 'pa_volume', value: volumeVals.join(' | '), position: pos++, is_visible: 1, is_variation: volumeVar ? 1 : 0, is_taxonomy: 1 };
  await updateParentProductAttributes(db, id, attrs);
  await unlinkTaxonomy(db, id, 'pa_color');
  await unlinkTaxonomy(db, id, 'pa_flavor');
  await unlinkTaxonomy(db, id, 'pa_volume');
  for (const f of flavorVals) await linkTermToProduct(db, id, await ensureAttributeTerm(db, 'pa_flavor', titleCase(f), f));
  for (const v of volumeVals) await linkTermToProduct(db, id, await ensureAttributeTerm(db, 'pa_volume', volName(v), v));
  await updateMetaLookup(db, id);
}

function grid(label: string, vars: Var[]) {
  const vols = [...new Set(vars.map((v) => v.volume || '(fixed)'))].sort((a, b) => volSort(a) - volSort(b));
  console.log(`  ${label}:`);
  for (const vol of vols) console.log(`    ${String(vol).padEnd(8)} -> ${vars.filter((v) => (v.volume || '(fixed)') === vol).map((v) => v.flavor).join(', ')}`);
}

// ---------------- Reconstructed specs (from image filenames) ----------------
const SLIQUID: Var[] = [ // 195315 Sliquid Swirl — flavor × volume
  { id: 195316, flavor: 'cherry-vanilla', volume: '4.2-oz' }, { id: 195317, flavor: 'pina-colada', volume: '4.2-oz' },
  { id: 195318, flavor: 'green-apple', volume: '4.2-oz' }, { id: 195319, flavor: 'blue-raspberry', volume: '4.2-oz' },
  { id: 195320, flavor: 'pink-lemonade', volume: '4.2-oz' }, { id: 195321, flavor: 'strawberry-pomegranate', volume: '4.2-oz' },
  { id: 195322, flavor: 'blackberry', volume: '4.2-oz' }, { id: 195323, flavor: 'tangerine-peach', volume: '4.2-oz' },
  { id: 195324, flavor: 'strawberry-pomegranate', volume: '2-oz' }, { id: 195325, flavor: 'tangerine-peach', volume: '2-oz' },
  { id: 195326, flavor: 'blue-raspberry', volume: '2-oz' },
];
const SMACK: Var[] = [ // 196816 Smack — flavor only, 2-oz fixed
  { id: 196817, flavor: 'blue-raspberry' }, { id: 196818, flavor: 'cherry' }, { id: 196819, flavor: 'passion-fruit' },
  { id: 196820, flavor: 'peach' }, { id: 196821, flavor: 'strawberry' }, { id: 196822, flavor: 'tropical' },
];
const GOODHEAD: Var[] = [ // 189222 Goodhead Juicy Head Sours — flavor only, 2-oz fixed
  { id: 189223, flavor: 'watermelon' }, { id: 189224, flavor: 'peach' }, { id: 189225, flavor: 'blue-raspberry' },
  { id: 189226, flavor: 'cherry' }, { id: 189227, flavor: 'green-apple' },
];

async function main() {
  const db = await getConnection();
  await db.query('START TRANSACTION');
  try {
    await fixInPlace(db, 195315, 'Sliquid Swirl', SLIQUID, { variationAxes: ['flavor', 'volume'] });
    await fixInPlace(db, 196816, 'Smack', SMACK, { variationAxes: ['flavor'], fixed: { volume: '2-oz' } });
    await fixInPlace(db, 189222, 'Goodhead Juicy Head Sours Mouth Spray', GOODHEAD, { variationAxes: ['flavor'], fixed: { volume: '2-oz' } });

    console.log('\n================ RESULTING STATE (in transaction) ================');
    const checks: [number, string, Var[]][] = [
      [195315, 'Sliquid Swirl (flavor × volume)', SLIQUID],
      [196816, 'Smack (flavor-only, 2-oz)', SMACK],
      [189222, 'Goodhead Juicy Head Sours (flavor-only, 2-oz)', GOODHEAD],
    ];
    for (const [id, label, vars] of checks) {
      const [cnt] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) c FROM wp_posts WHERE post_parent=? AND post_type='product_variation'`, [id]);
      const seen = new Set<string>(); let dups = 0;
      for (const v of vars) { const k = `${v.flavor || ''}|${v.volume || ''}`; if (seen.has(k)) dups++; seen.add(k); }
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
