/**
 * Build-time product data reader.
 * Reads pre-exported product JSON files from .cache/products/ instead of hitting GraphQL.
 *
 * Used when USE_STATIC_PRODUCTS=true (set during `build:static` script).
 * Falls back gracefully if cache doesn't exist.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { EnhancedProduct } from './product-service';

interface ProductIndex {
  exportedAt: string;
  count: number;
  slugs: string[];
}

const CACHE_DIR = join(process.cwd(), '.cache', 'products');
const INDEX_PATH = join(CACHE_DIR, 'index.json');

let indexCache: ProductIndex | null = null;

function loadIndex(): ProductIndex | null {
  if (indexCache) return indexCache;
  if (!existsSync(INDEX_PATH)) return null;
  try {
    indexCache = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
    return indexCache;
  } catch {
    return null;
  }
}

export function hasStaticCache(): boolean {
  return existsSync(INDEX_PATH);
}

export function getAllStaticSlugs(): string[] {
  const index = loadIndex();
  if (!index) return [];
  return index.slugs;
}

export function getStaticProduct(slug: string): EnhancedProduct | null {
  const filePath = join(CACHE_DIR, 'by-slug', `${slug}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}
