/**
 * Shared utility for finding the default variation.
 * Safe to import from both server and client components (no DB/server deps).
 */

/**
 * Find the default variation for a variable product.
 * Priority: default attributes (if in stock) → first in-stock → default attributes (even if OOS)
 */
export function findDefaultVariation<
  T extends { stockStatus: string; attributes: { name: string; value: string }[] },
>(
  variations: T[],
  defaultAttributes?: { name: string; value: string }[],
): T | undefined {
  if (!variations.length) return undefined;

  const isInStock = (v: T) =>
    v.stockStatus === 'IN_STOCK' || v.stockStatus === 'LOW_STOCK';

  // Find the variation matching default attributes
  let defaultVariation: T | undefined;
  if (defaultAttributes && defaultAttributes.length > 0) {
    defaultVariation = variations.find((v) =>
      defaultAttributes.every((da) =>
        v.attributes.some(
          (a) =>
            a.name.toLowerCase() === da.name.toLowerCase() &&
            a.value.toLowerCase() === da.value.toLowerCase(),
        ),
      ),
    );
  }

  // 1. Default variation if in stock
  if (defaultVariation && isInStock(defaultVariation)) return defaultVariation;

  // 2. First in-stock variation
  const firstInStock = variations.find(isInStock);
  if (firstInStock) return firstInStock;

  // 3. Default variation even if OOS
  if (defaultVariation) return defaultVariation;

  // 4. Absolute fallback: first variation
  return variations[0];
}
