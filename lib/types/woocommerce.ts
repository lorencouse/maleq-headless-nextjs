// WooCommerce Product Types
export interface Product {
  id: string;
  databaseId: number;
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  sku?: string;
  price?: string;
  regularPrice?: string;
  salePrice?: string;
  onSale: boolean;
  stockStatus: 'IN_STOCK' | 'OUT_OF_STOCK' | 'ON_BACKORDER';
  stockQuantity?: number;
  image?: ProductImage;
  galleryImages?: ProductImage[];
  productCategories?: ProductCategory[];
  productTags?: ProductTag[];
  averageRating?: number;
  reviewCount?: number;
  type: 'SIMPLE' | 'VARIABLE' | 'GROUPED' | 'EXTERNAL';
  attributes?: ProductAttribute[];
  variations?: ProductVariation[];
}

export interface ProductImage {
  id: string;
  sourceUrl: string;
  altText: string;
  mediaDetails?: {
    width: number;
    height: number;
  };
}

export interface ProductCategory {
  id: string;
  name: string;
  slug: string;
  count?: number;
  image?: {
    sourceUrl: string;
  };
}

export interface ProductTag {
  id: string;
  name: string;
  slug: string;
}

export interface ProductAttribute {
  id: string;
  name: string;
  options: string[];
  variation: boolean;
  visible: boolean;
}

export interface ProductVariation {
  id: string;
  databaseId: number;
  name: string;
  price?: string;
  regularPrice?: string;
  salePrice?: string;
  stockStatus: 'IN_STOCK' | 'OUT_OF_STOCK' | 'ON_BACKORDER';
  stockQuantity?: number;
  image?: ProductImage;
  attributes: {
    name: string;
    value: string;
  }[];
}

// Cart Types
export interface CartItem {
  key: string;
  product: Product;
  variation?: ProductVariation;
  quantity: number;
  subtotal: string;
  total: string;
}

export interface Cart {
  contents: CartItem[];
  subtotal: string;
  total: string;
  totalTax: string;
  shippingTotal?: string;
  isEmpty: boolean;
}

// Pagination
export interface ProductConnection {
  nodes: Product[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor?: string;
    endCursor?: string;
  };
}
