// WooCommerce REST API Types

// Product Types
export interface WooProductImage {
  id?: number;
  src: string;
  name?: string;
  alt?: string;
  position?: number;
}

export interface WooProductCategory {
  id: number;
  name?: string;
  slug?: string;
}

export interface WooProductAttribute {
  id?: number;
  name: string;
  position?: number;
  visible?: boolean;
  variation?: boolean;
  options: string[];
}

export interface WooProductDimensions {
  length: string;
  width: string;
  height: string;
}

export interface WooProductVariation {
  id?: number;
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  manage_stock?: boolean;
  stock_quantity?: number;
  stock_status?: 'instock' | 'outofstock' | 'onbackorder';
  attributes?: { name: string; option: string }[];
  image?: WooProductImage;
  meta_data?: { key: string; value: string }[];
}

export interface WooProduct {
  id?: number;
  name: string;
  slug?: string;
  type?: 'simple' | 'variable' | 'grouped' | 'external';
  status?: 'draft' | 'pending' | 'private' | 'publish';
  featured?: boolean;
  catalog_visibility?: 'visible' | 'catalog' | 'search' | 'hidden';
  description?: string;
  short_description?: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  on_sale?: boolean;
  purchasable?: boolean;
  total_sales?: number;
  virtual?: boolean;
  downloadable?: boolean;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  stock_status?: 'instock' | 'outofstock' | 'onbackorder';
  backorders?: 'no' | 'notify' | 'yes';
  weight?: string;
  dimensions?: WooProductDimensions;
  reviews_allowed?: boolean;
  average_rating?: string;
  rating_count?: number;
  upsell_ids?: number[];
  cross_sell_ids?: number[];
  parent_id?: number;
  categories?: WooProductCategory[];
  tags?: { id: number; name?: string; slug?: string }[];
  images?: WooProductImage[];
  attributes?: WooProductAttribute[];
  default_attributes?: { name: string; option: string }[];
  variations?: number[];
  meta_data?: { key: string; value: string }[];
}

// Category Types
export interface WooCategory {
  id?: number;
  name: string;
  slug?: string;
  parent?: number;
  description?: string;
  display?: 'default' | 'products' | 'subcategories' | 'both';
  image?: { id?: number; src: string; name?: string; alt?: string };
  menu_order?: number;
  count?: number;
}

// Manufacturer Taxonomy (Custom)
export interface WooManufacturer {
  id?: number;
  name: string;
  slug?: string;
  description?: string;
  count?: number;
}

// Media/Image Types
export interface WooMediaItem {
  id: number;
  date_created: string;
  date_modified: string;
  src: string;
  name: string;
  alt: string;
  title: string;
}

// API Response Types
export interface WooApiResponse<T> {
  data: T;
  headers: {
    'x-wp-total'?: string;
    'x-wp-totalpages'?: string;
  };
}

export interface WooBatchRequest<T> {
  create?: T[];
  update?: T[];
  delete?: number[];
}

export interface WooBatchResponse<T> {
  create?: T[];
  update?: T[];
  delete?: T[];
}

// Stock Update Types
export interface WooStockUpdate {
  id: number;
  stock_quantity: number;
  stock_status: 'instock' | 'outofstock' | 'onbackorder';
}

// Error Types
export interface WooApiError {
  code: string;
  message: string;
  data?: {
    status: number;
    params?: Record<string, string>;
  };
}
