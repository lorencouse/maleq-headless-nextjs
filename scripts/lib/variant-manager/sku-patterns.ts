/**
 * SKU Prefix Extraction — implements VARIANT-RULES.md Section 3.
 *
 * Pattern A: Last 3 chars contain a letter → split at last letter boundary.
 * Pattern B: Last 3 chars are all digits → last digit = variant, 2nd-to-last = sibling.
 */

import type { ParsedSku, SkuPattern } from './types';

/**
 * Parse a Williams Trading warehouse SKU into its structural components.
 *
 * Per VARIANT-RULES.md:
 * - Pattern A (last 3 contain letter): parent = up to & including last letter, variant = trailing digits
 *   SNSL32 → parent SNSL, variant 32
 * - Pattern B (last 3 all digits): last digit = variant, 2nd-to-last = sibling, rest = family
 *   NSN096111 → family NSN0961, sibling 1, variant 1
 */
export function parseWtSku(sku: string): ParsedSku {
  if (!sku || sku.length < 2) {
    return { parentSku: sku, variantId: '', pattern: 'none' };
  }

  const last3 = sku.slice(-3);
  const last3AllDigits = last3.length >= 3 && /^\d{3}$/.test(last3);

  if (!last3AllDigits) {
    // Pattern A: last 3 contain a letter → split at last letter
    return parsePatternA(sku);
  } else {
    // Pattern B: last 3 all digits
    return parsePatternB(sku);
  }
}

function parsePatternA(sku: string): ParsedSku {
  // Find the position of the last letter in the SKU
  let lastLetterIdx = -1;
  for (let i = sku.length - 1; i >= 0; i--) {
    if (/[a-zA-Z]/.test(sku[i])) {
      lastLetterIdx = i;
      break;
    }
  }

  if (lastLetterIdx === -1) {
    // No letters at all — shouldn't happen for Pattern A, fall back
    return { parentSku: sku, variantId: '', pattern: 'none' };
  }

  // Parent = everything up to and including the last letter
  const parentSku = sku.substring(0, lastLetterIdx + 1);
  // Variant = trailing digits after the last letter
  const variantId = sku.substring(lastLetterIdx + 1);

  return { parentSku, variantId, pattern: 'A' };
}

function parsePatternB(sku: string): ParsedSku {
  if (sku.length < 3) {
    return { parentSku: sku, variantId: '', pattern: 'none' };
  }

  // Last digit = variant ID
  const variantId = sku[sku.length - 1];
  // 2nd-to-last digit = sibling group
  const siblingGroup = sku[sku.length - 2];
  // Everything before that = family
  const family = sku.substring(0, sku.length - 2);
  // Parent SKU = family + sibling (for grouping within a sibling group)
  const parentSku = family + siblingGroup;

  return { parentSku, variantId, siblingGroup, family, pattern: 'B' };
}

/**
 * Extract a grouping prefix from a warehouse SKU.
 * Variations sharing the same prefix belong to the same product line.
 *
 * This is a higher-level function that uses parseWtSku internally
 * and returns just the parent prefix for grouping purposes.
 */
export function extractSkuPrefix(sku: string): string {
  if (!sku || sku.length < 2) return sku;

  const parsed = parseWtSku(sku);
  return parsed.parentSku;
}

/**
 * Given a set of variations with warehouse SKUs, group them by SKU parent prefix.
 * Returns null if no meaningful grouping is found (all same prefix or not enough SKUs).
 */
