/**
 * Shared Product Types
 * Consolidates product-related type definitions to avoid duplication
 */

/**
 * Image type for variation images
 * Uses simplified url/altText structure for component props
 */
export interface VariationImage {
  url: string;
  altText: string;
}

/**
 * Selected variation state for product pages
 * Represents the currently selected variation with all its details
 */
export interface SelectedVariation {
  id: string;
  name: string;
  sku: string | null;
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  stockStatus: string;
  stockQuantity: number | null;
  attributes: Array<{ name: string; value: string }>;
  image?: VariationImage | null;
}

/**
 * Stock status enum for consistent status checking
 */
export type StockStatus = 'IN_STOCK' | 'OUT_OF_STOCK' | 'ON_BACKORDER';

/**
 * Product type enum
 */
export type ProductType = 'SIMPLE' | 'VARIABLE' | 'GROUPED' | 'EXTERNAL';

/**
 * Simplified product image for gallery components
 * Converts from API ProductImage format
 */
export interface GalleryImage {
  id: string;
  url: string;
  altText: string;
  width?: number;
  height?: number;
}

/**
 * Product image for gallery display
 * Includes display-specific fields like title and isPrimary
 */
export interface GalleryProductImage {
  id: string;
  url: string;
  altText: string;
  title?: string;
  isPrimary: boolean;
}

/**
 * Helper function to convert ProductImage to VariationImage format
 */
export function toVariationImage(image: {
  sourceUrl?: string;
  url?: string;
  altText?: string;
  alt_text?: string;
} | null | undefined): VariationImage | null {
  if (!image) return null;

  const url = image.sourceUrl || image.url;
  if (!url) return null;

  return {
    url,
    altText: image.altText || image.alt_text || '',
  };
}

/**
 * Helper to check if a product is in stock
 */
export function isInStock(stockStatus: string | undefined | null): boolean {
  return stockStatus === 'IN_STOCK' || stockStatus === 'instock';
}

/**
 * Helper to check if a product is on backorder
 */
export function isOnBackorder(stockStatus: string | undefined | null): boolean {
  return stockStatus === 'ON_BACKORDER' || stockStatus === 'onbackorder';
}
