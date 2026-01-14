// Williams Trading API Response Types

export interface WTProductType {
  code: string;
  name: string;
  description?: string;
  active: '1' | '0';
  parent_code?: string;
}

export interface WTManufacturer {
  code: string;
  name: string;
  active: '1' | '0';
  website?: string;
}

export interface WTProduct {
  sku: string;
  name: string;
  description?: string;
  short_description?: string;
  price?: string;
  retail_price?: string;
  sale_price?: string;
  on_sale: '1' | '0';
  stock_quantity: string | number;
  active: '1' | '0';
  weight?: string;
  length?: string;
  width?: string;
  height?: string;
  upc_code?: string;
  manufacturer_sku?: string;
  manufacturer_code?: string;
  product_type_code?: string;
  release_date?: string;
}

export interface WTProductImage {
  sku: string;
  image_url: string;
  file_name: string;
  sort_order: string | number;
  is_primary: '1' | '0';
}

export interface WTApiResponse<T> {
  items: T[];
  total: number;
  start: number;
  count: number;
}

export interface WTRequestParams {
  format?: 'xml' | 'json';
  start?: number;
  count?: number;
  sort?: string;
  active?: '1' | '0';
  type?: string;
  manufacturer?: string;
  search_terms?: string;
}
