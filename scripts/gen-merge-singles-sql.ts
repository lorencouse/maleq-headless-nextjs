/**
 * APPLY (missedIntoVar): convert standalone SINGLE products into variations of an
 * existing VARIABLE parent (the line they belong to). Driven by the detector's
 * scripts/product-line-candidates.json. Per single:
 *   - reparent: post_type=product_variation, post_parent=<parent>, retitled
 *   - set attribute_pa_length / attribute_pa_color from the detected axis values
 *   - strip product-level cruft (term rels: product_type/cat/tag/brand/pa_*;
 *     meta: _product_attributes/_default_attributes) — variations carry none
 *   - ensure the PARENT has the size/color term rels + blob value lists
 *   - emit a 301 redirect (single slug -> parent slug) for lib/redirects
 * SELF-GUARDS: a single is skipped if it lacks a size or color, or its (size,color)
 * combo already exists on the parent (would duplicate).
 *
 * Usage: bun run scripts/gen-merge-singles-sql.ts <parentId>
 *   -> scripts/migrate-merge-singles.sql + scripts/merge-singles-redirects.json
 */
import { getConnection } from './lib/db';
import { writeFileSync } from 'fs';
import candidates from './product-line-candidates.json';

const q = (s: string) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const ps = (s: string) => `s:${Buffer.byteLength(s)}:"${s}"`;
const TITLE = (parent: string, size?: string, color?: string) =>
  `${parent} - ${[size ? size.replace('-in', ' in').replace('-', ' ') : '', color ? color[0].toUpperCase() + color.slice(1) : ''].filter(Boolean).join(', ')}`;

