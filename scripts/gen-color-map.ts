/**
 * READ-ONLY. Generate a PROPOSED cleanup mapping for every pa_color term.
 * Output: scripts/color-cleanup-map.generated.json  (reviewable / editable)
 * Plus a printed summary grouped by resulting action.
 *
 * Action shapes per source term:
 *   { action: 'KEEP',   colors: ['black'] }              // already canonical
 *   { action: 'COLOR',  colors: ['blue'] }               // recolor/synonym -> base(s) (filter)
 *   { action: 'COLOR',  colors: ['black','red'] }         // composite -> multiple base colors (filter)
 *   { action: 'MOVE',   taxonomy: 'pa_size',  value: '8' }       // not a color -> size
 *   { action: 'MOVE',   taxonomy: 'pa_flavor', value: 'cherry' } // not a color -> flavor
 *   { action: 'DELETE' }                                   // garbage / product-name fragment
 * For COLOR results, a clean variation token is also produced (variationValue).
 *
 * Usage: bun run scripts/gen-color-map.ts --local
 */
import { getConnection } from './lib/db';
import { writeFileSync } from 'fs';

// ---- Canonical filter palette (base colors) ----
const BASE = new Set([
  'black','white','gray','silver','gold','red','pink','purple','blue','green',
  'brown','beige','tan','clear','orange','yellow','turquoise','teal','navy','rose',
  'burgundy','coral','lavender','ivory','nude','flesh','magenta','violet','wine',
  'copper','bronze','multicolor','rainbow','glow-in-the-dark','leopard',
]);

// ---- word/descriptor -> base color ----
const WORD: Record<string, string> = {
  // blues
  cobalt:'blue', colbalt:'blue', royal:'blue', sky:'blue', navy:'navy', indigo:'blue',
  cosmic:'blue', electric:'blue', sapphire:'blue', azure:'blue', malachite:'blue',
  midnight:'blue', tiffany:'blue', ocean:'blue', berry:'blue',
  // greens
  kiwi:'green', emerald:'green', forest:'green', mint:'green', lime:'green', sage:'green',
  olive:'green', peacock:'green', aqua:'teal', 'aqua-green':'green',
  // purples (violet is its own canonical base, so not mapped here)
  eggplant:'purple', plum:'purple', lilac:'purple', amethyst:'purple',
  periwinkle:'purple', orchid:'purple', tropical:'purple', ultra:'purple',
  // pinks / magentas
  fuchsia:'pink', fuschia:'pink', magenta:'magenta', cerise:'pink', azalea:'pink',
  bubblegum:'pink', kangaroo:'pink', blush:'pink', cosmicpink:'pink', strawberry:'pink',
  raspberry:'pink', peony:'pink', dusty:'pink', pastel:'pink',
  // reds
  maroon:'red', crimson:'red', cabernet:'red', merlot:'red', wine:'wine', beet:'red',
  cherry:'red', scarlet:'red', ruby:'red',
  // browns / skin tones
  mocha:'brown', chocolate:'brown', espresso:'brown', caramel:'brown', cocoa:'brown',
  latte:'brown', taupe:'brown', reddish:'brown', chestnut:'brown', vanilla:'beige',
  // grays / neutrals
  charcoal:'gray', smoke:'gray', slate:'gray', gunmetal:'gray', graphite:'gray',
  grey:'gray', fog:'gray', ash:'gray', pewter:'silver', titanium:'silver', onyx:'black',
  raven:'black', jet:'black', cream:'white', pearl:'white', frosted:'white', snow:'white',
  // metallics
  'rose-gold':'gold', golden:'gold', copper:'copper', bronze:'bronze', penny:'copper',
  // oranges/yellows
  peach:'orange', coral:'coral', burnt:'orange', daffodil:'yellow', tangerine:'orange',
  // skin-tone words
  flesh:'flesh', nude:'nude', natural:'beige', ivory:'ivory',
  // patterns
  leopard:'leopard', zebra:'leopard', tiger:'leopard', snake:'leopard', camo:'green',
  rainbow:'rainbow', multicolor:'multicolor', multicolors:'multicolor', 'multi-color':'multicolor',
  'multi-colors':'multicolor', multiple:'multicolor', plaid:'multicolor',
  // misc
  smoky:'gray', clear:'clear', transparent:'clear', translucent:'clear', frost:'clear',
  glow:'glow-in-the-dark',
  // abbreviations / truncations that leaked from imports
  blk:'black', blu:'blue', blac:'black', grn:'green', wht:'white', ppurple:'purple',
  // extra fruit words used as colors
  grape:'purple', watermelon:'pink',
};

