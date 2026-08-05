/**
 * Cart items <-> Stripe PaymentIntent metadata.
 *
 * Stripe metadata values are capped at 500 characters (50 keys per object), so
 * a cart that serializes past 500 chars has to be split across several keys.
 * The previous implementation did `JSON.stringify(items).slice(0, 500)`, which
 * silently produced invalid JSON for larger carts — the webhook recovery path
 * then failed to parse it and fell back to a "items unknown" fee line with the
 * wrong total. Chunking keeps the payload intact and round-trippable.
 *
 * Compact tuple format: [[productId, variationId|null, qty, unitPrice], ...]
 */

export type CompactCartItem = [string, string | null, number, number];

/** Stripe's per-value limit. */
const MAX_VALUE_LENGTH = 500;

/** Chunk 0 keeps the original key name so old PaymentIntents still read back. */
const BASE_KEY = 'checkout_cart_items';

/**
 * Cap on chunks. 6 x 500 = 3000 chars, comfortably more than any real cart,
 * while staying far under Stripe's 50-key limit alongside our other metadata.
 */
const MAX_CHUNKS = 6;

function chunkKey(index: number): string {
  return index === 0 ? BASE_KEY : `${BASE_KEY}_${index}`;
}

/**
 * Serialize cart items into chunked Stripe metadata keys.
 *
 * If the cart is so large it would exceed MAX_CHUNKS, items are dropped from
 * the end until it fits and `truncated` is set — the remaining JSON is always
 * valid, so recovery still reproduces most of the order instead of none of it.
 */
export function buildCartItemsMetadata(items: CompactCartItem[]): {
  metadata: Record<string, string>;
  truncated: boolean;
} {
  let included = items;
  let json = JSON.stringify(included);

  while (json.length > MAX_VALUE_LENGTH * MAX_CHUNKS && included.length > 0) {
    included = included.slice(0, -1);
    json = JSON.stringify(included);
  }

  const metadata: Record<string, string> = {};
  for (let i = 0; i * MAX_VALUE_LENGTH < json.length; i++) {
    metadata[chunkKey(i)] = json.slice(i * MAX_VALUE_LENGTH, (i + 1) * MAX_VALUE_LENGTH);
  }

  // Always emit the base key so readers can distinguish "empty cart" from
  // "metadata was never written".
  if (!metadata[BASE_KEY]) metadata[BASE_KEY] = json;

  return { metadata, truncated: included.length !== items.length };
}

/**
 * Reassemble cart items from PaymentIntent metadata.
 *
 * Handles three shapes:
 *  - chunked values written by `buildCartItemsMetadata`
 *  - a single intact value (carts small enough for one chunk)
 *  - a legacy value truncated mid-JSON by the old `.slice(0, 500)`, which is
 *    repaired by dropping the incomplete trailing tuple
 */
export function readCartItemsFromMetadata(
  metadata: Record<string, string> | null | undefined
): { items: CompactCartItem[]; repaired: boolean } {
  const meta = metadata || {};
  if (!meta[BASE_KEY]) return { items: [], repaired: false };

  let raw = '';
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = meta[chunkKey(i)];
    if (!part) break;
    raw += part;
  }

  const direct = parseCompactCartItems(raw);
  if (direct) return { items: direct, repaired: false };

  // Legacy truncated value: cut back to the last complete `]` tuple and close
  // the array. `[["1",null,2,9.99],["2",nu` -> `[["1",null,2,9.99]]`
  const lastComplete = raw.lastIndexOf(']');
  if (lastComplete > 0) {
    const repaired = parseCompactCartItems(`${raw.slice(0, lastComplete + 1)}]`);
    if (repaired) return { items: repaired, repaired: true };
  }

  return { items: [], repaired: false };
}

function parseCompactCartItems(raw: string): CompactCartItem[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.every(
      (entry) => Array.isArray(entry) && entry.length >= 3 && entry[0] != null
    );
    return valid ? (parsed as CompactCartItem[]) : null;
  } catch {
    return null;
  }
}
