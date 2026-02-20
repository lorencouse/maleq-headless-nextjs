/**
 * Classification — color/size/type/formula word lists and classifiers.
 *
 * Consolidates duplicated classification logic from fix-duplicate-variations.ts
 * and enforce-single-attribute.ts into a single module.
 */

import type { AttributeType, ClassifiedValue } from './types';

// ==================== Word Lists ====================

export const SIZE_WORDS = new Set([
  'small', 'medium', 'large', 'mini', 'petite', 'regular', 'jumbo', 'giant', 'king',
  'xs', 'sm', 'md', 'med', 'lg', 'xl', 'xxl', 'xxxl', '2xl', '3xl', '4xl',
  'x-small', 'x-large', 'xx-large', 'xxx-large',
  's/m', 'm/l', 'l/xl', 'xl/xxl', 'o/s', 'os', 'one size', 'queen', 'q/s',
  '1x', '2x', '3x', '4x', '1x/2x', '3x/4x',
  'jr', 'junior', 'senior',
]);

export const SIZE_UNIT_RE = /\b\d+(\.\d+)?\s*(oz|ounces?|fl\.?\s*oz|ml|milliliters?|l|liters?|g|grams?|mg|lb|lbs|pounds?|inches?|in\.?|"|″|mm|cm|centimeters?|ft|feet|pc|pk|pack|count|ct)\b/i;

export const COLOR_WORDS = new Set([
  'red', 'blue', 'green', 'pink', 'purple', 'black', 'white', 'clear', 'silver', 'gold',
  'bronze', 'copper', 'grey', 'gray', 'brown', 'yellow', 'teal', 'navy', 'nude', 'tan',
  'beige', 'ivory', 'orange', 'wine', 'burgundy', 'charcoal', 'coral', 'fuchsia', 'indigo',
  'magenta', 'maroon', 'olive', 'plum', 'salmon', 'turquoise', 'violet', 'rose', 'flesh',
  'midnight', 'pearl', 'matte', 'neon', 'chrome', 'rainbow',
  'blk', 'wht', 'pnk', 'prp', 'blu', 'grn', 'gld', 'slv', 'brn', 'ylw',
]);

export const FORMULA_WORDS = new Set([
  'silicone', 'water', 'h2o', 'water-based', 'oil', 'hybrid', 'warming', 'cooling',
  'tingling', 'original', 'classic', 'natural', 'organic', 'gel', 'cream', 'foam',
  'liquid', 'spray', 'mousse', 'desensitizing',
]);

export const COLOR_NORMALIZATION_MAP: Record<string, string> = {
  'blk': 'Black', 'blck': 'Black', 'jet black': 'Black', 'midnight black': 'Black', 'onyx': 'Black',
  'wht': 'White', 'off white': 'Off-White', 'ivory': 'Ivory', 'cream': 'Cream', 'pearl': 'Pearl',
  'pnk': 'Pink', 'hot pink': 'Hot Pink', 'light pink': 'Light Pink', 'baby pink': 'Baby Pink',
  'blush': 'Blush', 'rose': 'Rose', 'fuchsia': 'Fuchsia', 'magenta': 'Magenta',
  'prpl': 'Purple', 'violet': 'Violet', 'lavender': 'Lavender', 'plum': 'Plum', 'grape': 'Purple',
  'blu': 'Blue', 'navy': 'Navy', 'navy blue': 'Navy', 'royal blue': 'Royal Blue',
  'light blue': 'Light Blue', 'sky blue': 'Sky Blue', 'teal': 'Teal', 'turquoise': 'Turquoise',
  'aqua': 'Aqua', 'cobalt': 'Cobalt',
  'grn': 'Green', 'lime': 'Lime', 'lime green': 'Lime', 'olive': 'Olive',
  'forest green': 'Forest Green', 'mint': 'Mint', 'mint green': 'Mint', 'emerald': 'Emerald',
  'rd': 'Red', 'crimson': 'Crimson', 'scarlet': 'Scarlet', 'burgundy': 'Burgundy',
  'maroon': 'Maroon', 'wine': 'Wine', 'cherry': 'Cherry',
  'org': 'Orange', 'tangerine': 'Orange', 'peach': 'Peach', 'coral': 'Coral', 'salmon': 'Salmon',
  'ylw': 'Yellow', 'gold': 'Gold', 'golden': 'Gold', 'lemon': 'Yellow', 'mustard': 'Mustard',
  'brn': 'Brown', 'tan': 'Tan', 'beige': 'Beige', 'caramel': 'Caramel',
  'chocolate': 'Chocolate', 'mocha': 'Mocha', 'coffee': 'Coffee', 'bronze': 'Bronze',
  'gry': 'Gray', 'grey': 'Gray', 'silver': 'Silver', 'charcoal': 'Charcoal', 'slate': 'Slate',
  'multi': 'Multi-Color', 'multicolor': 'Multi-Color', 'multi-colored': 'Multi-Color',
  'rainbow': 'Rainbow', 'assorted': 'Assorted',
  'clr': 'Clear', 'transparent': 'Clear', 'see-through': 'Clear',
  'flesh': 'Flesh', 'nude': 'Nude', 'skin': 'Flesh', 'light flesh': 'Light Flesh',
  'dark flesh': 'Dark Flesh', 'vanilla': 'Vanilla', 'caramel flesh': 'Caramel',
  'chocolate flesh': 'Chocolate',
  'rose gold': 'Rose Gold', 'chrome': 'Chrome', 'copper': 'Copper', 'brass': 'Brass',
};

// ==================== Classifiers ====================

/**
 * Classify a single attribute value as size, color, type/formula, or unknown.
 */
export function classifyValue(value: string): ClassifiedValue {
  const lower = value.toLowerCase().trim();

  // Check size patterns first (most specific)
  if (SIZE_WORDS.has(lower)) {
    return { type: 'size', value, normalized: titleCase(lower) };
  }
  if (SIZE_UNIT_RE.test(value)) {
    return { type: 'size', value, normalized: value.trim() };
  }

  // Check color words
  if (COLOR_WORDS.has(lower)) {
    const normalized = COLOR_NORMALIZATION_MAP[lower] || titleCase(lower);
    return { type: 'color', value, normalized };
  }
  // Check multi-word colors
  const colorNorm = COLOR_NORMALIZATION_MAP[lower];
  if (colorNorm) {
    return { type: 'color', value, normalized: colorNorm };
  }

  // Check formula/type words (for lubricants)
  if (FORMULA_WORDS.has(lower)) {
    return { type: 'type', value, normalized: titleCase(lower) };
  }

  // Partial match: value contains a color word
  for (const color of COLOR_WORDS) {
    if (lower.includes(color) && lower.length < color.length + 10) {
      const normalized = COLOR_NORMALIZATION_MAP[lower] || titleCase(lower);
      return { type: 'color', value, normalized };
    }
  }

  // Partial match: value contains a size unit
  if (SIZE_UNIT_RE.test(lower)) {
    return { type: 'size', value, normalized: value.trim() };
  }

  return { type: 'unknown', value, normalized: value.trim() };
}

/**
 * Classify all values for a set of variations sharing an attribute key.
 * Returns the dominant type and classified values.
 */
export function classifyAttrValues(values: string[]): {
  dominantType: AttributeType;
  classified: ClassifiedValue[];
  typeCounts: Record<AttributeType, number>;
} {
  const classified = values.map(classifyValue);
  const typeCounts: Record<AttributeType, number> = {
    size: 0, color: 0, type: 0, variant: 0, unknown: 0,
  };

  for (const c of classified) {
    typeCounts[c.type]++;
  }

  // Pick dominant type (excluding unknown)
  let dominantType: AttributeType = 'unknown';
  let maxCount = 0;
  for (const t of ['size', 'color', 'type'] as AttributeType[]) {
    if (typeCounts[t] > maxCount) {
      maxCount = typeCounts[t];
      dominantType = t;
    }
  }

  // If more than half are unknown, stay unknown
  if (typeCounts.unknown > values.length / 2 && maxCount === 0) {
    dominantType = 'variant';
  }

  return { dominantType, classified, typeCounts };
}

/**
 * Extract a differentiating attribute from a feed product name by comparing
 * to other feed names in the same group.
 */
export function extractDifferentiator(
  feedName: string,
  otherFeedNames: string[]
): { text: string; classified: ClassifiedValue } | null {
  if (!feedName) return null;

  // Find words that differ between this name and others
  const thisWords = feedName.toLowerCase().split(/\s+/);
  const otherWordSets = otherFeedNames.map(n => new Set(n.toLowerCase().split(/\s+/)));

  const uniqueWords: string[] = [];
  for (const word of thisWords) {
    // Word is unique if it doesn't appear in most other names
    const appearsInOthers = otherWordSets.filter(ws => ws.has(word)).length;
    if (appearsInOthers < otherWordSets.length * 0.5) {
      uniqueWords.push(word);
    }
  }

  if (uniqueWords.length === 0) return null;

  const diffText = uniqueWords.join(' ');
  const classified = classifyValue(diffText);

  return { text: diffText, classified };
}

/**
 * Strip the parent product name from an attribute value slug.
 * e.g., "orange-is-the-new-black-whip-it" with parent "Orange Is the New Black"
 *   → "whip-it"
 *
 * Returns null if stripping would leave nothing.
 */
export function stripParentNameFromValue(attrValue: string, parentTitle: string): string | null {
  if (!parentTitle || !attrValue) return null;

  const parentSlug = parentTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const valueSlug = attrValue.toLowerCase().replace(/^-|-$/g, '');

  // Check if the value starts with the parent slug (or a significant prefix)
  if (valueSlug.startsWith(parentSlug + '-')) {
    const remainder = valueSlug.slice(parentSlug.length + 1).trim();
    if (remainder.length > 0) return remainder;
  }

  // Try word-level stripping for non-slug formats
  const parentWords = parentTitle.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const valueWords = attrValue.toLowerCase().replace(/-/g, ' ').split(/\s+/);

  // Find where the parent words end and the differentiator begins
  let matchEnd = 0;
  for (let i = 0; i < valueWords.length && matchEnd < parentWords.length; i++) {
    if (valueWords[i] === parentWords[matchEnd]) {
      matchEnd++;
    }
  }

  // If we matched most of the parent words, strip them
  if (matchEnd >= parentWords.length * 0.7 && matchEnd < valueWords.length) {
    const remainderWords = valueWords.slice(matchEnd);
    const remainder = remainderWords.join('-');
    if (remainder.length > 0) return remainder;
  }

  return null;
}

/**
 * Build a human-readable size string from feed product dimensions.
 * Returns the most meaningful dimension(s) found.
 */
export function buildSizeFromFeed(feed: {
  name?: string;
  size?: string;
  length?: string;
  height?: string;
  diameter?: string;
  weight?: string;
}): string | null {
  // Prefer explicit size field
  if (feed.size && feed.size.trim()) {
    return feed.size.trim();
  }

  // Extract size from product name (e.g., "GUN OIL LUBRICANT H2O 2 OZ" → "2 OZ")
  if (feed.name) {
    const sizeMatch = feed.name.match(SIZE_UNIT_RE);
    if (sizeMatch) {
      return sizeMatch[0].trim();
    }
  }

  // Build from dimensions
  const parts: string[] = [];
  if (feed.length && feed.length.trim() && parseFloat(feed.length) > 0) {
    parts.push(`${feed.length.trim()}" long`);
  }
  if (feed.diameter && feed.diameter.trim() && parseFloat(feed.diameter) > 0) {
    parts.push(`${feed.diameter.trim()}" dia`);
  }
  if (feed.height && feed.height.trim() && parseFloat(feed.height) > 0) {
    parts.push(`${feed.height.trim()}" tall`);
  }

  if (parts.length > 0) return parts.join(', ');

  // Fall back to weight
  if (feed.weight && feed.weight.trim() && parseFloat(feed.weight) > 0) {
    return `${feed.weight.trim()} oz`;
  }

  return null;
}

function titleCase(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}
