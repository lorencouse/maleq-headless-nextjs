import type { WTProduct, WTProductType, WTManufacturer, WTProductImage, CategoryMapping } from '../williams-trading/types';
import type { WooProduct, WooCategory, WooProductImage } from './types';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Map Williams Trading category codes to WooCommerce category IDs
type CategoryMap = Map<string, number>;

// Map Williams Trading manufacturer codes to WooCommerce manufacturer term IDs
type ManufacturerMap = Map<string, number>;

/**
 * Load category mapping from JSON file
 */
function loadCategoryMapping(): CategoryMapping | null {
  try {
    const mappingPath = join(process.cwd(), 'data', 'category-mapping.json');
    if (!existsSync(mappingPath)) {
      console.warn('Category mapping file not found. Run category sync first.');
      return null;
    }
    const rawData = readFileSync(mappingPath, 'utf-8');
    return JSON.parse(rawData) as CategoryMapping;
  } catch (error) {
    console.warn('Failed to load category mapping:', error);
    return null;
  }
}

/**
 * Transform Williams Trading product to WooCommerce product format
 * Following IMPORT_PARAMETERS.md specifications
 */
export function transformWTProductToWoo(
  wtProduct: WTProduct,
  categoryMap: CategoryMap,
  manufacturerMap: ManufacturerMap,
  images?: WooProductImage[]
): WooProduct {
  const stockQuantity = typeof wtProduct.stock_quantity === 'string'
    ? parseInt(wtProduct.stock_quantity, 10)
    : wtProduct.stock_quantity;

  const stockStatus = getStockStatus(stockQuantity);

  // Calculate pricing: 3x Williams Trading price (IMPORT_PARAMETERS.md spec)
  const wtPrice = typeof wtProduct.price === 'string'
    ? parseFloat(wtProduct.price)
    : (wtProduct.price || 0);
  const regularPrice = (wtPrice * 3).toFixed(2);

  // Sale price: 10% discount (90% of regular price)
  const salePrice = (wtPrice * 3 * 0.9).toFixed(2);

  // Use UPC as SKU (IMPORT_PARAMETERS.md spec)
  const productSku = wtProduct.upc_code || wtProduct.sku;

  // Format product name in title case
  const productName = toTitleCase(cleanProductName(wtProduct.name));

  // Clean and format description
  const description = cleanDescription(wtProduct.description || '');

  // Auto-generate short description (first 2-3 sentences, max 160 chars)
  const shortDescription = generateShortDescription(description);

  const wooProduct: WooProduct = {
    name: productName,
    sku: productSku,
    type: 'simple',
    status: wtProduct.active === '1' ? 'publish' : 'draft',
    description: description,
    short_description: shortDescription,
    regular_price: regularPrice,
    sale_price: salePrice, // Always apply 10% discount
    manage_stock: true,
    stock_quantity: stockQuantity,
    stock_status: stockStatus,
    weight: wtProduct.weight || '',
    dimensions: {
      length: wtProduct.length || '',
      width: wtProduct.width || '',
      height: wtProduct.height || '',
    },
    categories: [],
    meta_data: [
      { key: '_wt_sku', value: wtProduct.sku },
      { key: '_wt_barcode', value: wtProduct.upc_code || '' },
      { key: '_wt_manufacturer_code', value: wtProduct.manufacturer_code || '' },
      { key: '_wt_product_type_code', value: wtProduct.product_type_code || '' },
      { key: '_wt_active', value: wtProduct.active },
      { key: '_wt_on_sale', value: wtProduct.on_sale },
      { key: '_wt_last_synced', value: new Date().toISOString() },
    ],
  };

  // Add categories - supports multiple categories from XML
  const categoryIds: number[] = [];

  // Load category mapping from file (for full category support)
  const categoryMapping = loadCategoryMapping();

  console.log(`[${wtProduct.sku}] Category codes:`, wtProduct.category_codes);
  console.log(`[${wtProduct.sku}] Product type code:`, wtProduct.product_type_code);
  console.log(`[${wtProduct.sku}] Category mapping available:`, !!categoryMapping);

  if (categoryMapping && wtProduct.category_codes && wtProduct.category_codes.length > 0) {
    // Use category codes from XML (multiple categories)
    for (const code of wtProduct.category_codes) {
      const categoryId = categoryMapping.codeToId[code];
      if (categoryId) {
        categoryIds.push(categoryId);
        console.log(`[${wtProduct.sku}] Assigned category ${code} -> ${categoryId}`);
      } else {
        console.warn(`[${wtProduct.sku}] Category code ${code} not found in mapping`);
      }
    }
  } else if (wtProduct.product_type_code && categoryMap.has(wtProduct.product_type_code)) {
    // Fallback to product type code (single category) from legacy categoryMap
    const categoryId = categoryMap.get(wtProduct.product_type_code)!;
    categoryIds.push(categoryId);
    console.log(`[${wtProduct.sku}] Assigned product type category ${wtProduct.product_type_code} -> ${categoryId}`);
  } else {
    console.warn(`[${wtProduct.sku}] No categories found - category_codes: ${wtProduct.category_codes?.length || 0}, product_type_code: ${wtProduct.product_type_code}, has categoryMap: ${categoryMap.size > 0}`);
  }

  // Assign categories (deduplicate in case of overlaps)
  if (categoryIds.length > 0) {
    const uniqueIds = [...new Set(categoryIds)];
    wooProduct.categories = uniqueIds.map(id => ({ id }));
  }

  // Add manufacturer as meta data (will be assigned to taxonomy separately)
  if (wtProduct.manufacturer_code) {
    const manufacturerId = manufacturerMap.get(wtProduct.manufacturer_code);
    if (manufacturerId) {
      // Store manufacturer term ID in meta for reference
      wooProduct.meta_data!.push({ key: '_wt_manufacturer_id', value: String(manufacturerId) });
    }
  }

  // Add images if provided
  if (images && images.length > 0) {
    wooProduct.images = images;
  }

  return wooProduct;
}

