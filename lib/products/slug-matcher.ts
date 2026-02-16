/**
 * Slug Matcher - Finds similar products by comparing URL slugs.
 *
 * Reads product slugs from the static JSON cache (.cache/products/index.json)
 * instead of hitting GraphQL. Falls back to GraphQL only when the cache is
 * unavailable. Uses segment-aware Levenshtein scoring to find closest matches.
 */

import { levenshteinDistance, isFuzzyMatch } from '@/lib/utils/search-helpers';
import { getProductionImageUrl } from '@/lib/utils/image';

interface SlugMatch {
  name: string;
  slug: string;
  image: string | null;
  score: number;
}

// Module-level cache
let slugCache: string[] | null = null;
let slugCacheTimestamp = 0;
const SLUG_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Load all product slugs from static cache, falling back to GraphQL.
 */
async function loadAllSlugs(): Promise<string[]> {
  try {
    const { getAllStaticSlugs, hasStaticCache } = await import('./static-product-service');
    if (hasStaticCache()) {
      const slugs = getAllStaticSlugs();
      console.log(`[SlugMatcher] Loaded ${slugs.length} product slugs from static cache`);
      return slugs;
    }
  } catch {
    // Static cache not available
  }

  // Fallback: load from GraphQL (expensive, avoid if possible)
  console.log('[SlugMatcher] Static cache unavailable, falling back to GraphQL');
  const { getClient, REVALIDATE } = await import('@/lib/apollo/client');
  const { GET_PRODUCT_SLUG_SUMMARIES } = await import('@/lib/queries/products');

  interface SlugSummariesResponse {
    products: {
      nodes: Array<{ slug: string }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }

  const slugs: string[] = [];
  let afterCursor: string | null = null;
  let hasNextPage = true;
  let pageCount = 0;
  const MAX_PAGES = 50;

  while (hasNextPage && pageCount < MAX_PAGES) {
    try {
      const result: { data: SlugSummariesResponse } = await getClient().query({
        query: GET_PRODUCT_SLUG_SUMMARIES,
        variables: { first: 500, after: afterCursor },
        revalidate: REVALIDATE.STATIC,
      });

      const nodes = result.data?.products?.nodes || [];
      slugs.push(...nodes.map((n) => n.slug));

      hasNextPage = result.data?.products?.pageInfo?.hasNextPage ?? false;
      afterCursor = result.data?.products?.pageInfo?.endCursor ?? null;
      pageCount++;
    } catch (error) {
      console.error('[SlugMatcher] GraphQL fallback failed:', error);
      break;
    }
  }

  console.log(`[SlugMatcher] Loaded ${slugs.length} product slugs from GraphQL`);
  return slugs;
}

async function getSlugCache(): Promise<string[]> {
  const now = Date.now();

  if (slugCache && (now - slugCacheTimestamp) < SLUG_CACHE_TTL) {
    return slugCache;
  }

  const result = await loadAllSlugs();
  slugCache = result;
  slugCacheTimestamp = Date.now();
  return result;
}

/**
 * Compute similarity between two slugs using segment-aware scoring.
 *
 * Score = segment_score * 0.7 + char_score * 0.3
 *
 * Segment scoring: exact match = 1.0, fuzzy match = 0.7
 * Character scoring: normalized Levenshtein similarity
 */
export function computeSlugSimilarity(slug1: string, slug2: string): number {
  const segs1 = slug1.toLowerCase().split('-');
  const segs2 = slug2.toLowerCase().split('-');

  // Segment-level scoring: compare each segment in slug1 against slug2
  let segmentMatchScore = 0;
  const usedIndices = new Set<number>();

  for (const seg of segs1) {
    let bestScore = 0;
    let bestIdx = -1;

    for (let j = 0; j < segs2.length; j++) {
      if (usedIndices.has(j)) continue;

      if (seg === segs2[j]) {
        if (1.0 > bestScore) {
          bestScore = 1.0;
          bestIdx = j;
        }
      } else if (isFuzzyMatch(seg, segs2[j])) {
        if (0.7 > bestScore) {
          bestScore = 0.7;
          bestIdx = j;
        }
      }
    }

    if (bestIdx >= 0) {
      usedIndices.add(bestIdx);
      segmentMatchScore += bestScore;
    }
  }

  const maxSegments = Math.max(segs1.length, segs2.length);
  const normalizedSegmentScore = maxSegments > 0 ? segmentMatchScore / maxSegments : 0;

  // Character-level Levenshtein similarity
  const distance = levenshteinDistance(slug1, slug2);
  const maxLen = Math.max(slug1.length, slug2.length);
  const charSimilarity = maxLen > 0 ? 1 - distance / maxLen : 0;

  // Combined score
  return normalizedSegmentScore * 0.7 + charSimilarity * 0.3;
}

/**
 * Find products with slugs most similar to the given failed slug.
 * Scores all slugs from the index, then reads full product data only
 * for the top matches (avoids loading all 35K products into memory).
 */
export async function findSimilarProducts(
  failedSlug: string,
  limit: number = 3
): Promise<SlugMatch[]> {
  const allSlugs = await getSlugCache();
  if (allSlugs.length === 0) return [];

  // Score all slugs (lightweight — just string comparisons)
  const scored: Array<{ slug: string; score: number }> = [];

  for (const slug of allSlugs) {
    const score = computeSlugSimilarity(failedSlug, slug);
    if (score > 0.3) {
      scored.push({ slug, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topSlugs = scored.slice(0, limit);

  // Load name + image only for top matches from static cache
  const { getStaticProduct } = await import('./static-product-service');

  return topSlugs.map((match) => {
    const product = getStaticProduct(match.slug);
    return {
      name: product?.name || match.slug.replace(/-/g, ' '),
      slug: match.slug,
      image: product?.image?.url
        ? getProductionImageUrl(product.image.url)
        : null,
      score: match.score,
    };
  });
}
