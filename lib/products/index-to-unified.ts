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

function formatPriceRange(min: number | null, max: number | null): string | null {
  if (min === null) return null;
  if (max !== null && max > min) {
    return `$${min.toFixed(2)} - $${max.toFixed(2)}`;
  }
  return `$${min.toFixed(2)}`;
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

  const isVariable = entry.type === 'VARIABLE';
  const displayPrice = isVariable
    ? formatPriceRange(entry.price, entry.maxPrice)
    : formatPrice(entry.price);

  return {
    id: encodeId('post', entry.id),
    databaseId: entry.id,
    name: entry.name,
    slug: entry.slug,
    description: null,
    shortDescription: null,
    sku: null,
    price: displayPrice,
    regularPrice: isVariable ? displayPrice : formatPrice(entry.regularPrice),
    salePrice: isVariable ? null : formatPrice(entry.salePrice),
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
