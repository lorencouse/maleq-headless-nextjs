/**
 * Restricted-product gate for imports.
 *
 * Stripe closed the Male Q account in Sep 2026 and, as an appeal condition, asked us
 * to "remove any product containing CBD". Their Restricted Businesses list also bars
 * other categories a wholesale adult feed happens to carry. This module is the single
 * place that says what we will NOT sell, so every import path can refuse them and the
 * audit script can find any that slipped through.
 *
 *   import { checkRestrictedProduct, loadRestrictedAllowlist } from '@/lib/import/restricted-products';
 *   const r = checkRestrictedProduct({ name, description, brand, categories, barcode });
 *   if (r.restricted) skip(`${r.category}: ${r.matches.join(', ')}`);
 *
 * Design notes:
 * - Rules are keyword patterns scoped to the fields where they are reliable. Titles,
 *   brand and category names are "strong" fields; descriptions are noisy and only
 *   the unambiguous chemical terms (CBD, THC, nicotine, nitrites…) are checked there.
 * - Calibrated against the live catalog (2026-09-11). Known false positives that the
 *   `unless` guards exist for: "Bong Thong" briefs, "Cock Pipe" rings, "Cherry Poppers"
 *   lingerie, "Vaporator … Vape" vibrator, "Magic Mushroom" wand, "Red Tobacco" candle.
 * - Anything the rules get wrong is overridden per product in
 *   `data/restricted-allowlist.json` (by barcode/SKU or exact name), never by loosening
 *   a rule for one SKU.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type RestrictedCategory =
  | 'cannabinoid'          // CBD, THC, Delta-8/9/10, HHC, kratom, kava
  | 'vape-tobacco'         // vapes, e-liquid, nicotine, cigarettes, hookah
  | 'psychedelic'          // amanita / psilocybin / "magic mushroom" consumables
  | 'drug-paraphernalia'   // bongs, pipes, one-hitters, stash jars, grinders, rolling papers
  | 'poppers'              // alkyl nitrite "aromas" sold as leather cleaner / room odorizer
  | 'drug-test-evasion'    // synthetic urine, detox drinks marketed for drug tests
  | 'supplement';          // sexual-enhancement pills / capsules / "dietary supplements"

export type RestrictedField = 'name' | 'brand' | 'category' | 'description';

export interface RestrictedRule {
  category: RestrictedCategory;
  /** Case-insensitive; tested against each listed field independently. */
  pattern: RegExp;
  fields: RestrictedField[];
  /** If this matches the same field text, the rule does not fire (false-positive guard). */
  unless?: RegExp;
  note?: string;
}

export interface RestrictedCheckInput {
  name: string;
  description?: string | null;
  brand?: string | null;
  categories?: Array<string | null | undefined> | null;
  /** Any identifiers the allowlist may key on. */
  sku?: string | null;
  barcode?: string | null;
}

export interface RestrictedCheckResult {
  restricted: boolean;
  category: RestrictedCategory | null;
  /** Matched text snippets, e.g. ["CBD", "Delta 8"]. */
  matches: string[];
  /** Field the first match came from. */
  field: RestrictedField | null;
  /** True when the product matched a rule but is explicitly allowlisted. */
  allowlisted: boolean;
}

export interface RestrictedAllowlist {
  /** Barcodes / SKUs that may be imported despite matching a rule. */
  ids: Set<string>;
  /** Exact product names (case-insensitive) that may be imported despite matching a rule. */
  names: Set<string>;
}

/** Brands whose whole catalog is restricted. Keys are lower-cased. */
export const RESTRICTED_BRANDS: Record<string, RestrictedCategory> = {
  'assorted cbd vendors': 'cannabinoid',
  'cbd daily': 'cannabinoid',
  'kush queen': 'cannabinoid',
  '420 health': 'cannabinoid',
  'hemp bombs': 'cannabinoid',
  'cbdfx': 'cannabinoid',
  // NOT listed: "Empire Smoke Distributor" — its Whizzinator / Rescue Detox SKUs are
  // caught by name, and blocklisting the brand would also drop harmless Smoxy candles.
};

const STRONG: RestrictedField[] = ['name', 'brand', 'category'];
const ALL: RestrictedField[] = ['name', 'brand', 'category', 'description'];

