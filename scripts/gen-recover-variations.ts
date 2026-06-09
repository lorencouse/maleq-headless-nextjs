/**
 * Recover variable products with DUPLICATE variation combos caused by a missing
 * COLOR axis — the color is recoverable from each variation's image filename.
 * Re-wires color as a proper variation axis alongside the existing axis.
 *
 * For each target parent:
 *   - parse color slug from each variation's _thumbnail_id image filename
 *   - set/insert attribute_pa_color postmeta per variation
 *   - canonicalize the existing axis value per variation (e.g. 6in -> 6-in)
 *   - ensure parent has pa_color + canonical existing-axis term relationships
 *   - rebuild parent _product_attributes declaring BOTH axes as variations
 *   - SKIP a parent if any variation's color can't be parsed (flagged for review)
 *
 * Usage: bun run scripts/gen-recover-variations.ts <parentId>[,<parentId>...]
 *        -> writes scripts/recover-variations.sql + prints per-parent plan
 */
import { getConnection } from './lib/db';
import { writeFileSync } from 'fs';

const q = (s: string) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
// PHP serialize string: s:<bytelen>:"..."
const ps = (s: string) => `s:${Buffer.byteLength(s)}:"${s}"`;
const attrEntry = (taxSlug: string, valueStr: string, position: number) =>
  `${ps(taxSlug)};a:6:{${ps('name')};${ps(taxSlug)};${ps('value')};${ps(valueStr)};${ps('position')};i:${position};${ps('is_visible')};i:1;${ps('is_variation')};i:1;${ps('is_taxonomy')};i:1;}`;
const serializeAttrs = (entries: { tax: string; value: string }[]) =>
  `a:${entries.length}:{${entries.map((e, i) => attrEntry(e.tax, e.value, i)).join('')}}`;

const COLORS = ['crystal-clear', 'clear-blue', 'clear-pink', 'clear-purple', 'clear', 'flesh', 'black', 'white', 'red', 'blue', 'pink', 'purple', 'green', 'turquoise', 'teal', 'aqua', 'brown', 'beige', 'tan', 'grey', 'gray', 'orange', 'yellow', 'gold', 'silver', 'nude', 'ivory', 'lavender', 'violet', 'rose', 'coral', 'navy', 'magenta'];
// resolve an image basename to a single canonical color slug (last meaningful color token)
function colorFromImage(url: string): string | null {
  const base = (url.split('/').pop() || '').replace(/\.(webp|jpe?g|png|gif)$/i, '').replace(/-\d+$/, '').toLowerCase();
  // composite "clear-X" / "crystal-clear" -> prefer the tint color over the base
  if (/crystal-clear|^.*-clear$/.test(base) && !/-(blue|pink|purple|green|turquoise|red)/.test(base)) return 'clear';
  const order = ['blue', 'pink', 'purple', 'green', 'turquoise', 'teal', 'aqua', 'red', 'black', 'white', 'flesh', 'brown', 'beige', 'tan', 'orange', 'yellow', 'gold', 'silver', 'nude', 'ivory', 'lavender', 'violet', 'rose', 'coral', 'navy', 'magenta', 'grey', 'gray', 'clear'];
  const tokens = base.split('-');
  // last token that is a known color
  for (let i = tokens.length - 1; i >= 0; i--) if (order.includes(tokens[i])) return tokens[i];
  return null;
}
const canonLen = (slug: string) => slug.replace(/^(\d+(?:\.\d+)?)in$/, '$1-in').replace(/^(\d+)-in$/, '$1-in');

