/**
 * Build-time post data reader.
 * Reads pre-exported post JSON files from .cache/posts/ instead of hitting GraphQL.
 *
 * Used when USE_STATIC_PRODUCTS=true (set during `build:static` script).
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Post } from '@/lib/types/wordpress';

interface PostIndex {
  exportedAt: string;
  count: number;
  slugs: string[];
}

const CACHE_DIR = join(process.cwd(), '.cache', 'posts');
const INDEX_PATH = join(CACHE_DIR, 'index.json');

let indexCache: PostIndex | null = null;

function loadIndex(): PostIndex | null {
  if (indexCache) return indexCache;
  if (!existsSync(INDEX_PATH)) return null;
  try {
    indexCache = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
    return indexCache;
  } catch {
    return null;
  }
}

export function hasStaticPostCache(): boolean {
  return existsSync(INDEX_PATH);
}

export function getAllStaticPostSlugs(): string[] {
  const index = loadIndex();
  if (!index) return [];
  return index.slugs;
}

export function getStaticPost(slug: string): Post | null {
  const filePath = join(CACHE_DIR, 'by-slug', `${slug}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}