// whole-name overrides (checked first). value = base color slug list
const WHOLE: Record<string, string[]> = {
  'light':['beige'], 'dark':['brown'], 'medium':['tan'],            // bare skin tones in color ctx
  'assorted':['multicolor'], 'multicolor':['multicolor'], 'multicolors':['multicolor'],
  'multi-color':['multicolor'], 'multi-colors':['multicolor'], 'multiple colors':['multicolor'],
  'animal print':['leopard'], 'animal print - leopard':['leopard'], 'natural':['beige'],
};

// multi-word flavor phrases -> pa_flavor
const FLAVOR_PHRASES = [
  'cotton candy','pina colada','fruit punch','green apple','sex on the beach','fuzzy navel',
  'passion fruit','cherry vanilla','strawberry pomegranate','black licorice','fruit',
];
const FLAVOR_WORDS = new Set(['cotton','candy','colada','punch','navel','pomegranate','licorice','vanilla']);
const UNIT_WORDS = new Set(['ml','oz','mm','cm']);

// skin-tone qualifier words to ignore when extracting color
const SKINTONE_NOISE = new Set([
  'light','medium','dark','skin','tone','color','colour','caucasian','undyed',
]);

// flavor words -> belongs in pa_flavor
const FLAVOR = new Set([
  'cherry','strawberry','watermelon','grape','vanilla','chocolate','mint','cottoncandy',
  'cotton','candy','pinacolada','colada','pina','fruitpunch','punch','apple','blueberry',
  'fuzzynavel','navel','sexonthebeach','beach','passion','passionfruit','peach','cocoa',
  'cream','sorbet','green-apple','strawberry-pomegranate','pomegranate','fruit',
]);

const ZODIAC = new Set(['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces']);

// people / model first-names that leaked in as colors (MAIN SQUEEZE line)
const NAMES = new Set(['alexis','allie','ariana','chantal','katrina','kiley','suki','ashley','brittany','emily','isabella','maddie','sofia','tae','nicole','marie','danielle','jade','corrupt','sin']);

function tokens(name: string): string[] {
  return name.toLowerCase().replace(/[=&]/g,' ').split(/[\s,\/\-]+/).filter(Boolean);
}

function isNumberOrUnit(name: string): { hit: boolean; value?: string } {
  const n = name.trim().toLowerCase();
  if (/^[\d.\s\/x-]+$/.test(n) && /\d/.test(n)) return { hit: true, value: name.trim() };
  if (/\b(oz|ml|mm|cm|inch|in|long|dia|tall|pcs?|pack|pk|display|meters?)\b/.test(n) && /\d/.test(n)) return { hit: true, value: name.trim() };
  if (/^\d+(\.\d+)?\s*(oz|ml|mm|cm|in)?$/.test(n)) return { hit: true, value: name.trim() };
  return { hit: false };
}

const SIZE_TOK = /^(x{0,2}s|x{0,3}l|m|2xl|3xl|4xl|1xl|os|qs|sm|lg|md|small|medium|large|queen|maxi|x|me|lar|sma|mediu|smmed|llg|med|alt)$/i;
function isSizeToken(t: string): boolean {
  return SIZE_TOK.test(t) || /^\d+(\.\d+)?(in|cm|mm|oz|ml)?$/.test(t) || UNIT_WORDS.has(t);
}

