/**
 * Utilities for extracting and fetching products embedded in blog content
 */

import { getClient } from '@/lib/apollo/client';
import { gql } from 'graphql-request';
import { getProductionImageUrl } from './image';

// GraphQL query to get a single product by database ID
const GET_PRODUCT_BY_DATABASE_ID = gql`
  query GetProductByDatabaseId($id: ID!) {
    product(id: $id, idType: DATABASE_ID) {
      databaseId
      name
      slug
      sku
      ... on SimpleProduct {
        price
        regularPrice
        salePrice
        stockStatus
      }
      ... on VariableProduct {
        price
        regularPrice
        salePrice
        stockStatus
      }
      image {
        sourceUrl
        altText
      }
    }
  }
`;

// Query for product variations — gets variation data + parent slug for linking
const GET_PRODUCT_VARIATION = gql`
  query GetProductVariation($id: ID!) {
    productVariation(id: $id, idType: DATABASE_ID) {
      databaseId
      name
      sku
      price
      regularPrice
      salePrice
      stockStatus
      image {
        sourceUrl
        altText
      }
      parent {
        node {
          databaseId
          name
          slug
        }
      }
    }
  }
`;

export interface BlogProduct {
  id: number;
  name: string;
  slug: string;
  sku: string | null;
  price: number;
  regularPrice: number;
  salePrice: number | null;
  onSale: boolean;
  image: { url: string; altText: string } | null;
  inStock: boolean;
}

/**
 * Extract product IDs from WooCommerce shortcode HTML in blog content
 * Looks for data-product_id attributes in the raw content
 */
export function extractProductIdsFromContent(content: string): number[] {
  if (!content) return [];

  const ids: number[] = [];

  // Match data-product_id="123" patterns from WooCommerce shortcode output
  const regex = /data-product_id="(\d+)"/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const id = parseInt(match[1], 10);
    if (!isNaN(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/**
 * Parse WooCommerce price string to number
 */
function parsePrice(price: string | null | undefined): number {
  if (!price) return 0;
  const cleaned = price.replace(/[^0-9.]/g, '');
  return parseFloat(cleaned) || 0;
}

/**
 * Fetch products by their database IDs using parallel GraphQL queries
 * Returns a map of productId -> BlogProduct for easy lookup
 */
export async function fetchProductsByIds(ids: number[]): Promise<Map<number, BlogProduct>> {
  const productMap = new Map<number, BlogProduct>();

  if (ids.length === 0) return productMap;

  // Fetch all products in parallel, falling back to variation query
  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const idStr = id.toString();

      // Try as a top-level product first
      try {
        const { data } = await getClient().query({
          query: GET_PRODUCT_BY_DATABASE_ID,
          variables: { id: idStr },
        });
        if (data?.product) {
          return { type: 'product' as const, data: data.product, requestedId: id };
        }
      } catch {
        // Not a top-level product — fall through to variation query
      }

      // Try as a product variation
      try {
        const { data: varData } = await getClient().query({
          query: GET_PRODUCT_VARIATION,
          variables: { id: idStr },
        });
        if (varData?.productVariation) {
          return { type: 'variation' as const, data: varData.productVariation, requestedId: id };
        }
      } catch {
        // Not a variation either
      }

      console.warn(`Product or variation not found for ID ${id}`);
      return null;
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      const { type, data: product, requestedId } = result.value;

      const price = parsePrice(product.salePrice || product.price);
      const regularPrice = parsePrice(product.regularPrice) || price;
      const salePrice = product.salePrice ? parsePrice(product.salePrice) : null;

      // For variations: use the variation's image/price/stock, but the parent's slug for linking
      const slug = type === 'variation'
        ? product.parent?.node?.slug || ''
        : product.slug;
      const name = product.name || product.parent?.node?.name || '';

      const blogProduct: BlogProduct = {
        id: product.databaseId,
        name,
        slug,
        sku: product.sku || null,
        price,
        regularPrice,
        salePrice,
        onSale: salePrice !== null && salePrice < regularPrice,
        image: product.image ? {
          url: getProductionImageUrl(product.image.sourceUrl),
          altText: product.image.altText || name,
        } : null,
        inStock: product.stockStatus === 'IN_STOCK',
      };

      productMap.set(requestedId, blogProduct);
    }
  }

  return productMap;
}

/**
 * Convert product map to a plain object for serialization
 */
export function productMapToObject(map: Map<number, BlogProduct>): Record<string, BlogProduct> {
  const obj: Record<string, BlogProduct> = {};
  map.forEach((value, key) => {
    obj[key.toString()] = value;
  });
  return obj;
}
