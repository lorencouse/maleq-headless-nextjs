/**
 * READ-ONLY. Generate a PROPOSED cleanup mapping for every pa_flavor term.
 * Output: scripts/flavor-cleanup-map.generated.json  (reviewable / editable)
 * Plus a printed summary grouped by resulting action.
 *
 * Action shapes per source term:
 *   { action: 'KEEP',   flavor: 'strawberry' }                 // already a clean canonical flavor
 *   { action: 'MERGE',  flavor: 'strawberry' }                 // size/qty/spelling variant -> canonical flavor
 *   { action: 'MOVE',   taxonomy: 'pa_size',  value: '6 In' }  // really a size/dimension -> pa_size
 *   { action: 'MOVE',   taxonomy: 'pa_color', value: 'aqua' }  // really a color -> pa_color
 *   { action: 'DELETE' }                                       // garbage / product-name fragment / non-flavor descriptor
 * For MERGE/KEEP a clean variation token is also produced (variationValue = canonical slug).
 *
 * Usage: bun run scripts/gen-flavor-map.ts            # reads PROD via tunnel
 *        bun run scripts/gen-flavor-map.ts --local
 */
import { getConnection } from './lib/db';
import { writeFileSync } from 'fs';

// ---- Canonical flavor vocabulary (slug -> display name). MERGE targets must exist here. ----
const CANON: Record<string, string> = {
  strawberry: 'Strawberry', vanilla: 'Vanilla', caramel: 'Caramel', chocolate: 'Chocolate',
  watermelon: 'Watermelon', cherry: 'Cherry', mint: 'Mint', grape: 'Grape',
  'cotton-candy': 'Cotton Candy', mango: 'Mango', apple: 'Apple', blueberry: 'Blueberry',
  peach: 'Peach', coconut: 'Coconut', raspberry: 'Raspberry', cinnamon: 'Cinnamon',
  mocha: 'Mocha', banana: 'Banana', lemon: 'Lemon', 'pina-colada': 'Pina Colada',
  'blue-raspberry': 'Blue Raspberry', lavender: 'Lavender', 'passion-fruit': 'Passion Fruit',
  'green-apple': 'Green Apple', 'wild-cherry': 'Wild Cherry', 'chocolate-mint': 'Chocolate Mint',
  'black-licorice': 'Black Licorice', 'butter-rum': 'Butter Rum', honey: 'Honey',
  'bubble-gum': 'Bubble Gum', lime: 'Lime', 'mango-passion': 'Mango Passion',
  'sex-on-the-beach': 'Sex on the Beach', tropical: 'Tropical', 'banana-cream': 'Banana Cream',
  berry: 'Berry', 'cherry-lemonade': 'Cherry Lemonade', 'cherry-vanilla': 'Cherry Vanilla',
  'cinnamon-ginger': 'Cinnamon Ginger', 'cool-mint': 'Cool Mint', dreamsicle: 'Dreamsicle',
  eucalyptus: 'Eucalyptus', 'french-lavender': 'French Lavender', 'fruit-punch': 'Fruit Punch',
  'fuzzy-navel': 'Fuzzy Navel', grapefruit: 'Grapefruit', 'juicy-apple': 'Juicy Apple',
  'key-lime': 'Key Lime', 'mediterranean-almond': 'Mediterranean Almond',
  'midnight-sorbet': 'Midnight Sorbet', mojito: 'Mojito', orange: 'Orange',
  'orange-cream': 'Orange Cream', pineapple: 'Pineapple', 'root-beer': 'Root Beer',
  'sour-tangerine': 'Sour Tangerine', 'strawberry-banana': 'Strawberry Banana',
  'strawberry-pomegranate': 'Strawberry Pomegranate', 'tahitian-vanilla': 'Tahitian Vanilla',
  tangerine: 'Tangerine', 'warm-vanilla': 'Warm Vanilla', coffee: 'Coffee', melon: 'Melon',
  peppermint: 'Peppermint', 'almond-sweetness': 'Almond Sweetness', 'pear-green-tea': 'Pear Green Tea',
  'green-tea': 'Green Tea', 'exotic-fruits': 'Exotic Fruits', fruits: 'Fruits',
  'island-blossoms': 'Island Blossoms', 'lustful-litchee': 'Lustful Litchee',
  'aphrodisia-roses': 'Aphrodisia Roses', 'pineapple-sage': 'Pineapple Sage',
  'strawberry-champagne': 'Strawberry Champagne', cola: 'Cola', unflavored: 'Unflavored',
  // product-form / sensation / scent descriptors kept as flavor values per editorial decision
  spray: 'Spray', gel: 'Gel', lotion: 'Lotion', cream: 'Cream', warming: 'Warming',
  cooling: 'Cooling', desensitizing: 'Desensitizing', 'oil-based': 'Oil-Based',
  fresh: 'Fresh', floral: 'Floral',
};