export function groupBySkuPrefix<T extends { warehouseSku: string }>(
  variations: T[],
  minGroupSize: number = 2,
  minSkuCoverage: number = 0.6
): Map<string, T[]> | null {
  const withSku = variations.filter(v => v.warehouseSku);

  if (withSku.length < variations.length * minSkuCoverage) return null;
  if (withSku.length < 3) return null;

  const groups = new Map<string, T[]>();
  for (const v of withSku) {
    const prefix = extractSkuPrefix(v.warehouseSku);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(v);
  }

  // Only keep groups with enough members
  const validGroups = new Map<string, T[]>();
  const singletons: T[] = [];

  for (const [prefix, members] of groups) {
    if (members.length >= minGroupSize) {
      validGroups.set(prefix, members);
    } else {
      singletons.push(...members);
    }
  }

  // Re-group singletons with progressively shorter prefixes
  if (singletons.length >= 2) {
    const singletonPrefixes = singletons.map(v => extractSkuPrefix(v.warehouseSku));
    const maxLen = Math.max(...singletonPrefixes.map(p => p.length));

    let bestLen = -1;
    let bestClusterVars = 0;
    let bestSingletonCount = singletons.length;

    for (let tryLen = maxLen - 1; tryLen >= 2; tryLen--) {
      const shortGroups = new Map<string, number>();
      for (let i = 0; i < singletons.length; i++) {
        const shortPrefix = singletonPrefixes[i].substring(0, tryLen);
        shortGroups.set(shortPrefix, (shortGroups.get(shortPrefix) || 0) + 1);
      }

      let clusterVars = 0;
      let singletonCount = 0;
      for (const cnt of shortGroups.values()) {
        if (cnt >= 2) clusterVars += cnt;
        else singletonCount += cnt;
      }

      if (clusterVars > bestClusterVars ||
          (clusterVars === bestClusterVars && singletonCount < bestSingletonCount)) {
        bestClusterVars = clusterVars;
        bestSingletonCount = singletonCount;
        bestLen = tryLen;
      }
    }

    if (bestLen > 0 && bestClusterVars >= 2) {
      const shortGroups = new Map<string, T[]>();
      for (let i = 0; i < singletons.length; i++) {
        const shortPrefix = singletonPrefixes[i].substring(0, bestLen);
        if (!shortGroups.has(shortPrefix)) shortGroups.set(shortPrefix, []);
        shortGroups.get(shortPrefix)!.push(singletons[i]);
      }

      const remainingSingletons: T[] = [];
      for (const [shortPrefix, members] of shortGroups) {
        if (members.length >= minGroupSize) {
          validGroups.set(`${shortPrefix}~`, members);
        } else {
          remainingSingletons.push(...members);
        }
      }
      singletons.length = 0;
      singletons.push(...remainingSingletons);
    }
  }

  // Absorb remaining singletons into the largest group
  if (singletons.length > 0 && validGroups.size > 0) {
    let largestKey = '';
    let largestSize = 0;
    for (const [key, members] of validGroups) {
      if (members.length > largestSize) {
        largestSize = members.length;
        largestKey = key;
      }
    }
    if (largestKey) {
      validGroups.get(largestKey)!.push(...singletons);
    }
  }

  // Handle variations without SKUs — assign to largest group
  const withoutSku = variations.filter(v => !v.warehouseSku);
  if (withoutSku.length > 0 && validGroups.size > 0) {
    let largestKey = '';
    let largestSize = 0;
    for (const [key, members] of validGroups) {
      if (members.length > largestSize) {
        largestSize = members.length;
        largestKey = key;
      }
    }
    if (largestKey) {
      validGroups.get(largestKey)!.push(...withoutSku);
    }
  }

  if (validGroups.size <= 1) return null;
  return validGroups;
}

/**
 * Adaptive sub-splitting: for SKU groups with mixed prices (multiple price tiers),
 * try longer prefixes to produce uniform-price sub-groups.
 */
export function adaptiveSkuSubSplit<T extends { warehouseSku: string; regularPrice: number }>(
  groups: Map<string, T[]>
): void {
  const toReplace = new Map<string, Map<string, T[]>>();

  for (const [prefix, members] of groups) {
    const priceGroups = new Map<number, number>();
    for (const v of members) {
      if (v.regularPrice > 0) {
        priceGroups.set(v.regularPrice, (priceGroups.get(v.regularPrice) || 0) + 1);
      }
    }
    const multiItemTiers = [...priceGroups.values()].filter(c => c >= 2).length;
    if (multiItemTiers < 2) continue;

    const originalPrefix = prefix.replace(/~$/, '');
    let bestSubGroups: Map<string, T[]> | null = null;
    let bestScore = 0;

    for (let extraChars = 1; extraChars <= 3; extraChars++) {
      const tryLen = originalPrefix.length + extraChars;
      const subGroups = new Map<string, T[]>();

      for (const v of members) {
        const subPrefix = v.warehouseSku.substring(0, Math.min(tryLen, v.warehouseSku.length));
        if (!subGroups.has(subPrefix)) subGroups.set(subPrefix, []);
        subGroups.get(subPrefix)!.push(v);
      }

      let uniformCount = 0;
      let totalInUniform = 0;
      for (const subMembers of subGroups.values()) {
        if (subMembers.length < 2) continue;
        const prices = new Set(subMembers.filter(v => v.regularPrice > 0).map(v => v.regularPrice));
        if (prices.size === 1) {
          uniformCount++;
          totalInUniform += subMembers.length;
        }
      }

      if (uniformCount >= 2 && totalInUniform > bestScore) {
        bestScore = totalInUniform;
        bestSubGroups = subGroups;
      }
    }

    if (bestSubGroups && bestSubGroups.size >= 2) {
      toReplace.set(prefix, bestSubGroups);
    }
  }

  for (const [oldPrefix, subGroups] of toReplace) {
    groups.delete(oldPrefix);
    for (const [newPrefix, members] of subGroups) {
      if (members.length >= 2) {
        groups.set(newPrefix, members);
      } else {
        // Absorb singletons into largest group
        let largest = '';
        let largestSize = 0;
        for (const [k, v] of groups) {
          if (v.length > largestSize) { largestSize = v.length; largest = k; }
        }
        if (largest) groups.get(largest)!.push(...members);
      }
    }
  }
}