export const RESTRICTED_RULES: RestrictedRule[] = [
  // --- cannabinoids: unambiguous chemistry, check everywhere (incl. descriptions)
  {
    category: 'cannabinoid',
    pattern: /\b(cbd|cannabidiol|cbg|cbn|hhc|thc[\s-]?[aopv]?|thcp|delta[\s-]?(8|9|10)|cannabinoids?|full[\s-]spectrum (hemp|cbd)|hemp[\s-]derived|kratom)\b/i,
    fields: ALL,
    // Descriptions of drug-test kits list THC as a panel; that is not a cannabinoid product.
    unless: /\b(drugs? (of abuse|test)|test (cup|strip|kit|panel)|\d+[\s-]panel)\b/i,
    note: 'Hemp-seed-oil cosmetics without CBD are fine; "THC-free" / "0% THC" claims are stripped before matching.',
  },
  { category: 'cannabinoid', pattern: /\bterpenes?\s+oil\b/i, fields: STRONG },
  {
    category: 'cannabinoid',
    // CBD product lines that show up in titles under a distributor's brand
    // (e.g. "Kush Queen Bath Bomb" filed under Doc Johnson).
    pattern: /\b(kush queen|cbd daily|420 health|hemp bombs|cbdfx|koi cbd|charlotte'?s web|cbdistillery|hempleasure cbd)\b/i,
    fields: ['name', 'brand'],
  },

  // --- vapes / nicotine / tobacco
  {
    category: 'vape-tobacco',
    pattern: /\b(nicotine|e-?liquid|e-?juice|e-?cig(arette)?s?|vaporizers?|vape (pens?|cartridges?|carts?|pods?|juice|kits?|display)|disposable vapes?|nicotine pouches)\b/i,
    fields: ALL,
    // "Vaporator" is a vibrator styled like a vape cartridge; toy vocabulary clears it.
    unless: /\b(vibrat\w*|silicone|rechargeable|stroker|massager|dildo|butt plug|sex toy|clitoral|g-?spot)\b/i,
  },
  {
    category: 'vape-tobacco',
    // Tobacco goods proper. Titles/categories only — ashtray and mug descriptions
    // mention cigarettes, and "Hookah" is a Tantus dildo shape, so it is not listed.
    pattern: /\b(cigarettes?|cigars?|cigarillos?|rolling tobacco|pipe tobacco|chewing tobacco|snus|dip tobacco)\b/i,
    fields: STRONG,
    unless: /\b(candle|holder|case|lighter|costume|prop|novelty|pasties)\b/i,
  },
  {
    category: 'vape-tobacco',
    pattern: /\bvapes?\b/i,
    fields: ['name'],
    unless: /\b(vibrat\w*|silicone|rechargeable|stroker|massager|dildo|plug)\b/i, // "Vaporator Vibrating Silicone Rechargeable Vape" is a toy
  },

  // --- psychedelics
  {
    category: 'psychedelic',
    pattern: /\b(amanita|psilocybin|psilocin|muscimol|microdos\w*|nootropic|mushroom (gummies|gummy|chocolate|capsules?|vape|edibles?))\b/i,
    fields: ALL,
  },
  {
    category: 'psychedelic',
    pattern: /\bmagic (mushroom|shroom)s?\b/i,
    fields: ['name'],
    unless: /\b(vibrat\w*|wand|massager|dildo|plug|pasties|stroker|print|thong|panty|bodysuit)\b/i, // toy shapes and prints
  },

  // --- paraphernalia (titles/categories only — descriptions mention "pipe" for fittings etc.)
  {
    category: 'drug-paraphernalia',
    // Stripe: "equipment designed for making or using drugs, such as bongs,
    // vaporizers, and pipes". Storage (stash jars) and ashtrays are legal
    // accessories and deliberately NOT listed — see the audit report for them.
    pattern: /\b(dab (rigs?|tools?|nails?)|herb grinders?|weed grinders?|smoking pipes?|glass pipes?|water pipes?|hand pipes?|spoon pipes?|chillums?|bubblers?|dugouts?|blunt wraps?|pre-?rolled cones?|(glass|water|acrylic|silicone|beaker|percolator|mini) bongs?)\b/i,
    fields: STRONG,
    unless: /\b(pico ?bong|beer bong|thong|brief|jock|sticker|card|kard|mug|pin|key ?chain|air freshener)\b/i, // PicoBong toys, "Bong Thong", novelty pins
  },
  {
    category: 'drug-paraphernalia',
    // "One Hitter Kards" are greeting cards that ship with a real one-hitter pipe,
    // so no card/kard guard here.
    pattern: /\bone[\s-]?hitters?\b/i,
    fields: STRONG,
  },

  // --- poppers: sold under brand names, so match whole titles + the chemistry in descriptions
  {
    category: 'poppers',
    pattern: /^\s*(locker ?room|iron horse|jungle juice( max| platinum| black label| gold| plus)?|blue boy|rush( black| ultra| original| gold| zero)?|super rush|amsterdam( special| gold| platinum)?|man scent|pig sweat|quick ?silver|taiwan blue|english( royal)?|brown bottle)\s*(\d+\s?ml)?\s*$/i,
    fields: ['name'],
    note: 'Whole-title match only, so "Tantus Amsterdam" dildos and "Sugar Rush" vibes do not fire.',
  },
  {
    category: 'poppers',
    pattern: /\b((alkyl|amyl|isobutyl|isopropyl|pentyl|cyclohexyl) nitrites?|liquid (aromas?|incense)|room odori[sz]ers?|leather cleaner|video head cleaner|nail polish remover|solvent cleaner)\b/i,
    fields: ALL,
  },

  // --- drug-test evasion
  {
    category: 'drug-test-evasion',
    pattern: /\b(whizzinator|synthetic urine|fake (urine|pee)|urine (kit|belt)|detox (drinks?|shots?|kits?|mouthwash|shampoo)|rescue detox|(pass|beat) (a|your|the) drug test|drug test (kit|cleanser))\b/i,
    fields: ALL,
  },

  // --- pseudo-pharmaceutical supplements (titles/brand/category only)
  {
    category: 'supplement',
    pattern: /\b((male|female|sexual|performance) enhancement (pills?|capsules?|supplements?|tablets?)|enhancement pills?|erection pills?|libido (pills?|boosters?|supplements?|capsules?)|dietary supplements?|testosterone boosters?|softgels?|\d+\s?(ct|count|pk) (pills?|capsules?)|(pills?|capsules?)\s?\d+\s?(ct|count|pk))\b/i,
    fields: STRONG,
    unless: /\b(stroker|masturbator|vibe|vibrator|dildo|cock ?ring|insert|game|costume|candy|gummy)\b/i, // "Rize the Pill Mini Stroker", "Stash Cockring w/ Capsule Insert"
  },
];

/**
 * MySQL REGEXP prefilter for descriptions. The audit script pulls the (large)
 * description column only for rows matching this, so it must cover every term the
 * description-scoped rules above can fire on. Keep in sync when editing `fields: ALL` rules.
 */
export const DESCRIPTION_PREFILTER_REGEXP =
  'cbd|cannabidiol|\\bcbg\\b|\\bcbn\\b|\\bhhc\\b|\\bthc|delta[ -]?(8|9|10)|cannabinoid|full[ -]spectrum|hemp[ -]derived|kratom' +
  '|nicotine|e-?liquid|e-?juice|e-?cig|vaporizer|vape (pen|cartridge|cart|pod|juice|kit|display)|disposable vape' +
  '|amanita|psilocybin|psilocin|muscimol|microdos|nootropic|mushroom (gumm|chocolate|capsule|vape|edible)' +
  '|nitrite|liquid (aroma|incense)|room odori|leather cleaner|video head cleaner|nail polish remover|solvent cleaner' +
  '|whizzinator|synthetic urine|fake (urine|pee)|urine (kit|belt)|detox (drink|shot|kit|mouthwash|shampoo)|rescue detox|drug test';

const ALLOWLIST_PATH = join(process.cwd(), 'data', 'restricted-allowlist.json');

/** Load `data/restricted-allowlist.json`; missing/invalid file → empty allowlist. */
export function loadRestrictedAllowlist(path: string = ALLOWLIST_PATH): RestrictedAllowlist {
  const empty: RestrictedAllowlist = { ids: new Set(), names: new Set() };
  if (!existsSync(path)) return empty;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as {
      ids?: Array<string | { id: string }>;
      names?: Array<string | { name: string }>;
    };
    const ids = (raw.ids ?? []).map((e) => (typeof e === 'string' ? e : e.id)).filter(Boolean);
    const names = (raw.names ?? []).map((e) => (typeof e === 'string' ? e : e.name)).filter(Boolean);
    return {
      ids: new Set(ids.map((s) => s.trim().toLowerCase())),
      names: new Set(names.map((s) => s.trim().toLowerCase())),
    };
  } catch (err) {
    console.warn(`Warning: could not parse ${path}: ${err instanceof Error ? err.message : err}`);
    return empty;
  }
}

