/**
 * READ-ONLY. DB-based product-line detector (rethink of the feed-time grouper).
 * Finds product LINES that should be ONE variable product (up to 2 axes:
 * size/length × color), by stripping variant tokens from titles to a base name
 * and grouping by base + brand + category. Surfaces:
 *   - MISSED variants: a base shared by an existing VARIABLE + standalone SINGLES
 *     (e.g. realrock-straight-w-balls "9 Vanilla"/"10 Vanilla" left as singles)
 *   - NEW lines: ≥2 singles with the same base and ≥2 distinct variant values
 *
 * Uses the cleaned attribute vocab + sanitizer to classify what each title's
 * trailing tokens are (color/size/length/volume/flavor) → the variation axes.
 *
 * Usage: bun run scripts/detect-product-lines.ts [--brand-filter realrock] [--min 2]
 */
import { getConnection } from './lib/db';
import { classifyAttributeValue, type AttrDim } from './lib/attribute-sanitizer';
import { writeFileSync } from 'fs';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const BRAND_FILTER = (arg('--brand-filter') || '').toLowerCase();

const COLOR_WORDS = new Set(['black', 'white', 'red', 'blue', 'pink', 'purple', 'clear', 'flesh', 'beige', 'tan', 'green', 'yellow', 'gold', 'silver', 'nude', 'ivory', 'brown', 'grey', 'gray', 'orange', 'teal', 'aqua', 'turquoise', 'navy', 'coral', 'lavender', 'violet', 'rose', 'vanilla', 'chocolate', 'caramel', 'mocha', 'transparent', 'crystal', 'rainbow', 'multicolor']);
// lube/topical TYPE words — the variation axis for many lube lines (Water vs Silicone, etc.)
const TYPE_WORDS = new Set(['water', 'silicone', 'hybrid', 'warming', 'cooling', 'desensitizing', 'original', 'natural', 'unscented', 'flavored', 'water-based', 'silicone-based', 'oil-based']);
const STOP = new Set(['with', 'w', 'and', 'the', 'balls', 'cock', 'dildo', 'plug', 'vibe', 'straight', 'realistic', 'suction', 'cup', 'of', 'for', 'in.', 'w/']);

// Returns {base, dims:{color?, size?}} by stripping trailing variant tokens.
function parseTitle(title: string, vocab: any): { base: string; color?: string; size?: string; sizeDim?: AttrDim; flavor?: string } {
  let toks = title.trim().split(/\s+/);
  let color: string | undefined, size: string | undefined, sizeDim: AttrDim | undefined, flavor: string | undefined;
  const isColor = (w: string) => COLOR_WORDS.has(w.toLowerCase()) || vocab.colorVocab?.has(w.toLowerCase());
  const isFlavorType = (w: string) => TYPE_WORDS.has(w.toLowerCase()) || vocab.flavorVocab?.has(w.toLowerCase());
  // strip from the end: collect color + size/length tokens; stop at a STOP/base word
  let changed = true;
  while (changed && toks.length > 2) {
    changed = false;
    const last = toks[toks.length - 1];
    const lastLc = last.toLowerCase().replace(/[.,]/g, '');
    if (!lastLc) { toks.pop(); changed = true; continue; }
    if (STOP.has(lastLc)) break;
    // color token
    if (!color && isColor(lastLc)) { color = lastLc; toks.pop(); changed = true; continue; }
    // flavor / lube-type token
    if (!flavor && isFlavorType(lastLc)) { flavor = lastLc; toks.pop(); changed = true; continue; }
    // measurement token (8in, 8", 8, 2oz, 100ml) — classify
    const c = classifyAttributeValue(last, vocab);
    if (!size && (c.dim === 'length' || c.dim === 'volume' || c.dim === 'apparel' || c.dim === 'weight')) { size = c.slug; sizeDim = c.dim; toks.pop(); changed = true; continue; }
    // bare number near the end on a non-stop context → likely a length (e.g. "...Balls 9 Vanilla")
    if (!size && /^\d{1,2}(\.\d+)?$/.test(lastLc) && parseFloat(lastLc) <= 16) { size = `${lastLc}-in`; sizeDim = 'length'; toks.pop(); changed = true; continue; }
    // unit word leftover ("in"/"inch") after we already took a number — drop
    if (/^(in|inch|inches|oz|ml)$/.test(lastLc)) { toks.pop(); changed = true; continue; }
    break;
  }
  return { base: toks.join(' ').replace(/\s+w\/?$/i, '').replace(/\s+-$/, '').trim(), color, size, sizeDim, flavor };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\bw\b/g, '').replace(/\s+/g, ' ').trim();

