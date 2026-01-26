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
  description?: string;
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

// GraphQL Response Types (with nested nodes arrays)
// These match the actual GraphQL response structure from WPGraphQL/WooGraphQL

/** GraphQL wrapper for array responses */
export interface GraphQLNodeConnection<T> {
  nodes: T[];
}

/** GraphQL product response with nested nodes */
export interface GraphQLProduct {
  id: string;
  databaseId: number;
  name: string;
  slug: string;
  description?: string | null;
  shortDescription?: string | null;
  sku?: string | null;
  price?: string | null;
  regularPrice?: string | null;
  salePrice?: string | null;
  onSale?: boolean;
  stockStatus?: string;
  stockQuantity?: number | null;
  weight?: string | null;
  length?: string | null;
  width?: string | null;
  height?: string | null;
  featured?: boolean;
  purchaseNote?: string | null;
  externalUrl?: string | null;
  buttonText?: string | null;
  type?: string;
  averageRating?: number;
  reviewCount?: number;
  image?: GraphQLImage | null;
  galleryImages?: GraphQLNodeConnection<GraphQLImage>;
  productCategories?: GraphQLNodeConnection<GraphQLCategory>;
  productTags?: GraphQLNodeConnection<GraphQLTag>;
  productBrands?: GraphQLNodeConnection<GraphQLBrand>;
  productMaterials?: GraphQLNodeConnection<GraphQLMaterial>;
  attributes?: GraphQLNodeConnection<GraphQLAttribute>;
  variations?: GraphQLNodeConnection<GraphQLVariation>;
}

export interface GraphQLImage {
  id?: string;
  sourceUrl: string;
  altText?: string | null;
}

export interface GraphQLCategory {
  id: string;
  name: string;
  slug: string;
  count?: number;
}

export interface GraphQLTag {
  id: string;
  name: string;
  slug: string;
}

export interface GraphQLBrand {
  id: string;
  name: string;
  slug: string;
}

export interface GraphQLMaterial {
  id: string;
  name: string;
  slug: string;
}

export interface GraphQLAttribute {
  name: string;
  options?: string[];
  visible?: boolean;
  variation?: boolean;
}

export interface GraphQLVariation {
  id: string;
  databaseId: number;
  name: string;
  sku?: string | null;
  description?: string | null;
  price?: string | null;
  regularPrice?: string | null;
  salePrice?: string | null;
  stockStatus?: string;
  stockQuantity?: number | null;
  weight?: string | null;
  length?: string | null;
  width?: string | null;
  height?: string | null;
  image?: GraphQLImage | null;
  attributes?: GraphQLNodeConnection<GraphQLVariationAttribute>;
}

export interface GraphQLVariationAttribute {
  name: string;
  value: string;
}

/** GraphQL hierarchical category (with nested children) */
export interface GraphQLHierarchicalCategory {
  id: string;
  name: string;
  slug: string;
  count?: number;
  children?: GraphQLNodeConnection<GraphQLHierarchicalCategory>;
}

/** GraphQL page info for pagination */
export interface GraphQLPageInfo {
  hasNextPage: boolean;
  hasPreviousPage?: boolean;
  startCursor?: string | null;
  endCursor?: string | null;
}

/** GraphQL paginated connection response */
export interface GraphQLPaginatedConnection<T> {
  nodes: T[];
  pageInfo: GraphQLPageInfo;
}

/** GraphQL query result wrapper */
export interface GraphQLQueryResult<T> {
  data: T;
}
