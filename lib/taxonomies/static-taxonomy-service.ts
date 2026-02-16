/**
 * Build-time taxonomy data reader.
 * Reads pre-exported taxonomy JSON files from .cache/taxonomies/ and .cache/search/
 * instead of hitting GraphQL.
 *
 * Returns null if cache file doesn't exist — callers fall through to GraphQL.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { ProductCategory } from '@/lib/types/woocommerce';
import type { HierarchicalCategory, FilterOption, Brand } from '@/lib/products/combined-service';
import type { BlogCategory } from '@/lib/blog/blog-service';

const TAXONOMY_DIR = join(process.cwd(), '.cache', 'taxonomies');
const SEARCH_DIR = join(process.cwd(), '.cache', 'search');

// In-memory cache to avoid re-reading files
const cache = new Map<string, unknown>();

function readCacheFile<T>(filePath: string): T | null {
  const cached = cache.get(filePath);
  if (cached !== undefined) return cached as T;
  if (!existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as T;
    cache.set(filePath, data);
    return data;
  } catch {
    return null;
  }
}

export function getStaticProductCategories(): ProductCategory[] | null {
  return readCacheFile<ProductCategory[]>(join(TAXONOMY_DIR, 'product-categories.json'));
}

export function getStaticHierarchicalCategories(): HierarchicalCategory[] | null {
  return readCacheFile<HierarchicalCategory[]>(join(TAXONOMY_DIR, 'hierarchical-categories.json'));
}

export function getStaticBrands(): FilterOption[] | null {
  return readCacheFile<FilterOption[]>(join(TAXONOMY_DIR, 'brands.json'));
}

export function getStaticBrandBySlug(slug: string): Brand | null {
  const brands = readCacheFile<Brand[]>(join(TAXONOMY_DIR, 'brands.json'));
  if (!brands) return null;
  return brands.find((b) => b.slug === slug) ?? null;
}

export function getStaticMaterials(): FilterOption[] | null {
  return readCacheFile<FilterOption[]>(join(TAXONOMY_DIR, 'materials.json'));
}

export function getStaticColors(): FilterOption[] | null {
  return readCacheFile<FilterOption[]>(join(TAXONOMY_DIR, 'colors.json'));
}

export function getStaticBlogCategories(): BlogCategory[] | null {
  return readCacheFile<BlogCategory[]>(join(TAXONOMY_DIR, 'blog-categories.json'));
}

export function getStaticBlogTags(): { id: string; name: string; slug: string; count: number }[] | null {
  return readCacheFile<{ id: string; name: string; slug: string; count: number }[]>(
    join(TAXONOMY_DIR, 'blog-tags.json')
  );
}

export interface SearchVocabulary {
  exportedAt: string;
  productNames: string[];
  brandNames: string[];
  categoryNames: string[];
}

export function getStaticSearchVocabulary(): SearchVocabulary | null {
  return readCacheFile<SearchVocabulary>(join(SEARCH_DIR, 'vocabulary.json'));
}
