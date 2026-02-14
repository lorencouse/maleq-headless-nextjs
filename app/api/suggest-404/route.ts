import { NextRequest, NextResponse } from 'next/server';
import { searchProducts } from '@/lib/products/combined-service';
import {
  getHierarchicalCategories,
  getBrands,
} from '@/lib/products/combined-service';
import type { HierarchicalCategory, FilterOption } from '@/lib/products/combined-service';
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
 * Extract search keywords from a URL slug
 */
function extractKeywords(slug: string): string {
  const tokens = tokenizeQuery(slug.replace(/-/g, ' '));
  return tokens.slice(0, 5).join(' ');
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

async function getProductSuggestions(keywords: string): Promise<Suggestion[]> {
  if (!keywords) return [];

  const result = await searchProducts(keywords, { limit: 3 });
  return result.products.slice(0, 3).map((p) => ({
    name: p.name,
    url: `/product/${p.slug}`,
    type: 'product' as const,
    image: p.image?.url ? getProductionImageUrl(p.image.url) : null,
  }));
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
      case 'product':
        suggestions = await getProductSuggestions(keywords);
        break;
      case 'category':
        suggestions = await getCategorySuggestions(slug);
        break;
      case 'blog':
        suggestions = await getBlogSuggestions(keywords);
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
      suggestions = await getProductSuggestions(keywords);
    }

    return NextResponse.json({ suggestions: suggestions.slice(0, 3) });
  } catch (error) {
    console.error('Error generating 404 suggestions:', error);
    return NextResponse.json({ suggestions: [] });
  }
}
