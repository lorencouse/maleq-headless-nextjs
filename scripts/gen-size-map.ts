/**
 * READ-ONLY. Generate a PROPOSED cleanup mapping for every pa_size term.
 * Output: scripts/size-cleanup-map.generated.json   (reviewable / editable)
 *         scripts/size-manual-review.json            (ambiguous terms to eyeball)
 * Plus a printed summary grouped by resulting action.
 *
 * pa_size conflates FOUR axes; this classifier keeps them in pa_size but cleans
 * each and tags the two CONVERTIBLE axes (length, volume) with a native
 * {dim,value,unit} so the storefront metric/imperial toggle can reformat them.
 *
 *   action 'KEEP'   -> already a clean canonical term (apparel canon, or normalized length/volume/count)
 *   action 'MERGE'  -> variant folded into a canonical term (Sm->Small, 8in->8 in, "0.25 Oz"->0.25 oz)
 *   action 'MOVE'   -> leaked color/flavor -> pa_color / pa_flavor
 *   action 'DELETE' -> product-name garbage / orphan
 *
 * For length/volume KEEP+MERGE targets a `unit` block is emitted:
 *   unit: { dim:'length'|'volume'|'weight', value:number, u:'in'|'cm'|'mm'|'ft'|'oz'|'ml'|'l'|'g' }
 * which gen-size-units.ts turns into lib/products/size-units.ts for the toggle.
 *
 * Usage: bun run scripts/gen-size-map.ts            # reads PROD via tunnel
 *        bun run scripts/gen-size-map.ts --local
 */
import { getConnection } from './lib/db';
import { writeFileSync } from 'fs';

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------------------------------------------------------------------------
// 1. APPAREL canonical vocabulary (slug -> display name). MERGE targets here.
// ---------------------------------------------------------------------------
const APPAREL: Record<string, string> = {
  xs: 'X-Small', s: 'Small', m: 'Medium', l: 'Large', xl: 'X-Large',
  '2xl': 'XX-Large', '3xl': 'XXX-Large', '4xl': 'XXXX-Large',
  's-m': 'S/M', 'm-l': 'M/L', 'l-xl': 'L/XL', 'xl-2xl': 'XL/XXL',
  'one-size': 'One Size', queen: 'Queen',
  '1x': '1X', '2x': '2X', '3x': '3X', '4x': '4X', '5x': '5X',
  plus: 'Plus', petite: 'Petite', king: 'King', mini: 'Mini',
};

// apparel raw-name / slug aliases -> canonical apparel slug
const APPAREL_ALIAS: Record<string, string> = {
  'x-small': 'xs', xsmall: 'xs', 'extra-small': 'xs',
  small: 's', sm: 's', sml: 's',
  medium: 'm', med: 'm',
  large: 'l', lg: 'l', lge: 'l',
  'x-large': 'xl', xlarge: 'xl', 'extra-large': 'xl',
  'xx-large': '2xl', xxl: '2xl', xxlarge: '2xl', '2-xl': '2xl',
  'xxx-large': '3xl', xxxl: '3xl', '3-xl': '3xl',
  'xxxx-large': '4xl', xxxxl: '4xl', '4-xl': '4xl',
  // combos (slash slugifies to a hyphen)
  's-m': 's-m', 'm-l': 'm-l', 'l-xl': 'l-xl', lxl: 'l-xl', sml2: 's-m',
  'xl-xxl': 'xl-2xl', 'xl-2xl': 'xl-2xl',
  ml: 'm-l', // bare "Ml" term = M/L combo (NOT the volume unit "10 ml")
  // one size / queen family
  'o-s': 'one-size', os: 'one-size', 'one-size': 'one-size', onesize: 'one-size',
  'one-size-queen': 'one-size',
  'q-s': 'queen', qs: 'queen', 'queen-size': 'queen', queensize: 'queen',
  osq: 'one-size', // One Size Queen -> treat as one-size (flagged for review)
  // typos / spaced X-forms with real product counts
  mediu: 'm', mediumm: 'm', smal: 's', larg: 'l', regular: 'm', reg: 'm', standard: 'm',
  '1xl': 'xl', '2-x': '2x', '3-x': '3x', '4-x': '4x',
  'alt-l-xl': 'l-xl',
};

// plus-size combo strings ("1x2x", "3x4x", "1xl 2xl", "3xl 4xl") -> first token
function plusComboToCanon(slug: string): string | null {
  const m = slug.match(/^([1-5])x-?([1-5])x$/) || slug.match(/^([1-5])xl-?([1-5])xl$/);
  if (m) return `${m[1]}x`;
  return null;
}

