import { NextRequest, NextResponse } from 'next/server';
import { searchProducts } from '@/lib/products/combined-service';
import {
  getHierarchicalCategories,
  getBrands,
} from '@/lib/products/combined-service';
import type { HierarchicalCategory, FilterOption } from '@/lib/products/combined-service';
import { getProductBySlug } from '@/lib/products/product-service';
import { findSimilarProducts, computeSlugSimilarity } from '@/lib/products/slug-matcher';
import { getBlogSearchSuggestions, getBlogCategories } from '@/lib/blog/blog-service';
import { tokenizeQuery, isFuzzyMatch } from '@/lib/utils/search-helpers';
import { getProductionImageUrl } from '@/lib/utils/image';

interface Suggestion {
  name: string;
  url: string;
  type: 'product' | 'category' | 'blog' | 'brand' | 'blog-category';
  image?: string | null;
}

type ContentType = 'product' | 'category' | 'blog' | 'brand' | 'blog-category';

/**
 * Detect the content type from the failed URL path
 */
function detectContentType(path: string): { type: ContentType; slug: string } {
  const segments = path.replace(/^\/|\/$/g, '').split('/');

  if (segments[0] === 'product' && segments[1]) {
    return { type: 'product', slug: segments[1] };
  }
  if (segments[0] === 'sex-toys' && segments[1]) {
    // Could be /sex-toys/parent/child — use the last segment
    return { type: 'category', slug: segments[segments.length - 1] };
  }
  if (segments[0] === 'brand' && segments[1]) {
    return { type: 'brand', slug: segments[1] };
  }
  if (segments[0] === 'guides' && segments[1] === 'category' && segments[2]) {
    return { type: 'blog-category', slug: segments[2] };
  }
  if (segments[0] === 'guides' && segments[1]) {
    return { type: 'blog', slug: segments[1] };
  }

  // Default: treat the last segment as a product slug
  const slug = segments[segments.length - 1] || '';
  return { type: 'product', slug };
}

/**
 * Extract search keywords from a URL slug.
 * Returns all meaningful tokens (no arbitrary limit).
 */
function extractKeywords(slug: string): string[] {
  return tokenizeQuery(slug.replace(/-/g, ' '));
}

/**
 * Pick the best primary search term from keywords.
 * Prefers the longest token (>= 3 chars) as it's most distinctive.
 */
function pickPrimarySearchTerm(keywords: string[]): string {
  const meaningful = keywords.filter((k) => k.length >= 3);
  if (meaningful.length === 0) return keywords.join(' ');

  // Sort by length descending, pick longest as primary
  const sorted = [...meaningful].sort((a, b) => b.length - a.length);
  return sorted[0];
}

/**
 * Flatten hierarchical categories into a flat list for matching
 */
function flattenCategories(cats: HierarchicalCategory[]): HierarchicalCategory[] {
  const flat: HierarchicalCategory[] = [];
  for (const cat of cats) {
    flat.push(cat);
    if (cat.children.length > 0) {
      flat.push(...flattenCategories(cat.children));
    }
  }
  return flat;
}

/**
 * Find best matching items from a list using fuzzy matching on name/slug
 */
