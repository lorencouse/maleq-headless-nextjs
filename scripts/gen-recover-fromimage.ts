/**
 * Stronger recovery for variable products with UNASSIGNED / incomplete variations
 * (e.g. realrock-straight-w-balls: some variations have NO attribute meta, color
 * axis missing entirely, length slugs non-canonical). Derives BOTH length and
 * color from each variation's image filename and wires a clean Length × Color axis.
 *
 * HARD self-guards (skip whole product if any fails):
 *   - every variation's image yields a plausible length (1–20 in) AND a known color
 *   - the resulting (length,color) combos are all unique
 * Creates missing pa_color / pa_length terms. Sets/INSERTs both attrs on EVERY
 * variation (incl. no-attr ones). Rebuilds the parent blob with both axes.
 *
 * Usage: bun run scripts/gen-recover-fromimage.ts <parentId>[,...]  -> scripts/recover-fromimage.sql
 */
import { getConnection } from './lib/db';
import { writeFileSync } from 'fs';

const q = (s: string) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const ps = (s: string) => `s:${Buffer.byteLength(s)}:"${s}"`;
const attrEntry = (tax: string, value: string, pos: number) => `${ps(tax)};a:6:{${ps('name')};${ps(tax)};${ps('value')};${ps(value)};${ps('position')};i:${pos};${ps('is_visible')};i:1;${ps('is_variation')};i:1;${ps('is_taxonomy')};i:1;}`;
const serializeAttrs = (es: { tax: string; value: string }[]) => `a:${es.length}:{${es.map((e, i) => attrEntry(e.tax, e.value, i)).join('')}}`;

const COLOR_ORDER = ['blue', 'pink', 'purple', 'green', 'turquoise', 'teal', 'aqua', 'red', 'black', 'white', 'flesh', 'tan', 'vanilla', 'brown', 'beige', 'mocha', 'caramel', 'chocolate', 'orange', 'yellow', 'gold', 'silver', 'nude', 'ivory', 'lavender', 'violet', 'rose', 'coral', 'navy', 'magenta', 'grey', 'gray', 'clear'];
const COLOR_NAME: Record<string, string> = { tan: 'Tan', vanilla: 'Vanilla', mocha: 'Mocha', flesh: 'Flesh', clear: 'Clear', brown: 'Brown', beige: 'Beige' };

// brand/product-name tokens that look like colors but aren't (avoid false color matches)
const NON_COLOR = new Set(['navy', 'aqua', 'rose']); // Swiss Navy, Aqua Lube, "the male rose" — brand/name, not color here
function parseImage(url: string): { len: string; color: string } | null {
  let base = (url.split('/').pop() || '').replace(/\.(webp|jpe?g|png|gif)$/i, '').toLowerCase();
  base = base.replace(/-\d+$/, ''); // strip trailing image index (-1)
  // REJECT volume/weight products — a number before oz/ml/g is volume, not length.
  if (/\b\d+(\.\d+)?\s*-?(oz|ml|g|gallon)\b/.test(base) || /-(oz|ml)$/.test(base) || /\blube\b|\boil\b|\bcream\b|\blotion\b|\bgel\b/.test(base)) return null;
  const tokens = base.split('-');
  // color = last known color token
  let color: string | null = null;
  for (let i = tokens.length - 1; i >= 0; i--) if (COLOR_ORDER.includes(tokens[i]) && !NON_COLOR.has(tokens[i])) { color = tokens[i]; break; }
  // length = a number token (optionally followed by in/long), plausible inches 1–20
  let len: string | null = null;
  for (const t of tokens) {
    const m = t.match(/^(\d+(?:\.\d+)?)(in|long)?$/);
    if (m) { const n = parseFloat(m[1]); if (n >= 1 && n <= 20) { len = `${n % 1 === 0 ? n : m[1]}-in`; break; } }
  }
  if (!color || !len) return null;
  return { len, color };
}