function isAllowlisted(input: RestrictedCheckInput, allowlist?: RestrictedAllowlist): boolean {
  if (!allowlist) return false;
  for (const id of [input.sku, input.barcode]) {
    if (id && allowlist.ids.has(id.trim().toLowerCase())) return true;
  }
  return allowlist.names.has(input.name.trim().toLowerCase());
}

/** Strip tags/entities so a description like `<p>CBD&nbsp;infused</p>` still matches. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove negated cannabinoid claims ("THC-free", "0% THC", "no CBD", "contains no
 * cannabinoids") so a hemp-seed candle that brags about being THC-free is not
 * mistaken for a THC product. Applied to every field.
 */
const CANNABINOID_WORD = '(thc|cbd|cbg|cbn|hhc|cannabinoids?|delta[\\s-]?(?:8|9|10))';
export const NEGATED_CLAIMS = [
  // "THC-free", "THC free"
  new RegExp(`\\b${CANNABINOID_WORD}[\\s-]*free\\b`, 'gi'),
  // "0.00% THC", "less than 0.3% THC", "no traces of THC", "zero THC", "non-THC"
  new RegExp(`\\b(no|zero|non|0(\\.0+)?\\s?%|<\\s?0\\.3\\s?%|less than 0\\.3\\s?%|under 0\\.3\\s?%|0\\.3\\s?%)[\\s-]*(\\w+\\s+){0,3}${CANNABINOID_WORD}\\b`, 'gi'),
  // "free of parabens, …, THC", "without any THC", "sterilized to remove any THC"
  new RegExp(`\\b(free (of|from)|without|contains? no|remove[sd]?|removing|eliminat\\w+|stripped of|devoid of)\\b[^.;!?]{0,120}?\\b${CANNABINOID_WORD}\\b`, 'gi'),
  // "THC: 0", "THC not detected"
  new RegExp(`\\b${CANNABINOID_WORD}\\s*:?\\s*(0|none|0\\s?mg|not detected|nd)\\b`, 'gi'),
];
export function stripNegatedClaims(text: string): string {
  let out = text;
  for (const re of NEGATED_CLAIMS) out = out.replace(re, ' ');
  return out;
}

