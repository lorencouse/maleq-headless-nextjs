import { cache } from 'react';
import { getClient } from '@/lib/apollo/client';
import { GET_PRODUCT_BY_SLUG, GET_ALL_PRODUCT_SLUGS } from '@/lib/queries/products';
import type { UnifiedProduct } from './combined-service';
import type {
  GraphQLProduct,
  GraphQLImage,
  GraphQLCategory,
  GraphQLTag,
  GraphQLBrand,
  GraphQLAttribute,
  GraphQLVariation,
  GraphQLVariationAttribute,
} from '@/lib/types/woocommerce';
import { extractSpecifications, type ProductSpecification } from './specifications';
import { getProductionImageUrl } from '@/lib/utils/image';

export type { ProductSpecification, ProductSpecificationLink } from './specifications';

export interface ProductVariation {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  stockStatus: string;
  stockQuantity: number | null;
  weight: string | null;
  length: string | null;
  width: string | null;
  height: string | null;
  attributes: Array<{
    name: string;
    value: string;
  }>;
  image?: {
    url: string;
    altText: string;
  } | null;
}

// Re-export for server-side callers
export { findDefaultVariation } from './variation-utils';

export interface ProductBrand {
  id: string;
  name: string;
  slug: string;
}

export interface ProductDimensions {
  weight: string | null;
  length: string | null;
  width: string | null;
  height: string | null;
}

export interface EnhancedProduct extends UnifiedProduct {
  specifications: ProductSpecification[];
  gallery: Array<{
    id: string;
    url: string;
    altText: string;
    isPrimary: boolean;
  }>;
  brands: ProductBrand[];
  dimensions: ProductDimensions;
  featured: boolean;
  purchaseNote: string | null;
  externalUrl?: string | null;
  buttonText?: string | null;
  defaultAttributes?: { name: string; value: string }[];
  videoUrl?: string | null;
}


/**
 * Get product by slug from WooCommerce (cached per request).
 * React cache() deduplicates calls within the same server render,
 * so generateMetadata and the page component share a single fetch.
 *
 * Priority: direct MySQL → GraphQL
 */
