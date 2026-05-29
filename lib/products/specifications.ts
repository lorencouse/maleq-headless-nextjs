/**
 * Shared specifications extraction logic.
 * Used by both the GraphQL product service and the DB export script.
 */
import { formatAttributeName, formatAttributeValue } from '@/lib/utils/woocommerce-format';

export interface ProductSpecificationLink {
  text: string;
  url: string;
  /** Term slug — used to localize category link text at render time. */
  slug?: string;
}

export interface ProductSpecification {
  label: string;
  value: string;
  links?: ProductSpecificationLink[];
}

/**
 * Input shape for extractSpecifications — works with both GraphQL and DB-assembled data.
 * Each field is optional so either source can provide what it has.
 */
export interface SpecificationInput {
  sku?: string | null;
  weight?: string | null;
  length?: string | null;
  width?: string | null;
  height?: string | null;
  stockStatus?: string;
  stockQuantity?: number | null;
  brands?: { name: string; slug: string }[];
  categories?: { name: string; slug: string }[];
  tags?: { name: string }[];
  attributes?: {
    name: string;
    options: string[];
    visible: boolean;
    variation?: boolean;
  }[];
}

/**
 * Extract product specifications from product data.
 * Works identically for GraphQL-sourced and DB-sourced products.
 */
export function extractSpecifications(product: SpecificationInput, isVariable: boolean): ProductSpecification[] {
  const specs: ProductSpecification[] = [];

  // Only show parent SKU for non-variable products
  if (product.sku && !isVariable) {
    specs.push({ label: 'SKU', value: product.sku });
  }

  // Brands
  if (product.brands && product.brands.length > 0) {
    specs.push({
      label: 'Brand',
      value: product.brands.map((b) => b.name).join(', '),
      links: product.brands.map((b) => ({
        text: b.name,
        url: `/brand/${b.slug}`,
      })),
    });
  }

  // Categories
  if (product.categories && product.categories.length > 0) {
    specs.push({
      label: 'Categories',
      value: product.categories.map((c) => c.name).join(', '),
      links: product.categories.map((c) => ({
        text: c.name,
        url: `/sex-toys/${c.slug}`,
        slug: c.slug,
      })),
    });
  }

  // Tags
  if (product.tags && product.tags.length > 0) {
    specs.push({
      label: 'Tags',
      value: product.tags.map((t) => t.name).join(', '),
    });
  }

  // Weight
  if (product.weight) {
    specs.push({
      label: 'Weight',
      value: `${product.weight} lbs`,
    });
  }

  // Dimensions
  const dimensionParts: string[] = [];
  if (product.length) dimensionParts.push(`Length: ${product.length}"`);
  if (product.width) dimensionParts.push(`Width: ${product.width}"`);
  if (product.height) dimensionParts.push(`Height: ${product.height}"`);
  if (dimensionParts.length > 0) {
    specs.push({
      label: 'Dimensions',
      value: dimensionParts.join(' | '),
    });
  }

  // Stock availability
  const stockStatus = product.stockStatus || 'OUT_OF_STOCK';
  specs.push({
    label: 'Availability',
    value:
      stockStatus === 'IN_STOCK'
        ? 'In Stock'
        : stockStatus === 'OUT_OF_STOCK'
          ? 'Out of Stock'
          : 'On Backorder',
  });

  if (product.stockQuantity) {
    specs.push({ label: 'Stock Quantity', value: product.stockQuantity.toString() });
  }

  // Product attributes (non-variation attributes for display)
  if (product.attributes) {
    for (const attr of product.attributes) {
      if (attr.visible && !attr.variation && attr.options && attr.options.length > 0) {
        const attrName = attr.name.toLowerCase();
        const isColor = attrName === 'pa_color' || attrName === 'color';
        const isMaterial = attrName === 'pa_material' || attrName === 'material';

        // Flatten options - some may contain comma-separated values
        const flattenedOptions = attr.options.flatMap((opt) =>
          opt
            .split(/[,\/]+/)
            .map((o) => o.trim())
            .filter((o) => o.length > 0)
        );

        if (isColor || isMaterial) {
          const filterParam = isColor ? 'color' : 'material';
          specs.push({
            label: formatAttributeName(attr.name),
            value: flattenedOptions.map((opt) => formatAttributeValue(opt)).join(', '),
            links: flattenedOptions.map((opt) => ({
              text: formatAttributeValue(opt),
              url: `/shop?${filterParam}=${opt.toLowerCase().replace(/\s+/g, '-')}`,
              slug: opt.toLowerCase().replace(/\s+/g, '-'),
            })),
          });
        } else {
          specs.push({
            label: formatAttributeName(attr.name),
            value: flattenedOptions.map((opt) => formatAttributeValue(opt)).join(', '),
          });
        }
      }
    }
  }

  return specs;
}