// raw-slug / spelling / phrasing aliases -> canonical slug (checked before suffix stripping)
const ALIAS: Record<string, string> = {
  'pi-a-colada': 'pina-colada',       // "Piña Colada"
  'pina-colada': 'pina-colada',
  'condoms-cola': 'cola',
  'trustex-condoms-cola': 'cola',
  'cock-rockets-fruit-punch': 'fruit-punch',
  'massage-candle-mediterranean-almond': 'mediterranean-almond',
  'pineapple-sag': 'pineapple-sage',  // truncated import
  'strawb-champagne': 'strawberry-champagne',
  'libido-exotic-fruits': 'exotic-fruits',
  'libido-fruits': 'fruits',
  'zenitude-green-tea': 'green-tea',
  'zenitude-exotic-green-tea': 'green-tea',
  'pear-exotic-green-tea': 'pear-green-tea',
  'ensitizer-unflavored-10ml': 'unflavored',
  'unscented-8-5oz': 'unflavored',
};

// terms that are NOT flavors and not kept -> remove from pa_flavor (occasions / meaningless tokens)
const NON_FLAVOR = new Set([
  'classic', 'birthday', 'wedding', 'cake', 'ides', 'silicone', 'bag-2023',
]);

// colors that leaked into pa_flavor -> pa_color
const COLOR_WORDS: Record<string, string> = { aqua: 'aqua', purple: 'purple', yellow: 'yellow' };

const SIZE_SUFFIX = /\s*(\(bulk\))?\s*\b(\d+(\.\d+)?\s*(fl\s*)?(oz|ml|g|pcs?|pc|pk|pack)\b.*|\d+\s*pcs?.*|\d+pc\s*display.*)$/i;

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// strip trailing size/qty/unit info and re-slug; return canonical slug if the remainder is a known flavor
function stripSizeToFlavor(name: string): string | null {
  let s = name.trim();
  // remove parenthetical (bulk), trailing "48 Pcs 0.24 Oz", "4 Oz", "2.5oz", "4 Fl Oz", "3g", "10ml"
  s = s.replace(/\(bulk\)/ig, ' ');
  s = s.replace(/\b\d+\s*pcs?\b/ig, ' ');
  s = s.replace(/\b\d+pc\b/ig, ' ');
  s = s.replace(/\b\d+(\.\d+)?\s*(fl\s*)?(oz|ml|g)\b/ig, ' ');
  s = s.replace(/\bdisplay\b/ig, ' ');
  s = s.replace(/\b\d+(\.\d+)?\b/g, ' '); // leftover bare numbers
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const sl = slugify(s);
  if (ALIAS[sl] && CANON[ALIAS[sl]]) return ALIAS[sl];
  if (CANON[sl]) return sl;
  return null;
}

// pure size/dimension/quantity term (no flavor word) -> pa_size
const SIZE_ONLY = /^(\d+(\.\d+)?(\s*(in|inch|oz|ml|g|cm|mm))?|\d+\s*(in|with\s+balls|pcs?|pc|fl\s*oz)|\d+pc\s*display|os|qs|qn|m|s|l|xl|2xl|3xl)(\s.*)?$/i;
function isSizeOnly(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (/^[\d.\s]+$/.test(n) && /\d/.test(n)) return true;               // "5", "6.5", "8.5"
  if (/^\d+(\.\d+)?\s*(in|inch|oz|ml|g|cm|mm|fl\s*oz)\b/.test(n)) return true; // "6 In", "1 Oz", "5.5 Oz"
  if (/^\d+\s*(with\s+balls|pcs?|pc|pk|pack)\b/.test(n)) return true;   // "5 With Balls", "36 Pcs"
  if (/^\d+pc\s*display/.test(n)) return true;                          // "24pc Display"
  if (/^(os|qs|qn)$/.test(n)) return true;                             // size codes
  if (/^\d+\s*in\.?\s+\w+/.test(n)) return true;                       // "6 In. Pink", "7 In. Pink"
  if (/^(water\s+liquid|water\s+gel|silicone(\s+gel)?|gp\s+free|spun\s+sugar|2\.0\s+water)\b/.test(n)) return true;
  return false;
}

// obvious product-name garbage (all-caps brand strings, kits, pills, nipple covers, glides)
function isGarbage(name: string): boolean {
  const n = name.trim();
  if (/(nipple cover|pill single|weekender kit|vibe prepack|slick head glide|mini bullet|d\+? cup|large d cup)/i.test(n)) return true;
  // ALL CAPS multi-word product names
  if (n === n.toUpperCase() && /[A-Z]{3,}/.test(n) && n.split(/\s+/).length >= 3) return true;
  return false;
}

type Mapping = {
  term_id: number; name: string; slug: string; products: number; variations: number;
  action: 'KEEP' | 'MERGE' | 'MOVE' | 'DELETE';
  flavor?: string; taxonomy?: string; value?: string; variationValue?: string; note?: string;
};

