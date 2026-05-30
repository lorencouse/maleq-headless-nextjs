/**
 * Attribute sanitizer — the single source of truth for routing + canonicalizing
 * product attribute values at IMPORT time, so new data matches the cleaned schema
 * and we never re-dirty the DB.
 *
 * Encodes everything learned from the 2026-05 attribute cleanups:
 *   - ROUTE by VALUE, not by source attribute name. A "Size" attribute holding
 *     "Black" is a color; "2 Oz" is volume; "8in" is length. Value wins.
 *   - CANONICALIZE slugs: 6in->6-in, Sm->s (Small), 4 Oz->4-oz, match colors/
 *     flavors/materials to existing vocab.
 *   - SPLIT dimensions into their proper taxonomies: pa_color / pa_size (apparel)
 *     / pa_volume / pa_length / pa_flavor / pa_material / pa_pack(count).
 *   - FLAG junk (product-name strings) so it never becomes an attribute value.
 *
 * Pure + dependency-free. Pass live DB vocab (colorVocab/flavorVocab/materialVocab
 * as Sets of slugs) for best matching; falls back to built-in word lists.
 */

import { isDimAllowed } from './attribute-rules';

export type AttrDim = 'color' | 'apparel' | 'volume' | 'length' | 'weight' | 'flavor' | 'material' | 'count' | 'other';

// skin-tone names that are COLORS on toys but read like flavors (vanilla/chocolate…)
const SKIN_TONES = new Set(['vanilla', 'caramel', 'chocolate', 'mocha', 'flesh', 'tan', 'beige', 'nude', 'ivory', 'brown']);

export interface Classified {
  dim: AttrDim;
  taxonomy: string; // pa_color | pa_size | pa_volume | pa_length | pa_flavor | pa_material | pa_pack | <fallback>
  slug: string;     // canonical slug to store / match
  name: string;     // canonical display name (for new terms)
  junk?: boolean;   // product-name garbage — should NOT become an attribute value
  note?: string;
}

export interface SanitizeOpts {
  colorVocab?: Set<string>;
  flavorVocab?: Set<string>;
  materialVocab?: Set<string>;
  /** source attribute name (e.g. "Size","Style","Variant") used only as a weak hint */
  attrHint?: string;
}

export const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200);

const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ── apparel ────────────────────────────────────────────────────────────────
const SIZE_CANON: Record<string, string> = {
  xs: 'xs', 'x-small': 'xs', xsmall: 'xs', s: 's', small: 's', sm: 's', sml: 's',
  m: 'm', medium: 'm', med: 'm', l: 'l', large: 'l', lg: 'l', lar: 'l', lge: 'l',
  xl: 'xl', 'x-large': 'xl', xlarge: 'xl', xxl: '2xl', 'xx-large': '2xl', '2xl': '2xl',
  xxxl: '3xl', 'xxx-large': '3xl', '3xl': '3xl', 'xxxx-large': '4xl', '4xl': '4xl', xxxxl: '4xl',
  's-m': 's-m', sm2: 's-m', 'm-l': 'm-l', ml: 'm-l', 'l-xl': 'l-xl', lxl: 'l-xl', 'xl-xxl': 'xl-2xl', 'xl-2xl': 'xl-2xl',
  'one-size': 'one-size', os: 'one-size', 'o-s': 'one-size', onesize: 'one-size', 'one-size-queen': 'one-size', osq: 'one-size', osqueen: 'one-size',
  queen: 'queen', qs: 'queen', 'q-s': 'queen', 'queen-size': 'queen',
  '1x': '1x', '2x': '2x', '3x': '3x', '4x': '4x', '5x': '5x', plus: 'plus', petite: 'petite', king: 'king', mini: 'mini',
};
const SIZE_NAME: Record<string, string> = {
  xs: 'X-Small', s: 'Small', m: 'Medium', l: 'Large', xl: 'X-Large', '2xl': 'XX-Large', '3xl': 'XXX-Large', '4xl': 'XXXX-Large',
  's-m': 'S/M', 'm-l': 'M/L', 'l-xl': 'L/XL', 'xl-2xl': 'XL/XXL', 'one-size': 'One Size', queen: 'Queen',
  '1x': '1X', '2x': '2X', '3x': '3X', '4x': '4X', '5x': '5X', plus: 'Plus', petite: 'Petite', king: 'King', mini: 'Mini',
};

