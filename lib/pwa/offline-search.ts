/**
 * Offline Product Search
 *
 * Builds a MiniSearch index from products stored in IndexedDB
 * and provides search functionality when the user is offline.
 */

import MiniSearch from 'minisearch';
import { getAllOfflineProducts, type OfflineProduct } from './offline-products';

interface OfflineSearchResult {
  slug: string;
  name: string;
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  shortDescription: string | null;
  image: { url: string; altText: string } | null;
  brand: string | null;
  categories: string[];
  score: number;
}

let cachedIndex: MiniSearch<OfflineProduct> | null = null;
let cachedProducts: OfflineProduct[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000; // Rebuild index if products are older than 1 minute

async function getIndex(): Promise<{ index: MiniSearch<OfflineProduct>; products: OfflineProduct[] }> {
  const now = Date.now();

  if (cachedIndex && cachedProducts && now - cacheTimestamp < CACHE_TTL) {
    return { index: cachedIndex, products: cachedProducts };
  }

  const products = await getAllOfflineProducts();

  const index = new MiniSearch<OfflineProduct>({
    fields: ['name', 'brand', 'shortDescription', 'categoriesText'],
    storeFields: ['slug'],
    idField: 'slug',
    searchOptions: {
      fuzzy: 0.2,
      prefix: true,
      boost: { name: 3, brand: 2, categoriesText: 1, shortDescription: 1 },
    },
  });

  // MiniSearch needs categoriesText as a flat string
  const indexable = products.map((p) => ({
    ...p,
    categoriesText: p.categories.join(' '),
  }));

  index.addAll(indexable);
  cachedIndex = index;
  cachedProducts = products;
  cacheTimestamp = now;

  return { index, products };
}

/**
 * Search offline products using MiniSearch.
 * Returns results sorted by relevance score.
 */
export async function searchOfflineProducts(
  query: string,
  limit = 20
): Promise<OfflineSearchResult[]> {
  if (!query || query.length < 2) return [];

  try {
    const { index, products } = await getIndex();
    const results = index.search(query);
    const productMap = new Map(products.map((p) => [p.slug, p]));

    return results.slice(0, limit).reduce<OfflineSearchResult[]>((acc, result) => {
      const product = productMap.get(result.id as string);
      if (!product) return acc;
      acc.push({
        slug: product.slug,
        name: product.name,
        price: product.price,
        regularPrice: product.regularPrice,
        salePrice: product.salePrice,
        shortDescription: product.shortDescription,
        image: product.image,
        brand: product.brand,
        categories: product.categories,
        score: result.score,
      });
      return acc;
    }, []);
  } catch {
    return [];
  }
}

/**
 * Get all unique categories from offline products.
 * Returns categories sorted by product count (descending).
 */
export async function getOfflineCategories(): Promise<{ name: string; count: number }[]> {
  try {
    const products = await getAllOfflineProducts();
    const counts = new Map<string, number>();

    for (const product of products) {
      for (const cat of product.categories) {
        counts.set(cat, (counts.get(cat) || 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

/**
 * Get offline products filtered by category.
 */
export async function getOfflineProductsByCategory(
  categoryName: string
): Promise<OfflineProduct[]> {
  try {
    const products = await getAllOfflineProducts();
    return products.filter((p) =>
      p.categories.some((c) => c.toLowerCase() === categoryName.toLowerCase())
    );
  } catch {
    return [];
  }
}