export const getProductBySlug = cache(async function getProductBySlug(slug: string): Promise<EnhancedProduct | null> {
  // Try direct MySQL (much faster than GraphQL, no PHP overhead)
  try {
    const { isMySQLConfigured } = await import('@/lib/db/pool');
    if (isMySQLConfigured() && process.env.DATA_SOURCE !== 'graphql') {
      const { getProductBySlugFromDB } = await import('@/lib/db/product-queries');
      const dbProduct = await getProductBySlugFromDB(slug);
      if (dbProduct) return dbProduct;
      // Fall through to GraphQL if not found (unlikely but safe)
    }
  } catch (err) {
    console.error('[product-service] MySQL fetch failed for', slug, err);
    // Fall through to GraphQL
  }

  try {
    const { REVALIDATE } = await import('@/lib/apollo/client');
    const { data } = await getClient().query({
      query: GET_PRODUCT_BY_SLUG,
      variables: { slug },
      revalidate: REVALIDATE.NONE,
    });

    const product = data?.product as GraphQLProduct | null;
    if (!product) return null;

    const isVariable = product.type === 'VARIABLE';

    // Extract taxonomy nodes for specifications + later use
    const brandNodes = product.productBrands?.nodes;
    const categoryNodes = product.productCategories?.nodes;
    const tagNodes = product.productTags?.nodes;
    const attributeNodes = product.attributes?.nodes;

    const specifications = extractSpecifications({
      sku: product.sku,
      weight: product.weight,
      length: product.length,
      width: product.width,
      height: product.height,
      stockStatus: product.stockStatus,
      stockQuantity: product.stockQuantity,
      brands: brandNodes?.map((b: GraphQLBrand) => ({ name: b.name, slug: b.slug })),
      categories: categoryNodes?.map((c: GraphQLCategory) => ({ name: c.name, slug: c.slug })),
      tags: tagNodes?.map((t: GraphQLTag) => ({ name: t.name })),
      attributes: attributeNodes?.map((a: GraphQLAttribute) => ({
        name: a.name,
        options: a.options || [],
        visible: a.visible ?? true,
        variation: a.variation,
      })),
    }, isVariable);

    const brands: ProductBrand[] = brandNodes
      ? brandNodes.map((brand: GraphQLBrand) => ({
          id: brand.id,
          name: brand.name,
          slug: brand.slug,
        }))
      : [];

    const dimensions: ProductDimensions = {
      weight: product.weight || null,
      length: product.length || null,
      width: product.width || null,
      height: product.height || null,
    };

    const galleryNodes = product.galleryImages?.nodes;
    const galleryImages = galleryNodes
      ? galleryNodes.map((img: GraphQLImage) => ({
          url: getProductionImageUrl(img.sourceUrl),
          altText: img.altText || product.name,
        }))
      : undefined;

    const categories = categoryNodes
      ? categoryNodes.map((cat: GraphQLCategory) => ({
          id: cat.id,
          name: cat.name,
          slug: cat.slug,
        }))
      : [];

    const tags = tagNodes
      ? tagNodes.map((tag: GraphQLTag) => ({
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
        }))
      : undefined;

    const attributes = attributeNodes
      ? attributeNodes.map((attr: GraphQLAttribute) => ({
          name: attr.name,
          options: attr.options || [],
          visible: attr.visible ?? true,
        }))
      : undefined;

    // Extract variations
    const variationNodes = product.variations?.nodes;
    const variations = variationNodes
      ? variationNodes.map((v: GraphQLVariation) => {
          const varAttrNodes = v.attributes?.nodes;
          return {
            id: v.id,
            databaseId: v.databaseId,
            name: v.name,
            sku: v.sku || null,
            description: v.description || null,
            price: v.price || null,
            regularPrice: v.regularPrice || null,
            salePrice: v.salePrice || null,
            stockStatus: v.stockStatus || 'OUT_OF_STOCK',
            stockQuantity: v.stockQuantity || null,
            weight: v.weight || null,
            length: v.length || null,
            width: v.width || null,
            height: v.height || null,
            attributes: varAttrNodes
              ? varAttrNodes.map((a: GraphQLVariationAttribute) => ({
                  name: a.name,
                  value: a.value,
                }))
              : [],
            image: v.image ? {
              url: getProductionImageUrl(v.image.sourceUrl),
              altText: v.image.altText || v.name,
            } : null,
          };
        })
      : undefined;

    // Extract default attributes for variable products
    const defaultAttributeNodes = product.defaultAttributes?.nodes;
    const defaultAttributes = defaultAttributeNodes && defaultAttributeNodes.length > 0
      ? defaultAttributeNodes.map((a: { name: string; value: string }) => ({
          name: a.name,
          value: a.value,
        }))
      : undefined;

    // Build gallery array
    const gallery = [
      // Primary image first
      ...(product.image ? [{
        id: product.image.id || '0',
        url: getProductionImageUrl(product.image.sourceUrl),
        altText: product.image.altText || product.name,
        isPrimary: true,
      }] : []),
      // Gallery images
      ...(galleryNodes
        ? galleryNodes.map((img: GraphQLImage, index: number) => ({
            id: img.id || String(index + 1),
            url: getProductionImageUrl(img.sourceUrl),
            altText: img.altText || product.name,
            isPrimary: false,
          }))
        : []),
    ];

    const enhancedProduct: EnhancedProduct = {
      id: product.id,
      databaseId: product.databaseId,
      name: product.name,
      slug: product.slug,
      description: product.description || null,
      shortDescription: product.shortDescription || null,
      sku: product.sku || null,
      price: product.price || null,
      regularPrice: product.regularPrice || null,
      salePrice: product.salePrice || null,
      onSale: product.onSale || false,
      stockStatus: product.stockStatus || 'OUT_OF_STOCK',
      stockQuantity: product.stockQuantity || null,
      image: product.image ? {
        url: getProductionImageUrl(product.image.sourceUrl),
        altText: product.image.altText || product.name,
      } : null,
      galleryImages,
      categories,
      tags,
      type: product.type || 'SIMPLE',
      averageRating: product.averageRating,
      reviewCount: product.reviewCount,
      attributes,
      variations,
      specifications,
      gallery,
      brands,
      dimensions,
      featured: product.featured || false,
      purchaseNote: product.purchaseNote || null,
      externalUrl: product.externalUrl || null,
      buttonText: product.buttonText || null,
      defaultAttributes,
    };

    return enhancedProduct;
  } catch (error) {
    console.error('Error fetching product by slug:', error);
    return null;
  }
});

/**
 * Get all product slugs for static generation (paginated).
 * Prefers the in-memory product index (SQL), falls back to GraphQL.
 */
export async function getAllProductSlugs(): Promise<string[]> {
  // Use the in-memory product index (SQL-backed, always available at runtime)
  try {
    const { getAllIndexEntries } = await import('./product-index');
    const entries = await getAllIndexEntries();
    if (entries.length > 0) {
      return entries.map(e => e.slug);
    }
  } catch (err) {
    console.error('[product-service] Product index unavailable for slugs:', err);
  }

  // Fallback: GraphQL pagination
  const allSlugs: string[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: { data: Record<string, any> } = await getClient().query({
        query: GET_ALL_PRODUCT_SLUGS,
        variables: { first: 500, after },
        });

      const nodes: { slug: string }[] = result.data?.products?.nodes || [];
      allSlugs.push(...nodes.map((p) => p.slug));

      hasNextPage = result.data?.products?.pageInfo?.hasNextPage ?? false;
      after = result.data?.products?.pageInfo?.endCursor ?? null;
    } catch (error) {
      console.error('Error fetching product slugs:', error);
      break;
    }
  }

  return allSlugs;
}