/**
 * Transform Williams Trading category to WooCommerce category format
 */
export function transformWTCategoryToWoo(
  wtCategory: WTProductType,
  parentMap?: Map<string, number>
): WooCategory {
  const category: WooCategory = {
    name: wtCategory.name,
    slug: wtCategory.code.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    description: wtCategory.description || '',
  };

  // Set parent if available
  if (wtCategory.parent_code && parentMap?.has(wtCategory.parent_code)) {
    category.parent = parentMap.get(wtCategory.parent_code);
  }

  return category;
}

/**
 * Transform Williams Trading manufacturer to format for custom taxonomy
 */
export function transformWTManufacturerToTerm(wtManufacturer: WTManufacturer): {
  name: string;
  slug: string;
  description: string;
} {
  return {
    name: wtManufacturer.name,
    slug: wtManufacturer.code.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    description: wtManufacturer.website || '',
  };
}

/**
 * Transform Williams Trading product images to WooCommerce image format
 * Note: This creates references to uploaded media items
 */
export function transformWTImagesToWoo(
  wtImages: WTProductImage[],
  mediaIdMap: Map<string, number>,
  productName: string
): WooProductImage[] {
  return wtImages
    .sort((a, b) => {
      // Primary image first
      if (a.is_primary === '1' && b.is_primary !== '1') return -1;
      if (b.is_primary === '1' && a.is_primary !== '1') return 1;
      // Then by sort order
      const orderA = typeof a.sort_order === 'string' ? parseInt(a.sort_order, 10) : a.sort_order;
      const orderB = typeof b.sort_order === 'string' ? parseInt(b.sort_order, 10) : b.sort_order;
      return orderA - orderB;
    })
    .map((img, index): WooProductImage => {
      const mediaId = mediaIdMap.get(img.file_name);

      // WooCommerce REST API will resolve the src from the media ID
      return {
        id: mediaId,
        src: img.image_url,
        name: img.file_name,
        alt: productName,
        position: index,
      };
    });
}

/**
 * Calculate stock status from quantity
 */
function getStockStatus(quantity: number): 'instock' | 'outofstock' | 'onbackorder' {
  if (quantity <= 0) return 'outofstock';
  return 'instock';
}

/**
 * Generate a slug from product name
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Prepare product data for update (only changed fields)
 */
