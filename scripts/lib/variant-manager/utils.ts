/**
 * Utility functions shared across variant manager modules.
 */

export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 200);
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the longest common prefix among a set of strings.
 */
export function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  if (strings.length === 1) return strings[0];

  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.substring(0, prefix.length - 1);
      if (prefix === '') return '';
    }
  }
  return prefix;
}

/**
 * Given a base slug, ensure it's unique by appending -2, -3, etc.
 * Checks against an existing set of used slugs.
 */
export function ensureUniqueSlug(baseSlug: string, usedSlugs: Set<string>): string {
  let slug = baseSlug;
  let counter = 2;
  while (usedSlugs.has(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  usedSlugs.add(slug);
  return slug;
}

/**
 * Build a human-readable label from a SKU prefix and feed data.
 * Tries to extract the product name from the first variation in the group.
 */
export function labelFromFeedNames(feedNames: string[]): string {
  if (feedNames.length === 0) return 'Unknown';
  // Find the longest common prefix of all feed names
  const lcp = longestCommonPrefix(feedNames.map(n => n.trim()));
  // Clean up trailing junk (spaces, hyphens, commas)
  const cleaned = lcp.replace(/[\s,\-]+$/, '').trim();
  return cleaned || feedNames[0].trim();
}

/**
 * Chunk an array into batches.
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Safely join IDs for SQL IN clause (prevents empty IN).
 */
export function sqlInList(ids: number[]): string {
  if (ids.length === 0) return '(-1)';
  return `(${ids.join(',')})`;
}