// ---------------------------------------------------------------------------
// 2. leaked color / flavor -> MOVE out of pa_size
// ---------------------------------------------------------------------------
const COLOR_WORDS = new Set([
  'black', 'white', 'red', 'blue', 'pink', 'purple', 'clear', 'flesh', 'beige',
  'tan', 'green', 'yellow', 'gold', 'silver', 'nude', 'ivory', 'brown', 'grey',
  'gray', 'orange', 'teal', 'aqua', 'burgundy', 'turquoise',
]);
const FLAVOR_WORDS = new Set([
  'strawberry', 'vanilla', 'cherry', 'chocolate', 'mint', 'grape', 'watermelon',
  'banana', 'peach', 'mango', 'coconut', 'cinnamon', 'caramel', 'coffee', 'mocha',
  'blueberry', 'raspberry', 'cotton-candy', 'salted-caramel', 'original', 'natural',
  'unflavored', 'unscented',
]);

// ---------------------------------------------------------------------------
// 3. length / volume parsing -> canonical display + native {dim,value,u}
// ---------------------------------------------------------------------------
type UnitTag = { dim: 'length' | 'volume' | 'weight'; value: number; u: string };

// returns canonical {name, slug, unit} for a pure measurement term, or null
function parseMeasurement(raw: string): { name: string; slug: string; unit: UnitTag } | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  // reject if it carries extra descriptive words (color, "with balls", etc.) -> let caller flag
  const extra = /(black|white|red|blue|pink|clear|flesh|with\s+balls|balls|long|wide|insertable|bowl|jar|cup|display|pack|pcs?\b)/;
  let m: RegExpMatchArray | null;

  // VOLUME: fl oz / oz  (treat oz as fluid for personal-care; 3.4 oz = 100 ml)
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?(?:fluid\s*)?oz\b/)) && !extra.test(s)) {
    const v = parseFloat(m[1]);
    return { name: `${m[1]} oz`, slug: slugify(`${m[1]} oz`), unit: { dim: 'volume', value: v, u: 'oz' } };
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*ml\b/)) && !extra.test(s)) {
    const v = parseFloat(m[1]);
    return { name: `${m[1]} ml`, slug: slugify(`${m[1]} ml`), unit: { dim: 'volume', value: v, u: 'ml' } };
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:l|liter|litre)\b/)) && !extra.test(s)) {
    const v = parseFloat(m[1]);
    return { name: `${m[1]} L`, slug: slugify(`${m[1]} l`), unit: { dim: 'volume', value: v, u: 'l' } };
  }
  // WEIGHT: g / gram (mg -> g)
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*mg\b/)) && !extra.test(s)) {
    const v = parseFloat(m[1]) / 1000;
    return { name: `${m[1]} mg`, slug: slugify(`${m[1]} mg`), unit: { dim: 'weight', value: v, u: 'g' } };
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:g|gram|grams|gm)\b/)) && !extra.test(s)) {
    const v = parseFloat(m[1]);
    return { name: `${m[1]} g`, slug: slugify(`${m[1]} g`), unit: { dim: 'weight', value: v, u: 'g' } };
  }
  // LENGTH: inches (in / inch / ")
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")\b/)) && !extra.test(s)) {
    const v = parseFloat(m[1]);
    return { name: `${m[1]} in`, slug: slugify(`${m[1]} in`), unit: { dim: 'length', value: v, u: 'in' } };
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*cm\b/)) && !extra.test(s)) {
    const v = parseFloat(m[1]);
    return { name: `${m[1]} cm`, slug: slugify(`${m[1]} cm`), unit: { dim: 'length', value: v, u: 'cm' } };
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*mm\b/)) && !extra.test(s)) {
    const v = parseFloat(m[1]);
    return { name: `${m[1]} mm`, slug: slugify(`${m[1]} mm`), unit: { dim: 'length', value: v, u: 'mm' } };
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft|foot|feet)\b/)) && !extra.test(s)) {
    const v = parseFloat(m[1]);
    return { name: `${m[1]} ft`, slug: slugify(`${m[1]} ft`), unit: { dim: 'length', value: v, u: 'ft' } };
  }
  return null;
}

// pack / count term (not convertible, kept normalized): "3 pk", "12 pc", "10 display"
function parseCount(raw: string): { name: string; slug: string } | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+)\s*(?:pcs?|pc|piece|pieces|pack|packs|pk)\b/))) {
    return { name: `${m[1]} pk`, slug: slugify(`${m[1]} pk`) };
  }
  if ((m = s.match(/^(\d+)\s*(?:count|ct)\b/))) {
    return { name: `${m[1]} pk`, slug: slugify(`${m[1]} pk`) };
  }
  if ((m = s.match(/^(\d+)\s*display\b/))) {
    return { name: `${m[1]} display`, slug: slugify(`${m[1]} display`) };
  }
  return null;
}