const COLOR_WORDS = new Set(['black', 'white', 'red', 'blue', 'pink', 'purple', 'clear', 'flesh', 'beige', 'tan', 'green', 'yellow', 'gold', 'silver', 'nude', 'ivory', 'brown', 'grey', 'gray', 'orange', 'teal', 'aqua', 'burgundy', 'turquoise', 'navy', 'coral', 'lavender', 'violet', 'rose', 'cobalt', 'garnet', 'periwinkle', 'neon', 'royal', 'translucent', 'magenta', 'crimson', 'charcoal', 'bronze', 'copper', 'multicolor', 'rainbow']);
const MATERIAL_WORDS = new Set(['silicone', 'glass', 'metal', 'steel', 'stainless-steel', 'leather', 'latex', 'rubber', 'tpe', 'tpr', 'jelly', 'vinyl', 'nylon', 'cotton', 'lace', 'mesh', 'satin', 'velvet', 'abs', 'pvc', 'aluminum', 'ceramic', 'wood']);
// lube/scent product-forms intentionally kept as flavor values (editorial decision from flavor cleanup)
const FLAVOR_FORMS = new Set(['gel', 'cream', 'lotion', 'spray', 'oil-based', 'warming', 'cooling', 'desensitizing', 'fresh', 'floral', 'unflavored', 'unscented']);

function parseMeasurement(value: string): Classified | null {
  const s = value.trim().toLowerCase().replace(/\s+/g, ' ');
  // reject extra descriptive words (color/"with balls"/dimension-strings) — let caller leave as-is
  if (/(black|white|red|blue|pink|clear|flesh|with\s+balls|balls|\blong\b.*\bdia\b)/.test(s)) return null;
  let m: RegExpMatchArray | null;
  // volume (oz treated as fl-oz; 3.4 oz = 100 ml)
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?(?:fluid\s*)?oz\b/))) { const v = m[1]; return { dim: 'volume', taxonomy: 'pa_volume', slug: slugify(`${v} oz`), name: `${v} oz` }; }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*ml\b/))) { const v = m[1]; return { dim: 'volume', taxonomy: 'pa_volume', slug: slugify(`${v} ml`), name: `${v} ml` }; }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:l|liter|litre)\b/))) { const v = m[1]; return { dim: 'volume', taxonomy: 'pa_volume', slug: slugify(`${v} l`), name: `${v} L` }; }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:g|gram|grams|gm)\b/))) { const v = m[1]; return { dim: 'weight', taxonomy: 'pa_volume', slug: slugify(`${v} g`), name: `${v} g` }; }
  // length
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")\b/))) { const v = m[1]; return { dim: 'length', taxonomy: 'pa_length', slug: slugify(`${v} in`), name: `${v} in` }; }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*cm\b/))) { const v = m[1]; return { dim: 'length', taxonomy: 'pa_length', slug: slugify(`${v} cm`), name: `${v} cm` }; }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*mm\b/))) { const v = m[1]; return { dim: 'length', taxonomy: 'pa_length', slug: slugify(`${v} mm`), name: `${v} mm` }; }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft|foot|feet)\b/))) { const v = m[1]; return { dim: 'length', taxonomy: 'pa_length', slug: slugify(`${v} ft`), name: `${v} ft` }; }
  return null;
}

function parseCount(value: string): Classified | null {
  const s = value.trim().toLowerCase().replace(/\s+/g, ' ');
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+)\s*(?:pcs?|pc|piece|pieces|pack|packs|pk|count|ct)\b/))) return { dim: 'count', taxonomy: 'pa_pack', slug: slugify(`${m[1]} pk`), name: `${m[1]} pk` };
  if ((m = s.match(/^(\d+)\s*display\b/))) return { dim: 'count', taxonomy: 'pa_pack', slug: slugify(`${m[1]} display`), name: `${m[1]} display` };
  return null;
}

function isJunk(value: string): boolean {
  const n = value.trim();
  if (n.length > 40) return true; // attribute values are short; long = product-name dump
  if (n === n.toUpperCase() && /[A-Z]{3,}/.test(n) && n.split(/\s+/).length >= 3) return true; // ALL-CAPS product name
  if (/(per customer|prepack|combo pack|w\/|with\b.*\band\b)/i.test(n) && n.split(/\s+/).length >= 4) return true;
  return false;
}

/**
 * Classify+route a single attribute value to its proper taxonomy + canonical slug.
 * Value-first (a "Size" attr holding a color is routed to pa_color, etc.).
 */
