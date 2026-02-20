/**
 * Category Rules — implements VARIANT-RULES.md Section 4.
 *
 * Category-aware attribute selection: lubricants get size/type,
 * everything else gets size/color.
 */

import type { VariationRecord, AttributeType } from './types';
import { classifyAttrValues } from './classification';

const LUBRICANT_CATEGORY_SLUGS = new Set([
  'lubricants', 'water-based', 'silicone-based',
  'anal-lubes-lotions-sprays-creams', 'flavored', 'massage-lotions-creams',
]);

/**
 * Check if a product is in the lubricants category tree.
 */
export function isLubricantCategory(categorySlugs: string[]): boolean {
  return categorySlugs.some(slug => LUBRICANT_CATEGORY_SLUGS.has(slug));
}

/**
 * Get allowed variation attribute types for a product based on its category.
 *
 * Per VARIANT-RULES.md Section 4:
 * - Lubricants: size or type
 * - All others: size or color
 */
export function getAllowedAttributes(isLubricant: boolean): AttributeType[] {
  return isLubricant ? ['size', 'type'] : ['size', 'color'];
}

/**
 * Map an attribute type to a WooCommerce taxonomy name.
 */
export function attrTypeToTaxonomy(type: AttributeType): string {
  switch (type) {
    case 'size': return 'pa_size';
    case 'color': return 'pa_color';
    case 'type': return 'pa_type';
    default: return 'pa_variant';
  }
}

/**
 * Map a WooCommerce taxonomy to an attribute type.
 */
export function taxonomyToAttrType(taxonomy: string): AttributeType {
  switch (taxonomy) {
    case 'pa_size': return 'size';
    case 'pa_color': return 'color';
    case 'pa_type': return 'type';
    default: return 'variant';
  }
}

/**
 * Determine which single attribute to use for a variable product's variations.
 *
 * Implements the fallback logic from VARIANT-RULES.md Section 4:
 *
 * For lubricants:
 * 1. SKU grouping first
 * 2. Multiple different sizes → size is variation
 * 3. Same size → type is variation
 *
 * For non-lubricants:
 * 1. SKU grouping first
 * 2. Multiple colors AND sizes → color is variation
 * 3. No color variation → size is variation
 */
export function chooseVariationAttribute(
  variations: VariationRecord[],
  isLubricant: boolean
): { taxonomy: string; attrType: AttributeType; reason: string } {
  // Collect all attribute values across variations
  const attrValuesByKey = new Map<string, string[]>();
  for (const v of variations) {
    for (const [key, value] of v.attrs) {
      if (!key.startsWith('attribute_pa_')) continue;
      if (!attrValuesByKey.has(key)) attrValuesByKey.set(key, []);
      attrValuesByKey.get(key)!.push(value);
    }
  }

  // If only one attribute key exists, use it (but maybe reclassify)
  if (attrValuesByKey.size === 1) {
    const [key, values] = [...attrValuesByKey.entries()][0];
    const taxonomy = key.replace('attribute_', '');
    const currentType = taxonomyToAttrType(taxonomy);
    const allowed = getAllowedAttributes(isLubricant);

    if (allowed.includes(currentType)) {
      return { taxonomy, attrType: currentType, reason: 'single attribute, already correct' };
    }

    // Reclassify: check what the values actually are
    const { dominantType } = classifyAttrValues(values);
    if (allowed.includes(dominantType)) {
      return {
        taxonomy: attrTypeToTaxonomy(dominantType),
        attrType: dominantType,
        reason: `reclassify ${taxonomy} → ${attrTypeToTaxonomy(dominantType)} (values are ${dominantType})`,
      };
    }

    // Default: keep as-is even if "wrong" (variant is acceptable as fallback)
    return { taxonomy, attrType: currentType, reason: 'single attribute, keeping as-is' };
  }

  // Multiple attributes — need to pick one
  // Classify all values per key
  const keyClassifications = new Map<string, { type: AttributeType; uniqueValues: number }>();
  for (const [key, values] of attrValuesByKey) {
    const { dominantType } = classifyAttrValues(values);
    const uniqueValues = new Set(values).size;
    keyClassifications.set(key, { type: dominantType, uniqueValues });
  }

  const allowed = getAllowedAttributes(isLubricant);

  if (isLubricant) {
    return chooseLubricantAttribute(keyClassifications, allowed);
  } else {
    return chooseNonLubricantAttribute(keyClassifications, allowed);
  }
}

