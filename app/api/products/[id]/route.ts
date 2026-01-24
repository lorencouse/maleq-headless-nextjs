import { NextRequest, NextResponse } from 'next/server';

const GRAPHQL_URL = process.env.NEXT_PUBLIC_WORDPRESS_API_URL || 'http://maleq-local.local/graphql';

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

    // Query product by database ID
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: GET_PRODUCT_BY_ID,
        variables: { id: productId.toString() },
      }),
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      throw new Error(`GraphQL API error: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      throw new Error('GraphQL query failed');
    }

    const product = result.data?.product;

    if (!product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: product.databaseId,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      price: product.salePrice || product.price,
      regularPrice: product.regularPrice,
      salePrice: product.salePrice,
      onSale: !!(product.salePrice && product.salePrice !== product.regularPrice),
      image: product.image ? {
        url: product.image.sourceUrl,
        altText: product.image.altText || product.name,
      } : null,
      stockStatus: product.stockStatus,
      inStock: product.stockStatus === 'IN_STOCK',
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    return NextResponse.json(
      { error: 'Failed to fetch product' },
      { status: 500 }
    );
  }
}