export function classifyAttributeValue(value: string, opts: SanitizeOpts = {}): Classified {
  const raw = (value ?? '').trim();
  const sl = slugify(raw);
  if (!raw) return { dim: 'other', taxonomy: 'pa_size', slug: '', name: '', note: 'empty' };

  // 1. apparel size
  if (SIZE_CANON[sl]) { const c = SIZE_CANON[sl]; return { dim: 'apparel', taxonomy: 'pa_size', slug: c, name: SIZE_NAME[c] || titleCase(c) }; }
  // 2. measurement (volume/length/weight)
  const meas = parseMeasurement(raw); if (meas) return meas;
  // 3. color (live vocab beats word list)
  if (opts.colorVocab?.has(sl) || COLOR_WORDS.has(sl)) return { dim: 'color', taxonomy: 'pa_color', slug: sl, name: titleCase(sl) };
  // 4. flavor (live vocab or kept product-forms)
  if (opts.flavorVocab?.has(sl) || FLAVOR_FORMS.has(sl)) return { dim: 'flavor', taxonomy: 'pa_flavor', slug: sl, name: titleCase(sl) };
  // 5. material
  if (opts.materialVocab?.has(sl) || MATERIAL_WORDS.has(sl)) return { dim: 'material', taxonomy: 'pa_material', slug: sl, name: titleCase(sl) };
  // 6. count / pack
  const cnt = parseCount(raw); if (cnt) return cnt;
  // 7. junk product-name strings — should not be an attribute value
  if (isJunk(raw)) return { dim: 'other', taxonomy: 'pa_size', slug: sl, name: raw, junk: true, note: 'product-name-junk' };
  // 8. bare number / unknown -> keep, undecided (caller may use attrHint)
  const hintTax = opts.attrHint ? `pa_${slugify(opts.attrHint)}` : 'pa_size';
  return { dim: 'other', taxonomy: hintTax, slug: sl, name: raw, note: 'unclassified' };
}

export interface AxisResolution {
  taxonomy: string;          // the taxonomy the whole variation axis should use
  pure: boolean;             // true if all non-junk values share one dim
  perValue: Map<string, Classified>; // original value -> classification
  junkValues: string[];
  warning?: string;
}

/**
 * Resolve the taxonomy for a whole variation axis from its option values.
 * If all real values share one dim -> route the axis there; otherwise keep the
 * source attribute taxonomy and WARN (mixed axis — the thing that dirtied pa_size/style).
 */
export function resolveAxis(attrName: string, values: string[], opts: SanitizeOpts = {}): AxisResolution {
  const perValue = new Map<string, Classified>();
  const junkValues: string[] = [];
  const dims = new Set<string>();
  for (const v of values) {
    const c = classifyAttributeValue(v, { ...opts, attrHint: attrName });
    perValue.set(v, c);
    if (c.junk) junkValues.push(v);
    else if (c.dim !== 'other') dims.add(c.taxonomy);
  }
  const fallback = `pa_${slugify(attrName)}`;
  if (dims.size === 1) return { taxonomy: [...dims][0], pure: true, perValue, junkValues };
  if (dims.size === 0) return { taxonomy: fallback, pure: false, perValue, junkValues, warning: 'no classifiable values' };
  return { taxonomy: fallback, pure: false, perValue, junkValues, warning: `mixed dimensions: ${[...dims].join(', ')} — left on ${fallback}` };
}

/**
 * Apply category→attribute rules to a classified value (CLAUDE.md "Attribute Data
 * Hygiene"): e.g. a "flavor" on a toy that's a skin-tone → color; volume on a
 * non-lube → junk. Returns the corrected classification (+ note on what changed).
 */
export function reconcileWithCategory(c: Classified, catSlugs: string[]): Classified {
  if (!catSlugs.length || c.dim === 'other') return c;
  if (isDimAllowed(c.dim, catSlugs)) return c;
  // flavor on a non-lube/condom product that's a skin-tone name → it's really a color
  if (c.dim === 'flavor' && SKIN_TONES.has(c.slug)) return { ...c, dim: 'color', taxonomy: 'pa_color', note: 'rule: flavor→color (skin-tone)' };
  // volume/flavor where the category forbids it → flag as junk (don't create the term)
  if (c.dim === 'volume' || c.dim === 'flavor') return { ...c, junk: true, note: `rule: ${c.dim} not allowed for category` };
  return { ...c, note: `rule: ${c.dim} unusual for category — review` };
}

/** Detect duplicate variation combos (the missing-axis signature that broke RealRock-style products). */
export function findDuplicateVariationCombos(variations: { attributes: Record<string, string> }[]): { hasDuplicates: boolean; total: number; distinct: number } {
  const seen = new Set<string>();
  for (const v of variations) {
    const key = Object.entries(v.attributes).sort().map(([k, val]) => `${k}=${val}`).join('&');
    seen.add(key);
  }
  return { hasDuplicates: seen.size < variations.length, total: variations.length, distinct: seen.size };
}