// whole name is all size/number tokens -> a size, e.g. "L Xl", "1xl 2xl", "Large 30ml"
function detectSizeFull(name: string): string | null {
  const t = tokens(name);
  if (t.length === 0) return null;
  if (t.every(isSizeToken)) return name.trim();
  if (/\b(queen size|x large|x-large)\b/.test(name.toLowerCase())) return name.trim();
  return null;
}

function detectFlavor(name: string): string | null {
  const n = name.toLowerCase();
  if (FLAVOR_PHRASES.some((p) => n.includes(p))) return name.trim();
  const toks = tokens(name);
  // single flavor word combined with a quantity/unit -> flavor (e.g. "Cherry 2 Oz")
  const hasFlavorWord = toks.some((t) => FLAVOR_WORDS.has(t) || ['cherry','strawberry','watermelon','peach','grape','chocolate','mint','blueberry','cocoa','apple'].includes(t));
  const hasQty = toks.some((t) => /\d/.test(t)) || toks.some((t) => ['oz','ml','pcs','pc','pack','pk'].includes(t));
  if (hasFlavorWord && hasQty) return name.trim();
  return null;
}

// split a single concatenated alnum token like "greenwhite" -> ['green','white']
function splitConcat(name: string): string[] {
  const s = name.toLowerCase().replace(/[^a-z]/g, '');
  if (s.length < 6 || /\s/.test(name.trim())) return [];
  const words = [...BASE, ...Object.keys(WORD)].filter((w) => !w.includes('-')).sort((a, b) => b.length - a.length);
  const out: string[] = [];
  let i = 0, guard = 0, skips = 0;
  while (i < s.length && guard++ < 12) {
    let matched = false;
    for (const w of words) {
      if (s.startsWith(w, i)) { out.push(BASE.has(w) ? w : WORD[w]); i += w.length; matched = true; break; }
    }
    if (!matched) { i++; skips++; if (skips > 2) return []; }
  }
  if (i < s.length) return [];
  return [...new Set(out)];
}

function extractColors(name: string): string[] {
  const toks = tokens(name).filter((t) => !SKINTONE_NOISE.has(t));
  const found: string[] = [];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  // BASE membership wins; only fall back to WORD synonyms for non-base tokens
  for (const t of toks) {
    if (BASE.has(t)) found.push(t);
    else if (WORD[t]) found.push(WORD[t]);
  }
  // whole-slug synonym (e.g. rose-gold, aqua-green) only when tokens found nothing and slug isn't itself a base
  if (found.length === 0 && WORD[slug] && !BASE.has(slug)) found.push(WORD[slug]);
  if (found.length === 0) {
    const concat = splitConcat(name);
    if (concat.length) return concat;
  }
  return [...new Set(found)];
}

type Mapping = {
  term_id: number; name: string; slug: string; products: number; variations: number;
  action: 'KEEP'|'COLOR'|'MOVE'|'DELETE'; colors?: string[]; taxonomy?: string; value?: string;
  variationValue?: string; note?: string;
};