export function prepareProductUpdate(
  existing: WooProduct,
  newData: WooProduct
): Partial<WooProduct> | null {
  const updates: Partial<WooProduct> = {};
  let hasChanges = false;

  // Compare and collect changes
  const fieldsToCompare: (keyof WooProduct)[] = [
    'name',
    'description',
    'short_description',
    'regular_price',
    'sale_price',
    'stock_quantity',
    'stock_status',
    'weight',
    'status',
  ];

  for (const field of fieldsToCompare) {
    if (existing[field] !== newData[field]) {
      (updates as Record<string, unknown>)[field] = newData[field];
      hasChanges = true;
    }
  }

  // Check dimensions
  if (newData.dimensions) {
    if (
      existing.dimensions?.length !== newData.dimensions.length ||
      existing.dimensions?.width !== newData.dimensions.width ||
      existing.dimensions?.height !== newData.dimensions.height
    ) {
      updates.dimensions = newData.dimensions;
      hasChanges = true;
    }
  }

  // Check categories
  if (newData.categories && newData.categories.length > 0) {
    const existingCatIds = existing.categories?.map(c => c.id).sort() || [];
    const newCatIds = newData.categories.map(c => c.id).sort();
    if (JSON.stringify(existingCatIds) !== JSON.stringify(newCatIds)) {
      updates.categories = newData.categories;
      hasChanges = true;
    }
  }

  return hasChanges ? updates : null;
}

/**
 * Check if stock has changed
 */
export function hasStockChanged(
  existingQty: number | null | undefined,
  existingStatus: string | undefined,
  newQty: number,
  newStatus: string
): boolean {
  return existingQty !== newQty || existingStatus !== newStatus;
}

/**
 * Convert text to title case (IMPORT_PARAMETERS.md spec)
 * Capitalize first letter of major words
 * Lowercase: articles, conjunctions, prepositions (unless first word)
 */
function toTitleCase(text: string): string {
  const lowercaseWords = ['the', 'a', 'an', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'from', 'by', 'of', 'in', 'with'];

  return text
    .toLowerCase()
    .split(' ')
    .map((word, index) => {
      // Always capitalize first word
      if (index === 0) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      // Lowercase articles, conjunctions, prepositions
      if (lowercaseWords.includes(word)) {
        return word;
      }
      // Capitalize other words
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Clean product name (IMPORT_PARAMETERS.md spec)
 * Remove excessive whitespace, trailing periods, RESTRICTED flags
 */
function cleanProductName(name: string): string {
  return name
    .replace(/RESTRICTED/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/, '')
    .trim()
    .substring(0, 200); // Max 200 characters
}

/**
 * Clean description (IMPORT_PARAMETERS.md spec)
 * Remove year markers, clean HTML entities, excessive line breaks
 */
function cleanDescription(description: string): string {
  return description
    .replace(/20\d{2}\.?\s*$/g, '') // Remove year markers at end (2024, 2025, etc.)
    .replace(/\n\n+/g, '\n\n') // Remove excessive line breaks
    .replace(/&nbsp;/g, ' ') // Clean HTML entities
    .trim();
}

/**
 * Generate short description (IMPORT_PARAMETERS.md spec)
 * Extract first 2-3 sentences (max 160 characters)
 */
function generateShortDescription(description: string): string {
  if (!description) return '';

  // Remove HTML tags for sentence detection
  const plainText = description.replace(/<[^>]*>/g, '');

  // Split by sentence endings
  const sentences = plainText.match(/[^.!?]+[.!?]+/g) || [];

  if (sentences.length === 0) {
    // No sentences found, just truncate
    return plainText.substring(0, 160).trim();
  }

  // Collect sentences until we hit 160 chars or 3 sentences
  let result = '';
  for (let i = 0; i < Math.min(3, sentences.length); i++) {
    const sentence = sentences[i].trim();
    if ((result + sentence).length <= 160) {
      result += (result ? ' ' : '') + sentence;
    } else if (result) {
      // Already have some content, stop here
      break;
    } else {
      // First sentence is too long, truncate it
      result = sentence.substring(0, 157) + '...';
      break;
    }
  }

  return result || plainText.substring(0, 160).trim();
}
