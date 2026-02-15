/**
 * Slug Matcher - Finds similar products by comparing URL slugs.
 *
 * Caches all product slugs (lightweight: slug + name + image) and uses
 * segment-aware Levenshtein scoring to find the closest matches.
 */

import { getClient, REVALIDATE } from '@/lib/apollo/client';
import { GET_PRODUCT_SLUG_SUMMARIES } from '@/lib/queries/products';
import { levenshteinDistance, isFuzzyMatch } from '@/lib/utils/search-helpers';
import { getProductionImageUrl } from '@/lib/utils/image';

interface SlugSummary {
  slug: string;
  name: string;
  image: { sourceUrl: string } | null;
}

interface SlugMatch {
  name: string;
  slug: string;
  image: string | null;
  score: number;
}

// Module-level cache (same pattern as lib/search/search-index.ts)
let slugCache: SlugSummary[] | null = null;
let slugCacheTimestamp = 0;
let slugCacheLoading: Promise<SlugSummary[]> | null = null;
const SLUG_CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface SlugSummariesResponse {
  products: {
    nodes: SlugSummary[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

async function loadAllSlugs(): Promise<SlugSummary[]> {
  const slugs: SlugSummary[] = [];
  let afterCursor: string | null = null;
  let hasNextPage = true;
  let pageCount = 0;
  const MAX_PAGES = 50; // Safety limit (~25K products)

  while (hasNextPage && pageCount < MAX_PAGES) {
    const result: { data: SlugSummariesResponse } = await getClient().query({
      query: GET_PRODUCT_SLUG_SUMMARIES,
      variables: { first: 500, after: afterCursor },
      revalidate: REVALIDATE.STATIC,
    });

    const nodes = result.data?.products?.nodes || [];
    slugs.push(...nodes);

    hasNextPage = result.data?.products?.pageInfo?.hasNextPage ?? false;
    afterCursor = result.data?.products?.pageInfo?.endCursor ?? null;
    pageCount++;
  }

  console.log(`[SlugMatcher] Loaded ${slugs.length} product slugs`);
  return slugs;
}

async function getSlugCache(): Promise<SlugSummary[]> {
  const now = Date.now();

  if (slugCache && (now - slugCacheTimestamp) < SLUG_CACHE_TTL) {
    return slugCache;
  }

  if (slugCacheLoading) return slugCacheLoading;

  slugCacheLoading = (async () => {
    try {
      const result = await loadAllSlugs();
      slugCache = result;
      slugCacheTimestamp = Date.now();
      slugCacheLoading = null;
      return result;
    } catch (error) {
      console.error('[SlugMatcher] Failed to load slugs:', error);
      slugCacheLoading = null;
      return slugCache || [];
    }
  })();

  return slugCacheLoading;
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
 */
export async function findSimilarProducts(
  failedSlug: string,
  limit: number = 3
): Promise<SlugMatch[]> {
  const allSlugs = await getSlugCache();
  if (allSlugs.length === 0) return [];

  const scored: SlugMatch[] = [];

  for (const product of allSlugs) {
    const score = computeSlugSimilarity(failedSlug, product.slug);
    if (score > 0.3) {
      scored.push({
        name: product.name,
        slug: product.slug,
        image: product.image?.sourceUrl
          ? getProductionImageUrl(product.image.sourceUrl)
          : null,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