function chooseLubricantAttribute(
  keyClassifications: Map<string, { type: AttributeType; uniqueValues: number }>,
  allowed: AttributeType[]
): { taxonomy: string; attrType: AttributeType; reason: string } {
  // Find size and type dimensions
  let sizeKey: string | null = null;
  let typeKey: string | null = null;
  let sizeUnique = 0;
  let typeUnique = 0;

  for (const [key, info] of keyClassifications) {
    if (info.type === 'size') { sizeKey = key; sizeUnique = info.uniqueValues; }
    if (info.type === 'type') { typeKey = key; typeUnique = info.uniqueValues; }
  }

  // Multiple different sizes → size is the variation attribute
  if (sizeKey && sizeUnique > 1) {
    return {
      taxonomy: attrTypeToTaxonomy('size'),
      attrType: 'size',
      reason: `lubricant with ${sizeUnique} sizes → size is variation`,
    };
  }

  // Same size or no size → type is the variation
  if (typeKey && typeUnique > 1) {
    return {
      taxonomy: attrTypeToTaxonomy('type'),
      attrType: 'type',
      reason: `lubricant with ${typeUnique} types → type is variation`,
    };
  }

  // Fallback: pick whichever has more unique values
  let best = { key: '', type: 'variant' as AttributeType, unique: 0 };
  for (const [key, info] of keyClassifications) {
    if (info.uniqueValues > best.unique) {
      best = { key, type: info.type, unique: info.uniqueValues };
    }
  }

  const taxonomy = allowed.includes(best.type) ? attrTypeToTaxonomy(best.type) : 'pa_variant';
  return {
    taxonomy,
    attrType: best.type,
    reason: `lubricant fallback: most unique values (${best.unique}) in ${best.key}`,
  };
}

function chooseNonLubricantAttribute(
  keyClassifications: Map<string, { type: AttributeType; uniqueValues: number }>,
  allowed: AttributeType[]
): { taxonomy: string; attrType: AttributeType; reason: string } {
  let colorKey: string | null = null;
  let sizeKey: string | null = null;
  let colorUnique = 0;
  let sizeUnique = 0;

  for (const [key, info] of keyClassifications) {
    if (info.type === 'color') { colorKey = key; colorUnique = info.uniqueValues; }
    if (info.type === 'size') { sizeKey = key; sizeUnique = info.uniqueValues; }
  }

  // Multiple colors AND sizes → color is variation (per VARIANT-RULES.md)
  if (colorKey && sizeKey && colorUnique > 1 && sizeUnique > 1) {
    return {
      taxonomy: attrTypeToTaxonomy('color'),
      attrType: 'color',
      reason: `${colorUnique} colors + ${sizeUnique} sizes → color is variation (split by size)`,
    };
  }

  // Only colors → color is variation
  if (colorKey && colorUnique > 1) {
    return {
      taxonomy: attrTypeToTaxonomy('color'),
      attrType: 'color',
      reason: `${colorUnique} colors, no meaningful size variation → color is variation`,
    };
  }

  // Only sizes → size is variation
  if (sizeKey && sizeUnique > 1) {
    return {
      taxonomy: attrTypeToTaxonomy('size'),
      attrType: 'size',
      reason: `${sizeUnique} sizes, no color variation → size is variation`,
    };
  }

  // Fallback: pick whichever has more unique values
  let best = { key: '', type: 'variant' as AttributeType, unique: 0 };
  for (const [key, info] of keyClassifications) {
    if (info.uniqueValues > best.unique) {
      best = { key, type: info.type, unique: info.uniqueValues };
    }
  }

  const taxonomy = allowed.includes(best.type) ? attrTypeToTaxonomy(best.type) : 'pa_variant';
  return {
    taxonomy,
    attrType: best.type,
    reason: `fallback: most unique values (${best.unique}) in ${best.key}`,
  };
}
