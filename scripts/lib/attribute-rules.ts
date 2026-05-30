/**
 * Category → allowed attribute-dimension rules. Domain constraints that keep
 * product attributes sane: e.g. only lubes/cleaners can have VOLUME; only
 * lubes/cleaners/condoms can have FLAVOR. Used to (a) audit existing data for
 * violations and (b) validate/reject at import time.
 *
 * Dimensions: color | apparel | volume | length | flavor | material | count | weight
 */
export type AttrDim = 'color' | 'apparel' | 'volume' | 'length' | 'flavor' | 'material' | 'count' | 'weight' | 'other';

export interface CategoryRule {
  name: string;
  /** matches against any of a product's category slugs */
  cat: RegExp;
  /** dimensions allowed for products in this category family */
  allow: AttrDim[];
}

// Order matters: first matching rule wins for "primary family"; audit/import use
// the UNION of all matching rules' allowances (a product may sit in several cats).
export const CATEGORY_RULES: CategoryRule[] = [
  // Lubes, cleaners, oils, creams, lotions, sprays, gels, hygiene, douches.
  // NOTE: avoid bare "massage" — it false-matches the TOY category
  // "magic-wands-body-massagers". The lube massage cat ("massage-lotions-creams")
  // is caught via lotion/cream instead.
  {
    name: 'lube/cleaner/topical',
    cat: /lubric|\blubes?\b|cleaner|\boils?\b|oil-based|\blotions?\b|\bsprays?\b|hygiene|douche|enema|moistur|erotic-body|\bgels?\b|\bcreams?\b|flavored\b/i,
    allow: ['volume', 'flavor'],
  },
  // Condoms
  { name: 'condom', cat: /condom/i, allow: ['count', 'flavor'] },
  // Edible / oral / scented — legitimately flavored/scented (not just lubes)
  { name: 'edible/oral/scented', cat: /oral|edible|candy|erotic-food|\bfood\b|candle|kissable|lickable|nipple|massage-candle/i, allow: ['flavor', 'volume', 'count'] },
  // Apparel / lingerie / costumes
  {
    name: 'apparel',
    cat: /lingerie|clothing|costume|apparel|underwear|bodystocking|panty|panties|thong|bra-|jock|harness-wear|dress|teddy|babydoll|corset|stocking/i,
    allow: ['apparel', 'color', 'material', 'count'],
  },
];

// Everything else (toys: dildos, dongs, anal, cock-rings, plugs, vibes, masturbators,
// extensions, pumps, beads, bullets, eggs, wands…) — physical products.
export const DEFAULT_ALLOW: AttrDim[] = ['length', 'color', 'material', 'apparel', 'count'];

/** Dimensions globally restricted to specific families (the strongest rules). */
const LUBE_CAT = /lubric|\blubes?\b|cleaner|\boils?\b|oil-based|\blotions?\b|\bsprays?\b|hygiene|douche|enema|moistur|erotic-body|\bgels?\b|\bcreams?\b|flavored\b/i;
export const RESTRICTED: Partial<Record<AttrDim, RegExp>> = {
  volume: LUBE_CAT,                              // volume only on lube/topical
  flavor: new RegExp(LUBE_CAT.source + '|condom|oral|edible|candy|erotic-food|\\bfood\\b|candle|kissable|lickable|nipple', 'i'), // lube/topical + condoms + edible/oral/scented
};

/** Union of allowed dims for a product given its category slugs. */
export function allowedDims(catSlugs: string[]): Set<AttrDim> {
  const allowed = new Set<AttrDim>();
  let matched = false;
  for (const rule of CATEGORY_RULES) {
    if (catSlugs.some((c) => rule.cat.test(c))) { rule.allow.forEach((d) => allowed.add(d)); matched = true; }
  }
  if (!matched) DEFAULT_ALLOW.forEach((d) => allowed.add(d));
  return allowed;
}

/**
 * Is `dim` allowed for a product in these categories? Considers both the
 * category-family allowance and the global RESTRICTED list (volume/flavor).
 */
export function isDimAllowed(dim: AttrDim, catSlugs: string[]): boolean {
  if (dim === 'other' || dim === 'weight') return true; // unconstrained
  // global restriction: volume/flavor only on their permitted families
  const restrict = RESTRICTED[dim];
  if (restrict && !catSlugs.some((c) => restrict.test(c))) return false;
  return allowedDims(catSlugs).has(dim);
}
