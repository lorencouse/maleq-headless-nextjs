import { prisma } from '@/lib/prisma';
import { getClient } from '@/lib/apollo/client';
import { GET_ALL_PRODUCTS } from '@/lib/queries/products';
import { Product as WooProduct } from '@/lib/types/woocommerce';
import { triggerStockUpdate } from '@/lib/williams-trading/stock-updater';

// Unified product interface
export interface UnifiedProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  shortDescription: string | null;
  sku: string | null;
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  onSale: boolean;
  stockStatus: 'IN_STOCK' | 'OUT_OF_STOCK' | 'LOW_STOCK' | 'ON_BACKORDER';
  stockQuantity: number | null;
  image: {
    url: string;
    altText: string;
  } | null;
  category: {
    name: string;
    slug: string;
  } | null;
  manufacturer: {
    name: string;
    code: string;
  } | null;
  source: 'WORDPRESS' | 'WILLIAMS_TRADING';
  isVariableProduct?: boolean;
  variationCount?: number;
}

/**
 * Convert Williams Trading product to unified format
 */
function convertWTProduct(product: any): UnifiedProduct {
  const primaryImage = product.images.find((img: any) => img.isPrimary) || product.images[0];

  return {
    id: product.id,
    name: product.name,
    slug: product.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    description: product.description,
    shortDescription: product.shortDescription,
    sku: product.sku,
    price: product.price?.toString() || null,
    regularPrice: product.retailPrice?.toString() || null,
    salePrice: product.salePrice?.toString() || null,
    onSale: product.onSale,
    stockStatus: product.stockStatus,
    stockQuantity: product.stockQuantity,
    image: primaryImage
      ? {
          url: primaryImage.imageUrl,
          altText: product.name,
        }
      : null,
    category: product.productType
      ? {
          name: product.productType.name,
          slug: product.productType.code,
        }
      : null,
    manufacturer: product.manufacturer
      ? {
          name: product.manufacturer.name,
          code: product.manufacturer.code,
        }
      : null,
    source: 'WILLIAMS_TRADING',
    isVariableProduct: product.isVariableProduct,
    variationCount: product._count?.variations || 0,
  };
}

/**
 * Convert WordPress/WooCommerce product to unified format
 */
function convertWooProduct(product: WooProduct): UnifiedProduct {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    shortDescription: product.shortDescription,
    sku: product.sku || null,
    price: product.price || null,
    regularPrice: product.regularPrice || null,
    salePrice: product.salePrice || null,
    onSale: product.onSale,
    stockStatus: product.stockStatus,
    stockQuantity: product.stockQuantity || null,
    image: product.image
      ? {
          url: product.image.sourceUrl,
          altText: product.image.altText,
        }
      : null,
    category:
      product.productCategories && product.productCategories.length > 0
        ? {
            name: product.productCategories[0].name,
            slug: product.productCategories[0].slug,
          }
        : null,
    manufacturer: null,
    source: 'WORDPRESS',
  };
}

/**
 * Get products from Williams Trading database
 */
export async function getWilliamsTradingProducts(params: {
  limit?: number;
  offset?: number;
  category?: string;
  manufacturer?: string;
  search?: string;
  inStock?: boolean;
} = {}): Promise<UnifiedProduct[]> {
  const {
    limit = 12,
    offset = 0,
    category,
    manufacturer,
    search,
    inStock,
  } = params;

  // Trigger stock update in background (non-blocking)
  triggerStockUpdate().catch(console.error);

  const where: any = {
    active: true,
    // Only show parent products or standalone products, not individual variations
    parentProductId: null,
  };

  if (category) {
    where.productType = {
      code: category,
    };
  }

  if (manufacturer) {
    where.manufacturer = {
      code: manufacturer,
    };
  }

  if (search) {
    where.OR = [
      { name: { contains: search.toUpperCase() } },
      { name: { contains: search.toLowerCase() } },
      { description: { contains: search.toUpperCase() } },
      { description: { contains: search.toLowerCase() } },
      { sku: { contains: search.toUpperCase() } },
      { sku: { contains: search.toLowerCase() } },
    ];
  }

  if (inStock) {
    where.stockStatus = {
      in: ['IN_STOCK', 'LOW_STOCK'],
    };
  }

  const products = await prisma.product.findMany({
    where,
    include: {
      images: {
        orderBy: {
          sortOrder: 'asc',
        },
      },
      productType: true,
      manufacturer: true,
      _count: {
        select: {
          variations: true,
        },
      },
    },
    take: limit,
    skip: offset,
    orderBy: {
      createdAt: 'desc',
    },
  });

  return products.map(convertWTProduct);
}

/**
 * Get products from WordPress
 */
export async function getWordPressProducts(params: {
  limit?: number;
} = {}): Promise<UnifiedProduct[]> {
  const { limit = 12 } = params;

  try {
    const { data } = await getClient().query({
      query: GET_ALL_PRODUCTS,
      variables: {
        first: limit,
      },
    });

    const products: WooProduct[] = data?.products?.nodes || [];
    return products.map(convertWooProduct);
  } catch (error) {
    console.error('Error fetching WordPress products:', error);
    return [];
  }
}

/**
 * Get all products from both sources
 */
export async function getAllProducts(params: {
  limit?: number;
  offset?: number;
  category?: string;
  manufacturer?: string;
  search?: string;
  inStock?: boolean;
  source?: 'WORDPRESS' | 'WILLIAMS_TRADING' | 'BOTH';
} = {}): Promise<UnifiedProduct[]> {
  const { source = 'BOTH', limit = 12 } = params;

  if (source === 'WORDPRESS') {
    return getWordPressProducts({ limit });
  }

  if (source === 'WILLIAMS_TRADING') {
    return getWilliamsTradingProducts(params);
  }

  // Get from both sources
  const [wtProducts, wpProducts] = await Promise.all([
    getWilliamsTradingProducts({ ...params, limit: Math.ceil(limit / 2) }),
    getWordPressProducts({ limit: Math.ceil(limit / 2) }),
  ]);

  // Combine and sort by most recent
  return [...wtProducts, ...wpProducts].slice(0, limit);
}

/**
 * Get product categories from Williams Trading
 */
export async function getProductCategories() {
  return prisma.productType.findMany({
    where: {
      active: true,
    },
    orderBy: {
      name: 'asc',
    },
  });
}

/**
 * Get manufacturers
 */
export async function getManufacturers() {
  return prisma.manufacturer.findMany({
    where: {
      active: true,
    },
    orderBy: {
      name: 'asc',
    },
  });
}

/**
 * Get product by SKU or slug
 */
export async function getProductBySlug(slug: string): Promise<UnifiedProduct | null> {
  // Try Williams Trading first (by SKU)
  const wtProduct = await prisma.product.findFirst({
    where: {
      OR: [
        { sku: slug },
        { sku: slug.toUpperCase() },
      ],
    },
    include: {
      images: {
        orderBy: {
          sortOrder: 'asc',
        },
      },
      productType: true,
      manufacturer: true,
    },
  });

  if (wtProduct) {
    return convertWTProduct(wtProduct);
  }

  // Try WordPress (by slug)
  // You can implement WordPress product by slug query here if needed

  return null;
}
