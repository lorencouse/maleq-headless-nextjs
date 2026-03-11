/**
 * Description Dimension Parser
 *
 * Extracts physical product dimensions (weight, length, width, height, etc.)
 * from product description HTML text. Used as a third-tier fallback when
 * neither DB meta nor feed data has the values.
 *
 * Patterns handled:
 *   - "length 7.5 inches" / "total length: 7.5 inches"
 *   - "7.5 inches long" / "7.5" long"
 *   - "width 1.5 inches" / "diameter 1.5 inches"
 *   - "weight 6.6 oz" / "weighs 4 ounces"
 *   - "insertable length 5 inches"
 *   - "8 inches by 2 inches" (length x width)
 *   - Table rows like "<td>7.5 inches</td>"
 */

export interface ParsedDimensions {
  weight: string;
  length: string;
  width: string;
  height: string;
  insertableLength: string;
  innerDiameter: string;
}

const EMPTY_DIMS: ParsedDimensions = {
  weight: '',
  length: '',
  width: '',
  height: '',
  insertableLength: '',
  innerDiameter: '',
};

/**
 * Parse dimensions from HTML description text.
 * Returns only numeric values (in inches/oz) — no units stored,
 * matching WooCommerce's convention.
 */
export function parseDimensionsFromDescription(html: string): ParsedDimensions {
  if (!html) return { ...EMPTY_DIMS };

  // Strip HTML tags but keep whitespace structure
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|li|td|th|tr|div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const result: ParsedDimensions = { ...EMPTY_DIMS };

  // ─── Weight ───
  // "weight 6.6 oz" / "weight: 6.6 ounces" / "weighs 4 oz" / "weight of 4.2 oz"
  const weightMatch = text.match(
    /weigh[ts]?\s*(?:of\s+)?[:.]?\s*(?:about\s+|approximately?\s*)?(\d+\.?\d*)\s*(oz|ounces?|lbs?|pounds?|grams?|g\b)/i
  );
  if (weightMatch) {
    result.weight = normalizeWeight(weightMatch[1], weightMatch[2]);
  }

  // ─── Insertable Length (check first, before general length) ───
  // "insertable length 5 inches" / "insertion length: 5 inches"
  const insertableMatch = text.match(
    /insert(?:able|ion)\s+length\s*[:.]?\s*(?:approximately?\s*)?(\d+\.?\d*)\s*(?:inch|in\b|"|inches)/i
  );
  if (insertableMatch) {
    result.insertableLength = insertableMatch[1];
  }

  // "insertion length of about 3.75 inches" (reversed pattern)
  if (!result.insertableLength) {
    const insertableRevMatch = text.match(
      /insert(?:able|ion)\s+length\s+(?:of\s+)?(?:about\s+|approximately?\s*)?(\d+\.?\d*)\s*(?:inch|in\b|"|inches)/i
    );
    if (insertableRevMatch) {
      result.insertableLength = insertableRevMatch[1];
    }
  }

  // ─── Total/Overall/Full Length ───
  // "total length 7.5 inches" / "overall length: 8 inches" / "full length 8.5 inches"
  const totalLengthMatch = text.match(
    /(?:total|overall|full)\s+length\s*[:.]?\s*(?:approximately?\s*)?(\d+\.?\d*)\s*(?:inch|in\b|"|inches)/i
  );
  if (totalLengthMatch) {
    result.length = totalLengthMatch[1];
  }

  // "4.5 inches in total length" / "8 inches in length" (reversed pattern)
  if (!result.length) {
    const reversedLengthMatch = text.match(
      /(\d+\.?\d*)\s*(?:inch|inches|")\s+(?:in\s+)?(?:total\s+)?length/i
    );
    if (reversedLengthMatch) {
      result.length = reversedLengthMatch[1];
    }
  }

  // "length 7.5 inches" (generic, only if total length not found)
  if (!result.length) {
    const lengthMatch = text.match(
      /(?:^|[,;.\s])length\s*[:.]?\s*(?:approximately?\s*)?(\d+\.?\d*)\s*(?:inch|in\b|"|inches)/i
    );
    if (lengthMatch) {
      result.length = lengthMatch[1];
    }
  }

  // "length of 7.5 inches" / "length of about 4 inches" (reversed with "of")
  if (!result.length) {
    const lengthOfMatch = text.match(
      /length\s+(?:of\s+)?(?:about\s+|approximately?\s*)?(\d+\.?\d*)\s*(?:inch|in\b|"|inches)/i
    );
    if (lengthOfMatch) {
      result.length = lengthOfMatch[1];
    }
  }

  // "7.5 inches long"
  if (!result.length) {
    const longMatch = text.match(/(\d+\.?\d*)\s*(?:inch|inches|"|in\.?)\s+long\b/i);
    if (longMatch) {
      result.length = longMatch[1];
    }
  }

  // ─── Width / Diameter ───
  // "width 1.5 inches" / "diameter 1.5 inches"
  const widthMatch = text.match(
    /(?:width|wide)\s*[:.]?\s*(?:approximately?\s*)?(\d+\.?\d*)\s*(?:inch|in\b|"|inches)/i
  );
  if (widthMatch) {
    result.width = widthMatch[1];
  }

  if (!result.width) {
    const diamMatch = text.match(
      /diameter\s*[:.]?\s*(?:approximately?\s*)?(\d+\.?\d*)\s*(?:inch|in\b|"|inches)/i
    );
    if (diamMatch) {
      result.width = diamMatch[1];
    }
  }

  // "width of 1.25 inches"
  if (!result.width) {
    const widthOfMatch = text.match(
      /width\s+(?:of\s+)?(?:about\s+|approximately?\s*)?(\d+\.?\d*)\s*(?:inch|in\b|"|inches)/i
    );
    if (widthOfMatch) {
      result.width = widthOfMatch[1];
    }
  }

  // "1.5 inches wide"
  if (!result.width) {
    const wideMatch = text.match(/(\d+\.?\d*)\s*(?:inch|inches|"|in\.?)\s+wide\b/i);
    if (wideMatch) {
      result.width = wideMatch[1];
    }
  }

  // ─── Height ───
  // "height 3 inches"
  const heightMatch = text.match(
    /height\s*[:.]?\s*(?:approximately?\s*)?(\d+\.?\d*)\s*(?:inch|in\b|"|inches)/i
  );
  if (heightMatch) {
    result.height = heightMatch[1];
  }

  // "3 inches tall"
  if (!result.height) {
    const tallMatch = text.match(/(\d+\.?\d*)\s*(?:inch|inches|"|in\.?)\s+tall\b/i);
    if (tallMatch) {
      result.height = tallMatch[1];
    }
  }

  // ─── "X inches by Y inches" pattern (length x width) ───
  if (!result.length || !result.width) {
    const byMatch = text.match(
      /(\d+\.?\d*)\s*(?:inch|inches|"|in\.?)\s+by\s+(\d+\.?\d*)\s*(?:inch|inches|"|in\.?)/i
    );
    if (byMatch) {
      if (!result.length) result.length = byMatch[1];
      if (!result.width) result.width = byMatch[2];
    }
  }

  // ─── Inner Diameter ───
  const innerDiamMatch = text.match(
    /inner\s+diameter\s*[:.]?\s*(?:approximately?\s*)?(\d+\.?\d*)\s*(?:inch|in\b|"|inches)/i
  );
  if (innerDiamMatch) {
    result.innerDiameter = innerDiamMatch[1];
  }

  return result;
}

/** Normalize weight to a standard unit (lbs for WooCommerce default) */
function normalizeWeight(value: string, unit: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return '';

  const u = unit.toLowerCase();
  // WooCommerce typically stores weight in the shop's configured unit.
  // Most US shops use lbs or oz. We'll store the raw number as-is
  // since the unit depends on WooCommerce settings.
  // Return the value with the most common unit conversion:
  // If oz/ounces → return as-is (WooCommerce weight unit is usually lbs or oz)
  if (u.startsWith('oz') || u.startsWith('ounce')) {
    return value;
  }
  if (u.startsWith('lb') || u.startsWith('pound')) {
    return value;
  }
  if (u.startsWith('gram') || u === 'g') {
    // Convert grams to oz (1 oz = 28.3495g)
    return (num / 28.3495).toFixed(1);
  }
  return value;
}
