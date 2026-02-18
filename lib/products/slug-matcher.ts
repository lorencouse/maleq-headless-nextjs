/**
 * Slug Matcher - Finds similar products by comparing URL slugs.
 *
 * Uses the in-memory product index for slug lookups (instant, no I/O).
 * Uses segment-aware Levenshtein scoring to find closest matches.
 */

import { levenshteinDistance, isFuzzyMatch } from '@/lib/utils/search-helpers';
import { getProductionImageUrl } from '@/lib/utils/image';

interface SlugMatch {
  name: string;
  slug: string;
  image: string | null;
  score: number;
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
 * Uses the in-memory product index for instant slug + metadata lookups.
 */
export async function findSimilarProducts(
  failedSlug: string,
  limit: number = 3
): Promise<SlugMatch[]> {
  const { getAllIndexEntries } = await import('./product-index');
  const allEntries = await getAllIndexEntries();
  if (allEntries.length === 0) return [];

  // Score all slugs (lightweight — just string comparisons)
  const scored: Array<{ slug: string; score: number }> = [];

  for (const entry of allEntries) {
    const score = computeSlugSimilarity(failedSlug, entry.slug);
    if (score > 0.3) {
      scored.push({ slug: entry.slug, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topSlugs = scored.slice(0, limit);

  const { getIndexEntryBySlug } = await import('./product-index');

  return Promise.all(topSlugs.map(async (match) => {
    const entry = await getIndexEntryBySlug(match.slug);
    return {
      name: entry?.name || match.slug.replace(/-/g, ' '),
      slug: match.slug,
      image: entry?.imageUrl
        ? getProductionImageUrl(entry.imageUrl)
        : null,
      score: match.score,
    };
  }));
}