async function main() {
  const arg = process.argv.find((a) => /^\d/.test(a)) || '';
  const parents = arg.split(',').map((s) => parseInt(s, 10)).filter(Boolean);
  if (!parents.length) { console.error('pass parent id(s)'); process.exit(1); }
  const db = await getConnection();

  const [terms] = await db.query<any[]>(`SELECT t.slug, tt.taxonomy, tt.term_taxonomy_id ttid FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy IN ('pa_color','pa_length')`);
  const ttBy = new Map<string, number>(); for (const r of terms as any[]) ttBy.set(`${r.taxonomy}|${r.slug}`, r.ttid);

  const sql: string[] = ['SET autocommit=0;', 'START TRANSACTION;', ''];
  const skipped: number[] = []; const recovered: number[] = []; let cf = 0;
  const createdVar = new Map<string, string>();
  const ensureTerm = (tax: string, slug: string, name: string): string => {
    const key = `${tax}|${slug}`;
    if (ttBy.has(key)) return String(ttBy.get(key));
    if (createdVar.has(key)) return createdVar.get(key)!;
    cf++; sql.push(`INSERT INTO wp_terms (name, slug, term_group) VALUES (${q(name)}, ${q(slug)}, 0);`); sql.push(`SET @c${cf} := LAST_INSERT_ID();`); sql.push(`INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (@c${cf}, ${q(tax)}, '', 0, 0);`); sql.push(`SET @ct${cf} := LAST_INSERT_ID();`); createdVar.set(key, `@ct${cf}`); return `@ct${cf}`;
  };

  for (const parent of parents) {
    const [vars] = await db.query<any[]>(
      `SELECT v.ID,
          (SELECT guid FROM wp_posts WHERE ID=(SELECT meta_value FROM wp_postmeta WHERE post_id=v.ID AND meta_key='_thumbnail_id')) img,
          (SELECT meta_id FROM wp_postmeta WHERE post_id=v.ID AND meta_key='attribute_pa_color') colorMid,
          (SELECT meta_id FROM wp_postmeta WHERE post_id=v.ID AND meta_key='attribute_pa_length') lenMid
       FROM wp_posts v WHERE v.post_parent=${parent} AND v.post_type='product_variation' AND v.post_status<>'trash' ORDER BY v.ID`);
    const plan: { vid: number; len: string; color: string; colorMid: number | null; lenMid: number | null }[] = [];
    let bad = '';
    const combos = new Set<string>();
    for (const v of vars as any[]) {
      const p = v.img ? parseImage(v.img) : null;
      if (!p) { bad = `unparseable image: ${(v.img || '').split('/').pop()}`; break; }
      if (combos.has(`${p.len}|${p.color}`)) { bad = `dup combo ${p.len}|${p.color}`; break; }
      combos.add(`${p.len}|${p.color}`);
      plan.push({ vid: v.ID, len: p.len, color: p.color, colorMid: v.colorMid, lenMid: v.lenMid });
    }
    if (bad || !plan.length) { console.log(`p${parent}: skip — ${bad || 'no variations'}`); skipped.push(parent); continue; }

    recovered.push(parent);
    const lens = [...new Set(plan.map((p) => p.len))], colors = [...new Set(plan.map((p) => p.color))];
    sql.push(`-- ===== parent ${parent}: ${plan.length} variations (${lens.length} len × ${colors.length} color) =====`);
    const relTtids: string[] = [];
    for (const l of lens) relTtids.push(ensureTerm('pa_length', l, l.replace('-in', ' in')));
    for (const c of colors) relTtids.push(ensureTerm('pa_color', c, COLOR_NAME[c] || c.replace(/\b\w/g, (x) => x.toUpperCase())));
    for (const p of plan) {
      sql.push(p.lenMid ? `UPDATE wp_postmeta SET meta_value=${q(p.len)} WHERE meta_id=${p.lenMid};` : `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${p.vid}, 'attribute_pa_length', ${q(p.len)});`);
      sql.push(p.colorMid ? `UPDATE wp_postmeta SET meta_value=${q(p.color)} WHERE meta_id=${p.colorMid};` : `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${p.vid}, 'attribute_pa_color', ${q(p.color)});`);
    }
    sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES ${relTtids.map((tt) => `(${parent},${tt},0)`).join(', ')};`);
    const newBlob = serializeAttrs([{ tax: 'pa_length', value: lens.join(' | ') }, { tax: 'pa_color', value: colors.join(' | ') }]);
    sql.push(`UPDATE wp_postmeta SET meta_value=${q(newBlob)} WHERE post_id=${parent} AND meta_key='_product_attributes';`);
    sql.push('');
  }

  sql.push(`UPDATE wp_term_taxonomy tt SET count=(SELECT COUNT(*) FROM wp_term_relationships tr WHERE tr.term_taxonomy_id=tt.term_taxonomy_id) WHERE tt.taxonomy IN ('pa_color','pa_length');`);
  sql.push('COMMIT;');
  writeFileSync('scripts/recover-fromimage.sql', sql.join('\n') + '\n');
  console.log(`\nWrote scripts/recover-fromimage.sql — recovered ${recovered.length}, skipped ${skipped.length}, terms created ${cf}`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
