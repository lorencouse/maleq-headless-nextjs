import { NextRequest, NextResponse } from 'next/server';

const GRAPHQL_URL = process.env.NEXT_PUBLIC_WORDPRESS_API_URL;

if (!GRAPHQL_URL) {
  console.error('NEXT_PUBLIC_WORDPRESS_API_URL is not configured');
}

// GraphQL query to get product by database ID
const GET_PRODUCT_BY_ID = `
  query GetProductById($id: ID!) {
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

const PRODUCT_RESPONSE_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=3600';
const NOT_FOUND_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';

function formatPrice(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return `$${value.toFixed(2)}`;
}

function jsonWithCache(data: unknown, status = 200, cacheControl = PRODUCT_RESPONSE_CACHE_CONTROL) {
  const response = NextResponse.json(data, { status });
  response.headers.set('Cache-Control', cacheControl);
  return response;
}

function mapIndexEntryToApiProduct(entry: {
  id: number;
  name: string;
  slug: string;
  price: number | null;
  regularPrice: number | null;
  salePrice: number | null;
  onSale: boolean;
  imageUrl: string | null;
  imageAlt: string | null;
  stockStatus: string;
}) {
  return {
    id: entry.id,
    name: entry.name,
    slug: entry.slug,
    sku: null,
    price: formatPrice(entry.salePrice ?? entry.price),
    regularPrice: formatPrice(entry.regularPrice ?? entry.price),
    salePrice: formatPrice(entry.salePrice),
    onSale: entry.onSale,
    image: entry.imageUrl
      ? {
          url: entry.imageUrl,
          altText: entry.imageAlt || entry.name,
        }
      : null,
    stockStatus: entry.stockStatus,
    inStock: entry.stockStatus === 'IN_STOCK',
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID is a number
    const productId = parseInt(id, 10);
    if (isNaN(productId)) {
      return NextResponse.json(
        { error: 'Invalid product ID' },
        { status: 400 }
      );
    }

    let graphQlNotFound = false;

    // Try GraphQL first (WPGraphQL has richer per-product fields).
    if (GRAPHQL_URL) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        const response = await fetch(GRAPHQL_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: GET_PRODUCT_BY_ID,
            variables: { id: productId.toString() },
          }),
          next: { revalidate: 300 },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`GraphQL API error: ${response.status}`);
        }

        const result = await response.json();
        if (result.errors) {
          console.error('GraphQL errors:', result.errors);
          throw new Error('GraphQL query failed');
        }

        const product = result.data?.product;
        if (product) {
          return jsonWithCache({
            id: product.databaseId,
            name: product.name,
            slug: product.slug,
            sku: product.sku,
            price: product.salePrice || product.price,
            regularPrice: product.regularPrice,
            salePrice: product.salePrice,
            onSale: !!(product.salePrice && product.salePrice !== product.regularPrice),
            image: product.image
              ? {
                  url: product.image.sourceUrl,
                  altText: product.image.altText || product.name,
                }
              : null,
            stockStatus: product.stockStatus,
            inStock: product.stockStatus === 'IN_STOCK',
          });
        }

        graphQlNotFound = true;
      } catch (graphQlError) {
        console.error('Error fetching product from GraphQL:', graphQlError);
      }
    }

    // Fallback to in-memory MySQL-backed index when GraphQL is unavailable.
    try {
      const { isMySQLConfigured } = await import('@/lib/db/pool');
      if (isMySQLConfigured() && process.env.DATA_SOURCE !== 'graphql') {
        const { getIndexEntryById } = await import('@/lib/products/product-index');
        const indexEntry = await getIndexEntryById(productId);
        if (indexEntry) {
          return jsonWithCache(mapIndexEntryToApiProduct(indexEntry));
        }
      }
    } catch (indexError) {
      console.error('Error fetching product from index fallback:', indexError);
    }

    if (graphQlNotFound) {
      return jsonWithCache({ error: 'Product not found' }, 404, NOT_FOUND_CACHE_CONTROL);
    }

    return NextResponse.json(
      { error: 'Failed to fetch product' },
      { status: 500 }
    );
  } catch (error) {
    console.error('Error fetching product:', error);
    return NextResponse.json(
      { error: 'Failed to fetch product' },
      { status: 500 }
    );
  }
}