function isGarbage(name: string): boolean {
  const n = name.trim();
  // ALL-CAPS multi-word product names (e.g. "KONG BENDERZ DUAL DENSITY DONG")
  if (n === n.toUpperCase() && /[A-Z]{3,}/.test(n) && n.split(/\s+/).length >= 3) return true;
  if (/(per customer|sample pack|prepack|kit\b)/i.test(n)) return true;
  return false;
}

type Mapping = {
  term_id: number; name: string; slug: string; products: number; variations: number;
  action: 'KEEP' | 'MERGE' | 'MOVE' | 'DELETE';
  target?: string;          // canonical slug (KEEP=self, MERGE=canonical)
  displayName?: string;     // canonical display name (for newly-created / normalized terms)
  taxonomy?: string;        // MOVE target taxonomy
  value?: string;           // MOVE target value (display)
  unit?: UnitTag;           // length/volume tag for the toggle
  axis: 'apparel' | 'length' | 'volume' | 'weight' | 'count' | 'color' | 'flavor' | 'garbage' | 'review';
  note?: string;
};

// existing pa_color / pa_flavor vocabularies (slug -> display) loaded from the DB,
// so a pa_size term that is really a known color/flavor gets MOVEd data-driven.
let COLOR_TERMS: Map<string, string> = new Map();
let FLAVOR_TERMS: Map<string, string> = new Map();

function decide(name: string, slug: string, products: number, variations: number): Omit<Mapping, 'term_id' | 'name' | 'slug' | 'products' | 'variations'> {
  const raw = name.trim();
  const sl = slugify(raw);

  // orphan -> delete
  if (products === 0 && variations === 0) return { action: 'DELETE', axis: 'garbage', note: 'orphan-no-products' };

  // 1. apparel canonical already
  if (APPAREL[sl]) return { action: 'KEEP', target: sl, displayName: APPAREL[sl], axis: 'apparel' };
  // 2. apparel alias -> canonical
  if (APPAREL_ALIAS[sl]) {
    const c = APPAREL_ALIAS[sl];
    const note = sl === 'osq' || sl === 'one-size-queen' ? 'osq->one-size (review: One Size Queen?)' : 'apparel-alias';
    return { action: 'MERGE', target: c, displayName: APPAREL[c], axis: 'apparel', note };
  }
  // 2b. plus-size combo strings (1x2x, 3xl 4xl) -> first plus token
  const plus = plusComboToCanon(sl);
  if (plus && APPAREL[plus]) return { action: 'MERGE', target: plus, displayName: APPAREL[plus], axis: 'apparel', note: 'plus-combo' };

  // 3. pure measurement (length / volume / weight)
  const meas = parseMeasurement(raw);
  if (meas) {
    const action = meas.slug === sl ? 'KEEP' : 'MERGE';
    return { action, target: meas.slug, displayName: meas.name, unit: meas.unit, axis: meas.unit.dim, note: action === 'MERGE' ? 'normalize-unit' : undefined };
  }

  // 4. pack / count
  const cnt = parseCount(raw);
  if (cnt) {
    const action = cnt.slug === sl ? 'KEEP' : 'MERGE';
    return { action, target: cnt.slug, displayName: cnt.name, axis: 'count', note: action === 'MERGE' ? 'normalize-count' : undefined };
  }

  // 5. leaked color / flavor -> MOVE. Match the static word-set OR an existing
  //    pa_color / pa_flavor term slug (data-driven: catches multi-word values
  //    like "Blue Raspberry", "Hot Pink", "Mint Chocolate").
  if (COLOR_WORDS.has(sl) || COLOR_TERMS.has(sl)) return { action: 'MOVE', taxonomy: 'pa_color', value: COLOR_TERMS.get(sl) || raw, axis: 'color', note: 'leaked-color' };
  if (FLAVOR_WORDS.has(sl) || FLAVOR_TERMS.has(sl)) return { action: 'MOVE', taxonomy: 'pa_flavor', value: FLAVOR_TERMS.get(sl) || raw, axis: 'flavor', note: 'leaked-flavor' };

  // 6. obvious product-name garbage
  if (isGarbage(raw)) return { action: 'DELETE', axis: 'garbage', note: 'product-name-garbage' };

  // 7. bare number — ambiguous (inches? pack? apparel numeric?) -> KEEP untouched, flag
  if (/^\d+(\.\d+)?$/.test(sl)) return { action: 'KEEP', target: sl, displayName: raw, axis: 'review', note: 'bare-number-ambiguous' };

  // 8. measurement carrying extra words (e.g. "40mm Black", "5 With Balls", "8.0 Long") -> KEEP, flag
  if (/\d/.test(sl) && /(mm|cm|in|oz|ml|long|balls|bowl|jar)/.test(sl)) return { action: 'KEEP', target: sl, displayName: raw, axis: 'review', note: 'measurement-with-extra' };

  // 9. everything else -> KEEP untouched, flag for review (don't delete unknowns blindly)
  return { action: 'KEEP', target: sl, displayName: raw, axis: 'review', note: 'unrecognized-review' };
}