function fieldTexts(input: RestrictedCheckInput): Record<RestrictedField, string[]> {
  return {
    name: [stripNegatedClaims(input.name ?? '')],
    brand: input.brand ? [input.brand] : [],
    category: (input.categories ?? []).filter((c): c is string => typeof c === 'string' && c.length > 0),
    description: input.description ? [stripNegatedClaims(plainText(input.description))] : [],
  };
}

/**
 * Decide whether a product may be imported / published.
 * Order: allowlist → restricted brand → rules (first match wins, but all matches are collected).
 */
export function checkRestrictedProduct(
  input: RestrictedCheckInput,
  opts: { allowlist?: RestrictedAllowlist; rules?: RestrictedRule[] } = {},
): RestrictedCheckResult {
  const rules = opts.rules ?? RESTRICTED_RULES;
  const texts = fieldTexts(input);

  let category: RestrictedCategory | null = null;
  let field: RestrictedField | null = null;
  const matches: string[] = [];

  const brandKey = (input.brand ?? '').trim().toLowerCase();
  if (brandKey && RESTRICTED_BRANDS[brandKey]) {
    category = RESTRICTED_BRANDS[brandKey];
    field = 'brand';
    matches.push(`brand:${input.brand!.trim()}`);
  }

  for (const rule of rules) {
    for (const f of rule.fields) {
      for (const text of texts[f]) {
        if (!text) continue;
        const m = text.match(rule.pattern);
        if (!m) continue;
        if (rule.unless && rule.unless.test(text)) continue;
        if (!category) {
          category = rule.category;
          field = f;
        }
        const snippet = m[0].trim();
        if (snippet && !matches.includes(snippet)) matches.push(snippet);
      }
    }
  }

  if (!category) {
    return { restricted: false, category: null, matches: [], field: null, allowlisted: false };
  }

  if (isAllowlisted(input, opts.allowlist)) {
    return { restricted: false, category, matches, field, allowlisted: true };
  }

  return { restricted: true, category, matches, field, allowlisted: false };
}

