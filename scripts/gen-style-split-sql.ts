/**
 * Distribute pa_style's leaked color/size/flavor/material values to their proper
 * taxonomies via per-product axis migration (same proven mechanics as the size split).
 *
 *   VARIABLE product, PURE color axis    -> rename axis to pa_color
 *   VARIABLE product, PURE size axis     -> rename axis to pa_size  (values canonicalized sm->s, lg->l …)
 *   VARIABLE product, PURE flavor axis   -> pa_flavor
 *   VARIABLE product, PURE material axis -> pa_material
 *   SIMPLE product: repoint its color/size/flavor/material pa_style rels per-dim
 *   MIXED axis + junk-only products      -> LEFT on pa_style (deferred)
 *
 * Per moved value: repoint term_relationship to the (canonical) target term (reuse
 * existing or create), rename variation meta_key (+ remap value for size canon),
 * rewrite _product_attributes/_default_attributes blob token, delete emptied pa_style terms.
 *
 * Usage: bun run scripts/gen-style-split-sql.ts   # PROD via tunnel -> scripts/migrate-style-split.sql + scripts/style-split-mixed-review.json
 */
import { getConnection } from './lib/db';
import { writeFileSync } from 'fs';

const q = (s: string) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// apparel slug -> canonical pa_size slug (so sm/lg/etc. land on the cleaned terms)
const SIZE_CANON: Record<string, string> = {
  xs: 'xs', 'x-small': 'xs', s: 's', small: 's', sm: 's', sml: 's',
  m: 'm', medium: 'm', med: 'm', l: 'l', large: 'l', lg: 'l', lar: 'l',
  xl: 'xl', 'x-large': 'xl', xxl: '2xl', 'xx-large': '2xl', '2xl': '2xl',
  xxxl: '3xl', 'xxx-large': '3xl', '3xl': '3xl', 'xxxx-large': '4xl', '4xl': '4xl',
  's-m': 's-m', 'm-l': 'm-l', 'l-xl': 'l-xl', lxl: 'l-xl', 'xl-2xl': 'xl-2xl',
  'one-size': 'one-size', os: 'one-size', 'o-s': 'one-size',
  queen: 'queen', qs: 'queen', 'q-s': 'queen',
  '1x': '1x', '2x': '2x', '3x': '3x', '4x': '4x', plus: 'plus', petite: 'petite', king: 'king', mini: 'mini',
};
const SIZE_NAME: Record<string, string> = { xs: 'X-Small', s: 'Small', m: 'Medium', l: 'Large', xl: 'X-Large', '2xl': 'XX-Large', '3xl': 'XXX-Large', '4xl': 'XXXX-Large', 's-m': 'S/M', 'm-l': 'M/L', 'l-xl': 'L/XL', 'xl-2xl': 'XL/XXL', 'one-size': 'One Size', queen: 'Queen', '1x': '1X', '2x': '2X', '3x': '3X', '4x': '4X', plus: 'Plus', petite: 'Petite', king: 'King', mini: 'Mini' };

const COLOR_WORDS = new Set(['black','white','red','blue','pink','purple','clear','flesh','beige','tan','green','yellow','gold','silver','nude','ivory','brown','grey','gray','orange','teal','aqua','burgundy','turquoise','navy','coral','lavender','violet','rose','peach','cobalt','garnet','periwinkle','neon','royal','translucent','magenta','mint','dark']);
const MATERIAL_WORDS = new Set(['silicone','glass','metal','steel','leather','latex','rubber','tpe','tpr','jelly','vinyl','mesh']);

