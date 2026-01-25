/**
 * Utilities for extracting and fetching products embedded in blog content
 */

import { getClient } from '@/lib/apollo/client';
import { gql } from '@apollo/client';
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

  // Fetch all products in parallel
  const results = await Promise.allSettled(
    ids.map(async (id) => {
      try {
        const { data } = await getClient().query({
          query: GET_PRODUCT_BY_DATABASE_ID,
          variables: { id: id.toString() },
          fetchPolicy: 'no-cache',
        });
        return data?.product;
      } catch (error) {
        console.error(`Error fetching product ${id}:`, error);
        return null;
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      const product = result.value;
      const price = parsePrice(product.salePrice || product.price);
      const regularPrice = parsePrice(product.regularPrice) || price;
      const salePrice = product.salePrice ? parsePrice(product.salePrice) : null;

      productMap.set(product.databaseId, {
        id: product.databaseId,
        name: product.name,
        slug: product.slug,
        sku: product.sku || null,
        price,
        regularPrice,
        salePrice,
        onSale: salePrice !== null && salePrice < regularPrice,
        image: product.image ? {
          url: getProductionImageUrl(product.image.sourceUrl),
          altText: product.image.altText || product.name,
        } : null,
        inStock: product.stockStatus === 'IN_STOCK',
      });
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