/** One-line human summary for import logs. */
export function describeRestriction(r: RestrictedCheckResult): string {
  if (!r.category) return 'not restricted';
  const via = r.field ? ` via ${r.field}` : '';
  const what = r.matches.length ? `: ${r.matches.slice(0, 4).join(', ')}` : '';
  return `${r.category}${via}${what}${r.allowlisted ? ' (allowlisted)' : ''}`;
}

/**
 * Split a list into importable items and restricted drops.
 * `toInput` adapts your record shape (XMLProduct, DB row…) to RestrictedCheckInput.
 */
export function partitionRestricted<T>(
  items: T[],
  toInput: (item: T) => RestrictedCheckInput,
  opts: { allowlist?: RestrictedAllowlist; rules?: RestrictedRule[] } = {},
): { kept: T[]; dropped: Array<{ item: T; result: RestrictedCheckResult }> } {
  const kept: T[] = [];
  const dropped: Array<{ item: T; result: RestrictedCheckResult }> = [];
  for (const item of items) {
    const result = checkRestrictedProduct(toInput(item), opts);
    if (result.restricted) dropped.push({ item, result });
    else kept.push(item);
  }
  return { kept, dropped };
}

// ─── Serialized rule set for the WordPress-side guard ───────────────────────
//
// `wordpress/mu-plugins/maleq-restricted-products-guard.php` cannot import this
// module, so the rules are exported to `maleq-restricted-rules.json` next to it
// (`bun scripts/gen-restricted-rules.ts`). Keep the patterns PCRE-compatible:
// no lookbehind, named groups, `\u{…}` or the `y`/`s` flags — the sync test
// (`__tests__/lib/restricted-rules-sync.test.ts`) checks that and that the JSON
// on disk matches what this module would generate.

export const HIDDEN_REASON_META_KEY = '_maleq_hidden_reason';

export interface SerializedRegex {
  source: string;
  /** JS flags; the PHP side drops `g` (preg_replace is global anyway). */
  flags: string;
}

export interface SerializedRestrictedRules {
  _generated: string;
  hiddenReasonMeta: string;
  brands: Record<string, RestrictedCategory>;
  negatedClaims: SerializedRegex[];
  rules: Array<{
    category: RestrictedCategory;
    pattern: SerializedRegex;
    fields: RestrictedField[];
    unless: SerializedRegex | null;
    note?: string;
  }>;
  allowlist: { ids: string[]; names: string[] };
}

const serializeRegex = (re: RegExp): SerializedRegex => ({ source: re.source, flags: re.flags });

export function buildSerializedRestrictedRules(
  allowlist: RestrictedAllowlist = loadRestrictedAllowlist(),
): SerializedRestrictedRules {
  return {
    _generated:
      'GENERATED by `bun scripts/gen-restricted-rules.ts` from lib/import/restricted-products.ts + data/restricted-allowlist.json — do not edit by hand',
    hiddenReasonMeta: HIDDEN_REASON_META_KEY,
    brands: RESTRICTED_BRANDS,
    negatedClaims: NEGATED_CLAIMS.map(serializeRegex),
    rules: RESTRICTED_RULES.map((r) => ({
      category: r.category,
      pattern: serializeRegex(r.pattern),
      fields: r.fields,
      unless: r.unless ? serializeRegex(r.unless) : null,
      ...(r.note ? { note: r.note } : {}),
    })),
    allowlist: {
      ids: [...allowlist.ids].sort(),
      names: [...allowlist.names].sort(),
    },
  };
}

/** Path of the JSON the mu-plugin reads. */
export const SERIALIZED_RULES_PATH = join(
  process.cwd(),
  'wordpress',
  'mu-plugins',
  'maleq-restricted-rules.json',
);