function decide(name: string, products = 1, variations = 1): Omit<Mapping, 'term_id' | 'name' | 'slug' | 'products' | 'variations'> {
  const raw = name.trim();
  const sl = slugify(raw);

  // 1. already clean canonical (checked first so a canonical slug is never "merged into itself")
  if (CANON[sl]) return { action: 'KEEP', flavor: sl, variationValue: sl };

  // 2. spelling/phrasing aliases -> canonical (before garbage, since some are buried in ALL-CAPS product names)
  if (ALIAS[sl] && CANON[ALIAS[sl]]) {
    const f = ALIAS[sl];
    return { action: 'MERGE', flavor: f, variationValue: f, note: 'alias' };
  }

  // 3. orphan term (nothing references it) -> just delete; never create a target term for it
  if (products === 0 && variations === 0) return { action: 'DELETE', note: 'orphan-no-products' };

  // 4. flavor + size/qty suffix -> merge to base flavor
  const base = stripSizeToFlavor(raw);
  if (base) return { action: 'MERGE', flavor: base, variationValue: base, note: 'strip-size' };

  // 5. leaked colors
  if (COLOR_WORDS[sl]) return { action: 'MOVE', taxonomy: 'pa_color', value: COLOR_WORDS[sl], note: 'color' };

  // 6. obvious product-name garbage
  if (isGarbage(raw)) return { action: 'DELETE', note: 'product-name-garbage' };

  // 7. explicit non-flavor descriptors
  if (NON_FLAVOR.has(sl)) return { action: 'DELETE', note: 'non-flavor-descriptor' };

  // 8. pure size / dimension -> pa_size
  if (isSizeOnly(raw)) return { action: 'MOVE', taxonomy: 'pa_size', value: raw, note: 'size' };

  // 9. unrecognized -> needs review (default DELETE, flagged)
  return { action: 'DELETE', note: 'unrecognized-review' };
}

async function main() {
  const db = await getConnection();
  const [rows] = await db.query<any[]>(
    `SELECT t.term_id, t.name, t.slug, tt.term_taxonomy_id,
            (SELECT COUNT(*) FROM wp_term_relationships r WHERE r.term_taxonomy_id=tt.term_taxonomy_id) AS products,
            (SELECT COUNT(*) FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation'
               WHERE pm.meta_key='attribute_pa_flavor' AND pm.meta_value=t.slug) AS variations
     FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id
     WHERE tt.taxonomy='pa_flavor' ORDER BY products DESC, t.name`);

  const mappings: Mapping[] = (rows as any[]).map((r) => ({
    term_id: r.term_id, name: r.name, slug: r.slug, products: Number(r.products), variations: Number(r.variations),
    ...decide(r.name, Number(r.products), Number(r.variations)),
  }));

  writeFileSync('scripts/flavor-cleanup-map.generated.json', JSON.stringify(mappings, null, 2));

  const byAction: Record<string, Mapping[]> = {};
  for (const m of mappings) (byAction[m.action] ||= []).push(m);
  console.log('=== ACTION SUMMARY ===');
  for (const [a, items] of Object.entries(byAction)) {
    const prod = items.reduce((s, m) => s + m.products, 0);
    console.log(`  ${a.padEnd(7)} terms=${String(items.length).padStart(3)}  product-rels=${prod}`);
  }

  const flavorTargets: Record<string, number> = {};
  for (const m of mappings) if (m.flavor) flavorTargets[m.flavor] = (flavorTargets[m.flavor] || 0) + m.products;
  console.log(`\n=== Resulting canonical flavors (${Object.keys(flavorTargets).length}) target -> total product-rels ===`);
  for (const [c, n] of Object.entries(flavorTargets).sort((a, b) => b[1] - a[1])) console.log(`  ${(CANON[c] || c).padEnd(24)} ${n}`);

  console.log('\n=== MERGE (size/spelling variants folded into a base flavor) ===');
  for (const m of (byAction['MERGE'] || []).sort((a,b)=> (a.flavor!).localeCompare(b.flavor!))) console.log(`  "${m.name}" -> ${m.flavor} (p=${m.products},v=${m.variations}) [${m.note}]`);

  console.log('\n=== MOVE (out of pa_flavor) ===');
  for (const m of byAction['MOVE'] || []) console.log(`  "${m.name}" -> ${m.taxonomy} "${m.value}" (p=${m.products},v=${m.variations}) [${m.note}]`);

  console.log('\n=== DELETE (removed from pa_flavor entirely) ===');
  for (const m of byAction['DELETE'] || []) console.log(`  "${m.name}" (p=${m.products},v=${m.variations}) [${m.note}]`);

  console.log('\nWrote scripts/flavor-cleanup-map.generated.json');
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