function fuzzyMatchItems<T extends { name: string; slug: string }>(
  items: T[],
  keywords: string[],
  limit: number
): T[] {
  if (keywords.length === 0) return items.slice(0, limit);

  const scored = items.map((item) => {
    let score = 0;
    const nameLower = item.name.toLowerCase();
    const slugLower = item.slug.toLowerCase();

    for (const keyword of keywords) {
      if (nameLower.includes(keyword)) score += 10;
      else if (slugLower.includes(keyword)) score += 8;
      else {
        // Check fuzzy match against each word in the name
        const nameWords = nameLower.split(/\s+/);
        for (const word of nameWords) {
          if (isFuzzyMatch(word, keyword)) {
            score += 5;
            break;
          }
        }
        // Check fuzzy match against slug segments
        const slugParts = slugLower.split('-');
        for (const part of slugParts) {
          if (isFuzzyMatch(part, keyword)) {
            score += 4;
            break;
          }
        }
      }
    }
    return { item, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}

/**
 * Try to find products by progressively shorter slug prefixes.
 * Handles cases like "wd-jock-8in-w-balls-vanilla-test" → finds "wd-jock-8in-w-balls-vanilla"
 */
async function getSlugPrefixMatches(slug: string): Promise<Suggestion[]> {
  const segments = slug.split('-');
  if (segments.length < 2) return [];

  // Try removing 1, 2, then 3 segments from the end
  const maxRemove = Math.min(3, segments.length - 2);
  for (let remove = 1; remove <= maxRemove; remove++) {
    const candidateSlug = segments.slice(0, segments.length - remove).join('-');
    if (candidateSlug.length < 3) continue;

    try {
      const product = await getProductBySlug(candidateSlug);
      if (product) {
        return [{
          name: product.name,
          url: `/product/${product.slug}`,
          type: 'product' as const,
          image: product.image?.url
            ? getProductionImageUrl(product.image.url)
            : null,
        }];
      }
    } catch {
      // Slug not found, try next shorter prefix
    }
  }

  return [];
}

async function getProductSuggestions(
  keywords: string[],
  failedSlug?: string,
  limit: number = 3
): Promise<Suggestion[]> {
  if (keywords.length === 0) return [];

  // Try primary (longest) term first, then fall back to all keywords joined
  const primary = pickPrimarySearchTerm(keywords);
  let result = await searchProducts(primary, { limit: 10 });

  // If primary term gets no results, try joining all keywords
  if (result.products.length === 0 && keywords.length > 1) {
    result = await searchProducts(keywords.join(' '), { limit: 10 });
  }

  let suggestions = result.products.map((p) => ({
    name: p.name,
    url: `/product/${p.slug}`,
    type: 'product' as const,
    image: p.image?.url ? getProductionImageUrl(p.image.url) : null,
    slug: p.slug,
  }));

  // Re-rank by slug similarity if we have the failed slug
  if (failedSlug && suggestions.length > 1) {
    suggestions.sort((a, b) => {
      const scoreA = computeSlugSimilarity(failedSlug, a.slug);
      const scoreB = computeSlugSimilarity(failedSlug, b.slug);
      return scoreB - scoreA;
    });
  }

  return suggestions.slice(0, limit).map(({ slug: _s, ...rest }) => rest);
}

async function getCategorySuggestions(slug: string): Promise<Suggestion[]> {
  const keywords = tokenizeQuery(slug.replace(/-/g, ' '));
  const categories = await getHierarchicalCategories();
  const flat = flattenCategories(categories);
  const matches = fuzzyMatchItems(flat, keywords, 3);

  return matches.map((cat) => ({
    name: cat.name,
    url: `/sex-toys/${cat.slug}`,
    type: 'category' as const,
    image: cat.image || null,
  }));
}

async function getBlogSuggestions(keywords: string): Promise<Suggestion[]> {
  if (!keywords) return [];

  const result = await getBlogSearchSuggestions(keywords, 3);
  return result.posts.slice(0, 3).map((p) => ({
    name: p.title,
    url: `/guides/${p.slug}`,
    type: 'blog' as const,
    image: p.image ? getProductionImageUrl(p.image) : null,
  }));
}

async function getBrandSuggestions(slug: string): Promise<Suggestion[]> {
  const keywords = tokenizeQuery(slug.replace(/-/g, ' '));
  const brands = await getBrands();
  const matches = fuzzyMatchItems(brands as (FilterOption & { name: string; slug: string })[], keywords, 3);

  return matches.map((b) => ({
    name: b.name,
    url: `/brand/${b.slug}`,
    type: 'brand' as const,
    image: null,
  }));
}

async function getBlogCategorySuggestions(slug: string): Promise<Suggestion[]> {
  const keywords = tokenizeQuery(slug.replace(/-/g, ' '));
  const categories = await getBlogCategories();
  const matches = fuzzyMatchItems(categories, keywords, 3);

  return matches.map((cat) => ({
    name: cat.name,
    url: `/guides/category/${cat.slug}`,
    type: 'blog-category' as const,
    image: null,
  }));
}

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path');

  if (!path) {
    return NextResponse.json({ suggestions: [] });
  }

  try {
    const { type, slug } = detectContentType(path);
    const keywords = extractKeywords(slug);
    let suggestions: Suggestion[] = [];

    switch (type) {
      case 'product': {
        const seenUrls = new Set<string>();
        const allMatches: Suggestion[] = [];

        const addUnique = (items: Suggestion[]) => {
          for (const item of items) {
            if (!seenUrls.has(item.url)) {
              seenUrls.add(item.url);
              allMatches.push(item);
            }
          }
        };

        // Layer 1: Slug prefix matching (extra segments appended to real slug)
        const prefixMatches = await getSlugPrefixMatches(slug);
        addUnique(prefixMatches);

        // Layer 2: Slug similarity matching (typos, missing segments)
        if (allMatches.length < 3) {
          const similarProducts = await findSimilarProducts(slug, 3);
          addUnique(
            similarProducts.map((p) => ({
              name: p.name,
              url: `/product/${p.slug}`,
              type: 'product' as const,
              image: p.image,
            }))
          );
        }

        // Layer 3: Keyword search fallback (improved)
        if (allMatches.length < 3) {
          const keywordResults = await getProductSuggestions(keywords, slug, 3);
          addUnique(keywordResults);
        }

        suggestions = allMatches.slice(0, 3);
        break;
      }
      case 'category':
        suggestions = await getCategorySuggestions(slug);
        break;
      case 'blog':
        suggestions = await getBlogSuggestions(keywords.join(' '));
        break;
      case 'brand':
        suggestions = await getBrandSuggestions(slug);
        break;
      case 'blog-category':
        suggestions = await getBlogCategorySuggestions(slug);
        break;
    }

    // If no suggestions found for the specific type, fall back to products
    if (suggestions.length === 0 && type !== 'product') {
      suggestions = await getProductSuggestions(keywords, slug);
    }

    return NextResponse.json({ suggestions: suggestions.slice(0, 3) });
  } catch (error) {
    console.error('Error generating 404 suggestions:', error);
    return NextResponse.json({ suggestions: [] });
  }
}