async function main() {
  const db = await getConnection();
  const [vocab] = await db.query<any[]>(`SELECT t.slug, t.name, tt.taxonomy, tt.term_taxonomy_id ttid FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy IN ('pa_color','pa_flavor','pa_material','pa_size')`);
  const vtt = new Map<string, number>(); const colorSet = new Set<string>(), flavorSet = new Set<string>(), matSet = new Set<string>(), sizeSet = new Set<string>();
  for (const r of vocab as any[]) { vtt.set(`${r.taxonomy}|${r.slug}`, r.ttid); if (r.taxonomy === 'pa_color') colorSet.add(r.slug); else if (r.taxonomy === 'pa_flavor') flavorSet.add(r.slug); else if (r.taxonomy === 'pa_material') matSet.add(r.slug); else sizeSet.add(r.slug); }

  type Dim = 'color' | 'size' | 'flavor' | 'material' | 'other';
  const dimOf = (slug: string): Dim => {
    if (colorSet.has(slug) || COLOR_WORDS.has(slug)) return 'color';
    if (SIZE_CANON[slug]) return 'size';
    if (matSet.has(slug) || MATERIAL_WORDS.has(slug)) return 'material';
    if (flavorSet.has(slug)) return 'flavor';
    return 'other';
  };
  const DIM_TAX: Record<string, string> = { color: 'pa_color', size: 'pa_size', flavor: 'pa_flavor', material: 'pa_material' };
  // canonical (slug,name) in the target taxonomy for a style value
  const canon = (dim: Dim, slug: string): { slug: string; name: string } => {
    if (dim === 'size') { const c = SIZE_CANON[slug] || slug; return { slug: c, name: SIZE_NAME[c] || c.replace(/-/g, ' ') }; }
    return { slug, name: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) };
  };

  // pa_style terms
  const [styleTerms] = await db.query<any[]>(`SELECT t.term_id, t.name, t.slug, tt.term_taxonomy_id ttid FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy='pa_style'`);
  const styleTT = new Map<string, { term_id: number; ttid: number }>(); const ttidToSlug = new Map<number, string>();
  for (const r of styleTerms as any[]) { styleTT.set(r.slug, { term_id: r.term_id, ttid: r.ttid }); ttidToSlug.set(r.ttid, r.slug); }
  const styleTTs = (styleTerms as any[]).map((r) => r.ttid);

  // variable products + style variation values
  const [vars] = await db.query<any[]>(`SELECT p.post_parent parent, pm.meta_value slug FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation' WHERE pm.meta_key='attribute_pa_style' AND pm.meta_value<>''`);
  const parentSlugs = new Map<number, Set<string>>();
  for (const v of vars as any[]) (parentSlugs.get(v.parent) || parentSlugs.set(v.parent, new Set()).get(v.parent)!).add(v.slug);
  const variableIds = new Set<number>(parentSlugs.keys());

  // classify pure parents — STRICT: every value must be the same single real dim,
  // with NO junk ('other') values. This prevents polluting the target taxonomy with
  // ride-along junk and guarantees the renamed axis fully resolves.
  const pureParent = new Map<number, Dim>(); const mixedReview: any[] = [];
  for (const [parent, slugs] of parentSlugs) {
    const dims = new Set([...slugs].map(dimOf));
    if (dims.size === 1 && !dims.has('other')) pureParent.set(parent, [...dims][0] as Dim);
    else if ([...dims].some((d) => d !== 'other') && dims.size > 1) mixedReview.push({ parent, dims: [...dims], values: [...slugs] });
    // anything containing 'other' (junk) or junk-only -> stays pa_style
  }

  // all pa_style relationships
  const [rels] = await db.query<any[]>(`SELECT object_id, term_taxonomy_id FROM wp_term_relationships WHERE term_taxonomy_id IN (${styleTTs.join(',')})`);
  const relsByObj = new Map<number, number[]>();
  for (const r of rels as any[]) (relsByObj.get(r.object_id) || relsByObj.set(r.object_id, []).get(r.object_id)!).push(r.term_taxonomy_id);

  // build repoints: (object, fromStyleTT|null, target tax, canonical slug+name)
  type RP = { obj: number; fromTT: number | null; tax: string; slug: string; name: string };
  const rps: RP[] = []; const seen = new Set<string>();
  const addRP = (obj: number, fromTT: number | null, dim: Dim, styleSlug: string) => {
    if (dim === 'other') return; const tax = DIM_TAX[dim]; const c = canon(dim, styleSlug);
    const k = `${obj}|${tax}|${c.slug}`; if (seen.has(k)) return; seen.add(k);
    rps.push({ obj, fromTT, tax, slug: c.slug, name: c.name });
  };
  // pure variable: FORCE every rel + every variation value (incl. stray junk) to the
  // parent's pure dim, so renaming the whole axis leaves nothing dangling.
  for (const [obj, ttids] of relsByObj) {
    if (pureParent.has(obj)) { const dim = pureParent.get(obj)!; for (const tt of ttids) addRP(obj, tt, dim, ttidToSlug.get(tt)!); }
    else if (!variableIds.has(obj)) { for (const tt of ttids) addRP(obj, tt, dimOf(ttidToSlug.get(tt)!), ttidToSlug.get(tt)!); } // simple: per-dim, skip junk
  }
  for (const [parent, slugs] of parentSlugs) { if (!pureParent.has(parent)) continue; const dim = pureParent.get(parent)!; for (const s of slugs) addRP(parent, styleTT.get(s)?.ttid ?? null, dim, s); }

  // ---- SQL ----
  const sql: string[] = ['SET autocommit=0;', 'START TRANSACTION;', ''];
  // create missing target terms
  const needTerm = new Map<string, string>(); for (const r of rps) { const key = `${r.tax}|${r.slug}`; if (!vtt.has(key)) needTerm.set(key, r.name); }
  sql.push('-- create missing target terms');
  const createdVar = new Map<string, string>(); let ct = 0;
  for (const [key, name] of needTerm) { const [tax] = key.split('|'); const slug = key.slice(tax.length + 1); ct++; sql.push(`INSERT INTO wp_terms (name, slug, term_group) VALUES (${q(name)}, ${q(slug)}, 0);`); sql.push(`SET @s${ct} := LAST_INSERT_ID();`); sql.push(`INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (@s${ct}, ${q(tax)}, '', 0, 0);`); sql.push(`SET @st${ct} := LAST_INSERT_ID();`); createdVar.set(key, `@st${ct}`); }
  const ttExpr = (tax: string, slug: string) => createdVar.get(`${tax}|${slug}`) ?? String(vtt.get(`${tax}|${slug}`));

  // repoint relationships
  sql.push('', '-- repoint relationships to color/size/flavor/material');
  const addByTarget = new Map<string, number[]>(); const delByFrom = new Map<number, number[]>();
  for (const r of rps) { (addByTarget.get(`${r.tax}|${r.slug}`) || addByTarget.set(`${r.tax}|${r.slug}`, []).get(`${r.tax}|${r.slug}`)!).push(r.obj); if (r.fromTT != null) (delByFrom.get(r.fromTT) || delByFrom.set(r.fromTT, []).get(r.fromTT)!).push(r.obj); }
  for (const [key, objs] of addByTarget) { const [tax] = key.split('|'); const slug = key.slice(tax.length + 1); const u = [...new Set(objs)]; for (let i = 0; i < u.length; i += 500) sql.push(`INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) SELECT ID, ${ttExpr(tax, slug)}, 0 FROM wp_posts WHERE ID IN (${u.slice(i, i + 500).join(',')});`); }
  sql.push('', '-- detach moved objects from pa_style');
  for (const [fromTT, objs] of delByFrom) { const u = [...new Set(objs)]; for (let i = 0; i < u.length; i += 500) sql.push(`DELETE FROM wp_term_relationships WHERE term_taxonomy_id=${fromTT} AND object_id IN (${u.slice(i, i + 500).join(',')});`); }

  // variation meta: rename key (by parent) + remap size values to canonical
  sql.push('', '-- rename variation axis meta_key (by parent) + canonicalize size values');
  const parentsByDim: Record<string, number[]> = { color: [], size: [], flavor: [], material: [] };
  for (const [parent, dim] of pureParent) parentsByDim[dim].push(parent);
  for (const [dim, parents] of Object.entries(parentsByDim)) {
    if (!parents.length) continue; const tax = DIM_TAX[dim];
    for (let i = 0; i < parents.length; i += 500) sql.push(`UPDATE wp_postmeta SET meta_key=${q('attribute_' + tax)} WHERE meta_key='attribute_pa_style' AND post_id IN (SELECT ID FROM wp_posts WHERE post_type='product_variation' AND post_parent IN (${parents.slice(i, i + 500).join(',')}));`);
    if (dim === 'size') for (const [from, to] of Object.entries(SIZE_CANON)) if (from !== to) sql.push(`UPDATE wp_postmeta SET meta_value=${q(to)} WHERE meta_key='attribute_pa_size' AND meta_value=${q(from)} AND post_id IN (SELECT ID FROM wp_posts WHERE post_type='product_variation' AND post_parent IN (${parents.join(',')}));`);
  }

  // rewrite blobs
  sql.push('', '-- rewrite _product_attributes / _default_attributes blob tokens');
  for (const [dim, parents] of Object.entries(parentsByDim)) { if (!parents.length) continue; const to = DIM_TAX[dim]; const tok = to.length === 8 ? `s:8:"${to}"` : `s:9:"${to}"`; for (let i = 0; i < parents.length; i += 500) sql.push(`UPDATE wp_postmeta SET meta_value=REPLACE(meta_value,'s:8:"pa_style"','${tok}') WHERE post_id IN (${parents.slice(i, i + 500).join(',')}) AND meta_key IN ('_product_attributes','_default_attributes') AND meta_value LIKE '%s:8:"pa_style"%';`); }
  // simple products' blobs
  const simpleByDim: Record<string, Set<number>> = { color: new Set(), size: new Set(), flavor: new Set(), material: new Set() };
  for (const r of rps) if (!variableIds.has(r.obj)) { const dim = Object.keys(DIM_TAX).find((d) => DIM_TAX[d] === r.tax)!; simpleByDim[dim].add(r.obj); }
  for (const [dim, set] of Object.entries(simpleByDim)) { if (!set.size) continue; const to = DIM_TAX[dim]; const tok = to.length === 8 ? `s:8:"${to}"` : `s:9:"${to}"`; const arr = [...set]; for (let i = 0; i < arr.length; i += 500) sql.push(`UPDATE wp_postmeta SET meta_value=REPLACE(meta_value,'s:8:"pa_style"','${tok}') WHERE post_id IN (${arr.slice(i, i + 500).join(',')}) AND meta_key IN ('_product_attributes','_default_attributes') AND meta_value LIKE '%s:8:"pa_style"%';`); }

  // catch-all: align any residual child attribute_pa_style on moved parents/products
  // (empty "Any" values that weren't in parentSlugs because the value was '')
  sql.push('', '-- align residual child attribute_pa_style on moved parents (empty "Any" values)');
  const alignParents: Record<string, Set<number>> = { color: new Set(parentsByDim.color), size: new Set(parentsByDim.size), flavor: new Set(parentsByDim.flavor), material: new Set(parentsByDim.material) };
  for (const [dim, set] of Object.entries(simpleByDim)) for (const p of set) alignParents[dim].add(p);
  for (const [dim, set] of Object.entries(alignParents)) {
    if (!set.size) continue; const tax = DIM_TAX[dim]; const arr = [...set];
    for (let i = 0; i < arr.length; i += 500) sql.push(`UPDATE wp_postmeta SET meta_key=${q('attribute_' + tax)} WHERE meta_key='attribute_pa_style' AND post_id IN (SELECT ID FROM wp_posts WHERE post_type='product_variation' AND post_parent IN (${arr.slice(i, i + 500).join(',')}));`);
  }

  // delete emptied pa_style terms
  sql.push('', '-- delete emptied pa_style terms');
  const movedTermIds = [...new Set(rps.filter((r) => r.fromTT != null).map((r) => { const slug = ttidToSlug.get(r.fromTT!); return styleTT.get(slug!)!.term_id; }))];
  if (movedTermIds.length) { sql.push(`DELETE tt FROM wp_term_taxonomy tt WHERE tt.taxonomy='pa_style' AND tt.term_id IN (${movedTermIds.join(',')}) AND NOT EXISTS (SELECT 1 FROM wp_term_relationships r WHERE r.term_taxonomy_id=tt.term_taxonomy_id);`); sql.push(`DELETE FROM wp_terms WHERE term_id IN (${movedTermIds.join(',')}) AND term_id NOT IN (SELECT term_id FROM wp_term_taxonomy);`); }

  sql.push('', '-- recount');
  sql.push(`UPDATE wp_term_taxonomy tt SET count=(SELECT COUNT(*) FROM wp_term_relationships tr WHERE tr.term_taxonomy_id=tt.term_taxonomy_id) WHERE tt.taxonomy IN ('pa_style','pa_color','pa_size','pa_flavor','pa_material');`);
  sql.push('', 'COMMIT;');
  sql.push(`SELECT CONCAT('pa_style=',(SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='pa_style'),' pa_color=',(SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='pa_color'),' pa_size=',(SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='pa_size')) result;`);

  writeFileSync('scripts/migrate-style-split.sql', sql.join('\n') + '\n');
  writeFileSync('scripts/style-split-mixed-review.json', JSON.stringify(mixedReview, null, 2));
  console.log('Wrote scripts/migrate-style-split.sql + scripts/style-split-mixed-review.json');
  console.log(`  pure parents: ${JSON.stringify(Object.fromEntries(Object.entries(parentsByDim).map(([k, v]) => [k, v.length])))}`);
  console.log(`  repoints: ${rps.length}, target terms created: ${ct}, pa_style terms candidate-removed: ${movedTermIds.length}`);
  console.log(`  MIXED deferred: ${mixedReview.length}`);
  console.log(`  statements: ${sql.filter((s) => s.trim().endsWith(';')).length}`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