async function main() {
  const db = await getConnection();

  // load already-cleaned color / flavor vocabularies for data-driven MOVE detection
  const [ctTerms] = await db.query<any[]>(
    `SELECT t.slug, t.name, tt.taxonomy FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id
     WHERE tt.taxonomy IN ('pa_color','pa_flavor')`);
  for (const r of ctTerms as any[]) {
    if (r.taxonomy === 'pa_color') COLOR_TERMS.set(r.slug, r.name);
    else FLAVOR_TERMS.set(r.slug, r.name);
  }
  console.log(`Loaded vocab: ${COLOR_TERMS.size} colors, ${FLAVOR_TERMS.size} flavors\n`);

  const [rows] = await db.query<any[]>(
    `SELECT t.term_id, t.name, t.slug, tt.term_taxonomy_id,
            (SELECT COUNT(*) FROM wp_term_relationships r WHERE r.term_taxonomy_id=tt.term_taxonomy_id) AS products,
            (SELECT COUNT(*) FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation'
               WHERE pm.meta_key='attribute_pa_size' AND pm.meta_value=t.slug) AS variations
     FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id
     WHERE tt.taxonomy='pa_size' ORDER BY products DESC, t.name`);

  const mappings: Mapping[] = (rows as any[]).map((r) => ({
    term_id: r.term_id, name: r.name, slug: r.slug, products: Number(r.products), variations: Number(r.variations),
    ...decide(r.name, r.slug, Number(r.products), Number(r.variations)),
  }));

  writeFileSync('scripts/size-cleanup-map.generated.json', JSON.stringify(mappings, null, 2));
  const review = mappings.filter((m) => m.axis === 'review');
  writeFileSync('scripts/size-manual-review.json', JSON.stringify(review, null, 2));

  // ---- summary ----
  const byAction: Record<string, Mapping[]> = {};
  for (const m of mappings) (byAction[m.action] ||= []).push(m);
  console.log('=== ACTION SUMMARY ===');
  for (const [a, items] of Object.entries(byAction)) {
    const prod = items.reduce((s, m) => s + m.products, 0);
    console.log(`  ${a.padEnd(7)} terms=${String(items.length).padStart(4)}  product-rels=${prod}`);
  }

  // resulting canonical terms by axis
  const canon = new Map<string, { axis: string; display: string; rels: number; sources: number }>();
  for (const m of mappings) {
    if (m.action === 'KEEP' || m.action === 'MERGE') {
      const key = m.target!;
      const e = canon.get(key) || canon.set(key, { axis: m.axis, display: m.displayName || key, rels: 0, sources: 0 }).get(key)!;
      e.rels += m.products; e.sources++;
    }
  }
  const byAxis: Record<string, number> = {};
  for (const e of canon.values()) byAxis[e.axis] = (byAxis[e.axis] || 0) + 1;
  console.log(`\n=== Resulting canonical pa_size terms: ${canon.size} (from ${rows.length}) ===`);
  for (const [ax, n] of Object.entries(byAxis).sort((a, b) => b[1] - a[1])) console.log(`  ${ax.padEnd(8)} ${n} terms`);

  console.log('\n=== APPAREL canon (target <- merged sources) ===');
  for (const [slug, e] of [...canon].filter(([, e]) => e.axis === 'apparel').sort((a, b) => b[1].rels - a[1].rels))
    console.log(`  ${e.display.padEnd(12)} ${String(e.rels).padStart(5)} rels  (${e.sources} src) [${slug}]`);

  console.log('\n=== MOVE (out of pa_size) ===');
  for (const m of (byAction['MOVE'] || [])) console.log(`  "${m.name}" -> ${m.taxonomy} (p=${m.products}) [${m.note}]`);

  console.log('\n=== DELETE ===');
  for (const m of (byAction['DELETE'] || []).slice(0, 40)) console.log(`  "${m.name}" (p=${m.products}) [${m.note}]`);
  if ((byAction['DELETE'] || []).length > 40) console.log(`  ... +${byAction['DELETE'].length - 40} more`);

  console.log(`\n=== REVIEW (kept untouched, eyeball these ${review.length}) ===`);
  for (const m of review.slice(0, 60)) console.log(`  "${m.name}" (p=${m.products},v=${m.variations}) [${m.note}]`);
  if (review.length > 60) console.log(`  ... +${review.length - 60} more (see size-manual-review.json)`);

  const convertible = mappings.filter((m) => m.unit && (m.action === 'KEEP'));
  console.log(`\nConvertible canonical terms tagged for toggle: length+volume+weight`);
  console.log('Wrote scripts/size-cleanup-map.generated.json + scripts/size-manual-review.json');
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