async function main() {
  const parentId = parseInt(process.argv.find((a) => /^\d+$/.test(a)) || '', 10);
  if (!parentId) { console.error('pass parent id'); process.exit(1); }
  const group = (candidates as any).missedIntoVar.find((g: any) => g.members.some((m: any) => m.id === parentId && m.type === 'VAR'));
  if (!group) { console.error(`no missedIntoVar group with VAR parent ${parentId}`); process.exit(1); }
  const singles = group.members.filter((m: any) => m.type === 'single');
  console.log(`group "${group.base}" — parent ${parentId}, ${singles.length} singles to merge`);

  const db = await getConnection();
  const [[par]] = await db.query<any[]>(`SELECT post_name slug, post_title title FROM wp_posts WHERE ID=${parentId}`);
  if (!par) { console.error('parent not found'); process.exit(1); }

  // parent term lookups (pa_length / pa_color) + existing combos
  const [pterms] = await db.query<any[]>(`SELECT t.slug, tt.taxonomy, tt.term_taxonomy_id ttid FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy IN ('pa_length','pa_color','pa_size','pa_volume')`);
  const ttBy = new Map<string, number>(); for (const r of pterms as any[]) ttBy.set(`${r.taxonomy}|${r.slug}`, r.ttid);
  const [combos] = await db.query<any[]>(`
    SELECT CONCAT(IFNULL((SELECT meta_value FROM wp_postmeta WHERE post_id=v.ID AND meta_key='attribute_pa_length'),''),'|',IFNULL((SELECT meta_value FROM wp_postmeta WHERE post_id=v.ID AND meta_key='attribute_pa_color'),'')) c
    FROM wp_posts v WHERE v.post_parent=${parentId} AND v.post_type='product_variation'`);
  const existing = new Set<string>((combos as any[]).map((r) => r.c));

  // parent's current blob (to extend value lists)
  const [[blobRow]] = await db.query<any[]>(`SELECT meta_value FROM wp_postmeta WHERE post_id=${parentId} AND meta_key='_product_attributes'`);
  const blob: string = blobRow?.meta_value || '';
  const lenVals = new Set<string>(((blob.match(/pa_length";a:6:\{[^}]*?s:5:"value";s:\d+:"([^"]*)"/)?.[1]) || '').split(/\s*\|\s*/).filter(Boolean));
  const colVals = new Set<string>(((blob.match(/pa_color";a:6:\{[^}]*?s:5:"value";s:\d+:"([^"]*)"/)?.[1]) || '').split(/\s*\|\s*/).filter(Boolean));

  const sql: string[] = ['SET autocommit=0;', 'START TRANSACTION;', ''];
  const redirects: Record<string, string> = {};
  const need: { tax: string; slug: string }[] = [];
  let menu = 100, merged = 0;
  const skipped: string[] = [];

  for (const s of singles) {
    const size = s.size as string | undefined, color = s.color as string | undefined;
    if (!size && !color) { skipped.push(`${s.id} (no axis)`); continue; }
    const key = `${size || ''}|${color || ''}`;
    if (existing.has(key)) { skipped.push(`${s.id} (combo ${key} exists)`); continue; }
    existing.add(key);
    const [[srow]] = await db.query<any[]>(`SELECT post_name slug FROM wp_posts WHERE ID=${s.id}`);
    merged++;
    sql.push(`-- single ${s.id} (${srow?.slug}) -> variation ${size}/${color}`);
    sql.push(`UPDATE wp_posts SET post_type='product_variation', post_parent=${parentId}, post_status='publish', menu_order=${menu++}, post_title=${q(TITLE(par.title, size, color))} WHERE ID=${s.id};`);
    // set axis postmeta (insert if missing, else update)
    const setAttr = (k: string, v?: string) => { if (!v) return; sql.push(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) SELECT ${s.id}, '${k}', ${q(v)} FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM wp_postmeta WHERE post_id=${s.id} AND meta_key='${k}'); UPDATE wp_postmeta SET meta_value=${q(v)} WHERE post_id=${s.id} AND meta_key='${k}';`); };
    setAttr('attribute_pa_length', size); setAttr('attribute_pa_color', color);
    // strip product-level term rels + blob meta from the (now) variation
    sql.push(`DELETE r FROM wp_term_relationships r JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id=r.term_taxonomy_id WHERE r.object_id=${s.id} AND tt.taxonomy IN ('product_type','product_cat','product_tag','product_brand','pa_color','pa_size','pa_length','pa_volume','pa_flavor','pa_material','product_visibility');`);
    sql.push(`DELETE FROM wp_postmeta WHERE post_id=${s.id} AND meta_key IN ('_product_attributes','_default_attributes');`);
    // redirect old single slug -> parent
    if (srow?.slug) redirects[srow.slug] = par.slug;
    // parent needs term rels for the new size/color
    if (size && !lenVals.has(size)) { lenVals.add(size); need.push({ tax: 'pa_length', slug: size }); }
    if (color && !colVals.has(color)) { colVals.add(color); need.push({ tax: 'pa_color', slug: color }); }
  }

  // ensure parent term relationships for any new size/color values
  for (const n of need) {
    const ttid = ttBy.get(`${n.tax}|${n.slug}`);
    if (ttid) sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (${parentId}, ${ttid}, 0);`);
    else sql.push(`-- WARN: parent term missing ${n.tax}|${n.slug} (manual)`);
  }
  // rebuild parent blob value lists (length + color) if they grew
  if (need.length) {
    const lenStr = [...lenVals].join(' | '), colStr = [...colVals].join(' | ');
    const newBlob = `a:2:{${ps('pa_length')};a:6:{${ps('name')};${ps('pa_length')};${ps('value')};${ps(lenStr)};${ps('position')};i:0;${ps('is_visible')};i:1;${ps('is_variation')};i:1;${ps('is_taxonomy')};i:1;}${ps('pa_color')};a:6:{${ps('name')};${ps('pa_color')};${ps('value')};${ps(colStr)};${ps('position')};i:1;${ps('is_visible')};i:1;${ps('is_variation')};i:1;${ps('is_taxonomy')};i:1;}}`;
    sql.push(`UPDATE wp_postmeta SET meta_value=${q(newBlob)} WHERE post_id=${parentId} AND meta_key='_product_attributes';`);
  }
  sql.push('', `UPDATE wp_term_taxonomy tt SET count=(SELECT COUNT(*) FROM wp_term_relationships tr WHERE tr.term_taxonomy_id=tt.term_taxonomy_id) WHERE tt.taxonomy IN ('pa_length','pa_color');`);
  sql.push('COMMIT;');
  writeFileSync('scripts/migrate-merge-singles.sql', sql.join('\n') + '\n');
  writeFileSync('scripts/merge-singles-redirects.json', JSON.stringify(redirects, null, 2));
  console.log(`Wrote scripts/migrate-merge-singles.sql — merged ${merged}, skipped ${skipped.length}${skipped.length ? ' (' + skipped.join(', ') + ')' : ''}`);
  console.log(`Redirects: ${Object.keys(redirects).length} -> ${par.slug}`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
