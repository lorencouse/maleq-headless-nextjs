/**
 * Maps ProductIndexEntry → UnifiedProduct for frontend consumption.
 *
 * The index contains only the lightweight fields needed for listing/filtering.
 * Fields like description, shortDescription, sku, variations are not available
 * in the index and are set to null (only needed on detail pages).
 */
import type { ProductIndexEntry } from '@/lib/db/index-loader';
import type { UnifiedProduct } from './combined-service';

function formatPrice(value: number | string | null): string | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return null;
  return `$${num.toFixed(2)}`;
}

function encodeId(prefix: string, id: number): string {
  return Buffer.from(`${prefix}:${id}`).toString('base64');
}

export function indexEntryToUnifiedProduct(entry: ProductIndexEntry): UnifiedProduct {
  const categories = entry.categorySlugs.map((slug, i) => ({
    id: slug,
    name: entry.categoryNames[i] || slug,
    slug,
  }));

  const brands = entry.brandSlug && entry.brandName
    ? [{ id: entry.brandSlug, name: entry.brandName, slug: entry.brandSlug }]
    : [];

  const materials = entry.materialSlug && entry.materialName
    ? [{ id: entry.materialSlug, name: entry.materialName, slug: entry.materialSlug }]
    : undefined;

  return {
    id: encodeId('post', entry.id),
    databaseId: entry.id,
    name: entry.name,
    slug: entry.slug,
    description: null,
    shortDescription: null,
    sku: null,
    price: formatPrice(entry.price),
    regularPrice: formatPrice(entry.regularPrice),
    salePrice: entry.onSale ? formatPrice(entry.salePrice) : null,
    onSale: entry.onSale,
    stockStatus: entry.stockStatus,
    stockQuantity: null,
    image: entry.imageUrl
      ? { url: entry.imageUrl, altText: entry.imageAlt || entry.name }
      : null,
    categories,
    brands,
    materials,
    type: entry.type,
    averageRating: entry.averageRating,
    reviewCount: entry.reviewCount,
    viewCount: entry.viewCount,
    popularityScore: entry.popularityScore,
  };
}

export function indexEntriesToUnifiedProducts(entries: ProductIndexEntry[]): UnifiedProduct[] {
  return entries.map(indexEntryToUnifiedProduct);
}