function decide(name: string): Omit<Mapping,'term_id'|'name'|'slug'|'products'|'variations'> {
  const n = name.trim().toLowerCase();
  const slug = n.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

  // pure garbage
  if (/^[("]+$/.test(name.trim()) || n==='(net)' || n==='"' ) return { action:'DELETE', note:'garbage' };

  // whole-name overrides (bare skin tones, multicolor synonyms, patterns)
  if (WHOLE[n]) return { action:'COLOR', colors: WHOLE[n], variationValue: WHOLE[n].join(' / ') };

  // bare unit word (Ml, Oz) -> size/volume
  if (UNIT_WORDS.has(n)) return { action:'MOVE', taxonomy:'pa_size', value: name.trim(), note:'bare-unit' };

  // multi-word flavor / flavor+qty -> pa_flavor (before number detection so "Cherry 2 Oz" routes correctly)
  const flav = detectFlavor(name);
  if (flav) return { action:'MOVE', taxonomy:'pa_flavor', value: flav, note:'flavor' };

  // numbers / units -> size (no pa_volume taxonomy; volumes also live under pa_size)
  const nu = isNumberOrUnit(name);
  if (nu.hit) return { action:'MOVE', taxonomy:'pa_size', value: nu.value!, note:'numeric/unit' };

  // apparel size (whole name is all size tokens)
  const sz = detectSizeFull(name);
  if (sz) return { action:'MOVE', taxonomy:'pa_size', value: sz, note:'size' };

  // zodiac / model names
  const toks = tokens(name);
  if (toks.some((t)=>ZODIAC.has(t))) return { action:'DELETE', note:'zodiac' };
  if (toks.some((t)=>NAMES.has(t)) && extractColors(name).length===0) return { action:'DELETE', note:'model-name' };

  const colors = extractColors(name);
  if (colors.length>0) {
    const variationValue = colors.join(' / ');
    if (colors.length===1 && BASE.has(n)) return { action:'KEEP', colors, variationValue: colors[0] };
    return { action:'COLOR', colors, variationValue };
  }

  // strong apparel-size signal anywhere in the name (no color matched) -> pa_size
  if (/(^|\s)(s\/?m|l\/?xl|lxl|llg|smmed|x{1,3}l|[1-4]xl|o\/?s|q\/?s|qs|os)(\s|$)/i.test(name)) {
    return { action:'MOVE', taxonomy:'pa_size', value: name.trim(), note:'size-signal' };
  }

  // very long strings = product name fragments
  if (name.split(/\s+/).length>=4) return { action:'DELETE', note:'product-name-fragment' };
  if (name===name.toUpperCase() && /[A-Z]{4,}/.test(name)) return { action:'DELETE', note:'product-name-fragment' };

  // unknown single tokens (e.g. "Juicy","Sensual","Glamour","Set","Top","Heart","Gem")
  return { action:'DELETE', note:'unrecognized-non-color' };
}

async function main() {
  const db = await getConnection();
  const [rows] = await db.query<any[]>(
    `SELECT t.term_id, t.name, t.slug, tt.term_taxonomy_id,
            (SELECT COUNT(*) FROM wp_term_relationships r WHERE r.term_taxonomy_id=tt.term_taxonomy_id) AS products,
            (SELECT COUNT(*) FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation'
               WHERE pm.meta_key='attribute_pa_color' AND pm.meta_value=t.slug) AS variations
     FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id
     WHERE tt.taxonomy='pa_color' ORDER BY products DESC`
  );
  const mappings: Mapping[] = (rows as any[]).map((r) => ({
    term_id:r.term_id, name:r.name, slug:r.slug, products:Number(r.products), variations:Number(r.variations),
    ...decide(r.name),
  }));

  writeFileSync('scripts/color-cleanup-map.generated.json', JSON.stringify(mappings, null, 2));

  // summary
  const byAction: Record<string, Mapping[]> = {};
  for (const m of mappings) (byAction[m.action] ||= []).push(m);
  console.log('=== ACTION SUMMARY ===');
  for (const [a, items] of Object.entries(byAction)) {
    const prod = items.reduce((s,m)=>s+m.products,0);
    console.log(`  ${a.padEnd(7)} terms=${String(items.length).padStart(3)}  product-rels=${prod}`);
  }
  // canonical color targets
  const colorTargets: Record<string, number> = {};
  for (const m of mappings) if (m.colors) for (const c of m.colors) colorTargets[c]=(colorTargets[c]||0)+m.products;
  console.log('\n=== Resulting canonical colors (target -> total product-rels) ===');
  for (const [c,n] of Object.entries(colorTargets).sort((a,b)=>b[1]-a[1])) console.log(`  ${c.padEnd(18)} ${n}`);

  console.log('\n=== DELETE bucket (will be removed from pa_color entirely) ===');
  for (const m of byAction['DELETE']||[]) console.log(`  "${m.name}" (p=${m.products},v=${m.variations}) [${m.note}]`);

  console.log('\nWrote scripts/color-cleanup-map.generated.json');
  await db.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