async function main() {
  const arg = process.argv.find((a) => /^\d/.test(a)) || process.argv[process.argv.length - 1];
  const parents = (arg || '').split(',').map((s) => parseInt(s, 10)).filter(Boolean);
  if (!parents.length) { console.error('pass parent id(s)'); process.exit(1); }
  const db = await getConnection();

  // term lookup for pa_color / pa_length (and pa_size as fallback existing axis)
  const [terms] = await db.query<any[]>(`SELECT t.slug, t.name, tt.taxonomy, tt.term_taxonomy_id ttid FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy IN ('pa_color','pa_length','pa_size','pa_volume')`);
  const ttBy = new Map<string, { ttid: number; name: string }>(); // "tax|slug"
  for (const r of terms as any[]) ttBy.set(`${r.taxonomy}|${r.slug}`, { ttid: r.ttid, name: r.name });

  const sql: string[] = ['SET autocommit=0;', 'START TRANSACTION;', ''];
  const skipped: number[] = []; let okCount = 0;

  for (const parent of parents) {
    // existing variation axis from blob
    const [[blobRow]] = await db.query<any[]>(`SELECT meta_value FROM wp_postmeta WHERE post_id=${parent} AND meta_key='_product_attributes'`);
    const blob: string = blobRow?.meta_value || '';
    const axisMatch = blob.match(/s:\d+:"(pa_(?:length|size|volume))"/);
    const existingTax = axisMatch ? axisMatch[1] : null;
    if (!existingTax) { console.log(`p${parent}: no length/size axis in blob — skip`); skipped.push(parent); continue; }

    // variations: existing-axis value + image
    const [vars] = await db.query<any[]>(
      `SELECT v.ID,
          (SELECT meta_value FROM wp_postmeta WHERE post_id=v.ID AND meta_key='attribute_${existingTax}') axisval,
          (SELECT guid FROM wp_posts WHERE ID=(SELECT meta_value FROM wp_postmeta WHERE post_id=v.ID AND meta_key='_thumbnail_id')) img,
          (SELECT meta_id FROM wp_postmeta WHERE post_id=v.ID AND meta_key='attribute_pa_color') colorMetaId,
          (SELECT meta_id FROM wp_postmeta WHERE post_id=v.ID AND meta_key='attribute_${existingTax}') axisMetaId
       FROM wp_posts v WHERE v.post_parent=${parent} AND v.post_type='product_variation' ORDER BY v.ID`);

    const plan: { vid: number; axis: string; color: string; colorMetaId: number | null; axisMetaId: number | null }[] = [];
    let bad = false;
    const colorsUsed = new Set<string>(), axisUsed = new Set<string>();
    for (const v of vars as any[]) {
      const color = v.img ? colorFromImage(v.img) : null;
      const axisCanon = existingTax === 'pa_length' ? canonLen(v.axisval || '') : (v.axisval || '');
      if (!color || !axisCanon) { bad = true; break; }
      plan.push({ vid: v.ID, axis: axisCanon, color, colorMetaId: v.colorMetaId, axisMetaId: v.axisMetaId });
      colorsUsed.add(color); axisUsed.add(axisCanon);
    }
    if (bad || !plan.length) { console.log(`p${parent}: color/axis not fully parseable — skip (review)`); skipped.push(parent); continue; }

    // verify every (color) term exists in pa_color and every axis term exists
    let missing = false;
    for (const c of colorsUsed) if (!ttBy.has(`pa_color|${c}`)) { console.log(`p${parent}: pa_color term missing for "${c}" — skip`); missing = true; break; }
    for (const a of axisUsed) if (!ttBy.has(`${existingTax}|${a}`)) { console.log(`p${parent}: ${existingTax} term missing for "${a}" — skip`); missing = true; break; }
    if (missing) { skipped.push(parent); continue; }

    // SAFETY: adding color must make every variation uniquely identified. If the
    // (axis,color) combos still collide, color wasn't the (sole) missing axis -> skip.
    const combos = new Set(plan.map((p) => `${p.axis}|${p.color}`));
    if (combos.size !== plan.length) { console.log(`p${parent}: color doesn't fully de-dup (${combos.size}/${plan.length}) — skip (review)`); skipped.push(parent); continue; }

    okCount++;
    sql.push(`-- ===== parent ${parent} (${existingTax} × pa_color): ${plan.length} variations =====`);
    // per-variation: set color + canonical axis value
    for (const p of plan) {
      if (p.colorMetaId) sql.push(`UPDATE wp_postmeta SET meta_value=${q(p.color)} WHERE meta_id=${p.colorMetaId};`);
      else sql.push(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${p.vid}, 'attribute_pa_color', ${q(p.color)});`);
      if (p.axisMetaId) sql.push(`UPDATE wp_postmeta SET meta_value=${q(p.axis)} WHERE meta_id=${p.axisMetaId};`);
    }
    // parent term relationships: ensure color + canonical axis present
    const relTTs = [...[...colorsUsed].map((c) => ttBy.get(`pa_color|${c}`)!.ttid), ...[...axisUsed].map((a) => ttBy.get(`${existingTax}|${a}`)!.ttid)];
    sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES ${relTTs.map((tt) => `(${parent},${tt},0)`).join(', ')};`);
    // rebuild parent _product_attributes blob (existing axis canonical values + color)
    const axisVals = [...axisUsed].join(' | ');
    const colorVals = [...colorsUsed].join(' | ');
    const newBlob = serializeAttrs([{ tax: existingTax, value: axisVals }, { tax: 'pa_color', value: colorVals }]);
    sql.push(`UPDATE wp_postmeta SET meta_value=${q(newBlob)} WHERE post_id=${parent} AND meta_key='_product_attributes';`);
    sql.push('');
  }

  sql.push(`UPDATE wp_term_taxonomy tt SET count=(SELECT COUNT(*) FROM wp_term_relationships tr WHERE tr.term_taxonomy_id=tt.term_taxonomy_id) WHERE tt.taxonomy IN ('pa_color','pa_length','pa_size','pa_volume');`);
  sql.push('COMMIT;');
  writeFileSync('scripts/recover-variations.sql', sql.join('\n') + '\n');
  console.log(`\nWrote scripts/recover-variations.sql — recovered ${okCount} parents, skipped ${skipped.length}`);
  if (skipped.length) console.log('  skipped:', skipped.join(','));
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