async function main() {
  const db = await getConnection();
  const [vrows] = await db.query<any[]>(`SELECT t.slug, tt.taxonomy FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id WHERE tt.taxonomy IN ('pa_color','pa_flavor','pa_material')`);
  const vocab: any = { colorVocab: new Set(), flavorVocab: new Set(), materialVocab: new Set() };
  for (const r of vrows as any[]) (r.taxonomy === 'pa_color' ? vocab.colorVocab : r.taxonomy === 'pa_flavor' ? vocab.flavorVocab : vocab.materialVocab).add(r.slug);

  // all published products + type + brand + price
  const [prods] = await db.query<any[]>(`
    SELECT p.ID, p.post_title title,
      COALESCE((SELECT t.slug FROM wp_term_relationships r JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id=r.term_taxonomy_id AND tt.taxonomy='product_type' JOIN wp_terms t ON t.term_id=tt.term_id WHERE r.object_id=p.ID LIMIT 1),'simple') ptype,
      COALESCE((SELECT t.slug FROM wp_term_relationships r JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id=r.term_taxonomy_id AND tt.taxonomy='product_brand' JOIN wp_terms t ON t.term_id=tt.term_id WHERE r.object_id=p.ID LIMIT 1),'') brand
    FROM wp_posts p WHERE p.post_type='product' AND p.post_status='publish'`);

  // group by normalized base + brand
  type Member = { id: number; title: string; type: string; color?: string; size?: string; sizeDim?: AttrDim; flavor?: string };
  const groups = new Map<string, { base: string; brand: string; members: Member[] }>();
  for (const p of prods as any[]) {
    if (BRAND_FILTER && !p.title.toLowerCase().includes(BRAND_FILTER)) continue;
    const parsed = parseTitle(p.title, vocab);
    if (norm(parsed.base).split(' ').length < 2) continue; // too short to be a reliable base
    const key = `${norm(parsed.base)}||${p.brand}`;
    const g = groups.get(key) || groups.set(key, { base: parsed.base, brand: p.brand, members: [] }).get(key)!;
    g.members.push({ id: p.ID, title: p.title, type: p.ptype === 'variable' ? 'VAR' : 'single', color: parsed.color, size: parsed.size, sizeDim: parsed.sizeDim, flavor: parsed.flavor });
  }

  // candidates: groups with >1 member where at least one has a variant value
  const missedIntoVar: any[] = [], newLines: any[] = [], mergeVars: any[] = [];
  for (const g of groups.values()) {
    if (g.members.length < 2) continue;
    const vars = g.members.filter((m) => m.type === 'VAR').length;
    const singles = g.members.filter((m) => m.type === 'single').length;
    const colors = new Set(g.members.map((m) => m.color).filter(Boolean));
    const sizes = new Set(g.members.map((m) => m.size).filter(Boolean));
    const flavors = new Set(g.members.map((m) => m.flavor).filter(Boolean));
    if (colors.size + sizes.size + flavors.size < 1) continue;
    const axes = [
      sizes.size > 1 ? `size(${[...sizes].join('/')})` : sizes.size === 1 ? 'size' : '',
      colors.size > 1 ? `color(${[...colors].join('/')})` : colors.size === 1 ? 'color' : '',
      flavors.size > 1 ? `flavor/type(${[...flavors].join('/')})` : flavors.size === 1 ? 'flavor/type' : '',
    ].filter(Boolean);
    const entry = { base: g.base, brand: g.brand, n: g.members.length, axes, members: g.members };
    if (vars >= 1 && singles >= 1) missedIntoVar.push(entry);
    else if (vars >= 2) mergeVars.push(entry);       // fragmented variables to merge (Swiss Navy pattern)
    else if (vars === 0) newLines.push(entry);
  }

  console.log(`=== MISSED variants (existing VARIABLE + standalone SINGLES sharing a base): ${missedIntoVar.length} groups ===`);
  for (const e of missedIntoVar.sort((a, b) => b.n - a.n).slice(0, 25)) {
    console.log(`\n  "${e.base}" [${e.brand || 'no-brand'}] axes=[${e.axes.join(', ')}]`);
    for (const m of e.members) console.log(`     ${m.type.padEnd(6)} ${m.id}  size=${m.size || '-'} color=${m.color || '-'}  ${m.title.slice(0, 55)}`);
  }
  console.log(`\n\n=== FRAGMENTED variables to MERGE (≥2 variable products sharing a base — Swiss Navy pattern): ${mergeVars.length} groups ===`);
  for (const e of mergeVars.sort((a, b) => b.n - a.n).slice(0, 15)) {
    console.log(`\n  "${e.base}" [${e.brand || 'no-brand'}] n=${e.n} axes=[${e.axes.join(', ')}]`);
    for (const m of e.members.slice(0, 8)) console.log(`     VAR ${m.id}  size=${m.size || '-'} color=${m.color || '-'} flavor=${m.flavor || '-'}  ${m.title.slice(0, 55)}`);
  }

  console.log(`\n\n=== NEW lines (≥2 singles, same base, variant values): ${newLines.length} groups ===`);
  for (const e of newLines.sort((a, b) => b.n - a.n).slice(0, 15)) {
    console.log(`\n  "${e.base}" [${e.brand || 'no-brand'}] n=${e.n} axes=[${e.axes.join(', ')}]`);
    for (const m of e.members.slice(0, 8)) console.log(`     ${m.id}  size=${m.size || '-'} color=${m.color || '-'}  ${m.title.slice(0, 55)}`);
  }
  if (!BRAND_FILTER) {
    writeFileSync('scripts/product-line-candidates.json', JSON.stringify({ missedIntoVar, mergeVars, newLines }, null, 2));
    console.log(`\nWrote scripts/product-line-candidates.json (${missedIntoVar.length} missed + ${mergeVars.length} merge-vars + ${newLines.length} new)`);
  }
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
