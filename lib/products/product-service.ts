import { getClient } from '@/lib/apollo/client';
import { GET_PRODUCT_BY_SLUG, GET_ALL_PRODUCT_SLUGS } from '@/lib/queries/products';
import type { UnifiedProduct } from './combined-service';
import { formatAttributeName, formatAttributeValue } from '@/lib/utils/woocommerce-format';

export interface ProductSpecificationLink {
  text: string;
  url: string;
}

export interface ProductSpecification {
  label: string;
  value: string;
  links?: ProductSpecificationLink[];
}

export interface ProductVariation {
  id: string;
  name: string;
  sku: string | null;
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  stockStatus: string;
  stockQuantity: number | null;
  attributes: Array<{
    name: string;
    value: string;
  }>;
  image?: {
    url: string;
    altText: string;
  } | null;
}

export interface ProductBrand {
  id: string;
  name: string;
  slug: string;
}

export interface ProductDimensions {
  weight: string | null;
  length: string | null;
  width: string | null;
  height: string | null;
}

export interface EnhancedProduct extends UnifiedProduct {
  specifications: ProductSpecification[];
  gallery: Array<{
    id: string;
    url: string;
    altText: string;
    isPrimary: boolean;
  }>;
  brands: ProductBrand[];
  dimensions: ProductDimensions;
  featured: boolean;
  purchaseNote: string | null;
  externalUrl?: string | null;
  buttonText?: string | null;
}

/**
 * Extract product specifications from WooCommerce product
 */
function extractSpecifications(product: any, isVariable: boolean): ProductSpecification[] {
  const specs: ProductSpecification[] = [];

  // Only show parent SKU for non-variable products
  // Variable products show variation SKU in the selector
  if (product.sku && !isVariable) {
    specs.push({ label: 'SKU', value: product.sku });
  }

  // Brands
  if (product.productBrands?.nodes?.length > 0) {
    const brandNodes = product.productBrands.nodes;
    specs.push({
      label: 'Brand',
      value: brandNodes.map((brand: any) => brand.name).join(', '),
      links: brandNodes.map((brand: any) => ({
        text: brand.name,
        url: `/shop?brand=${brand.slug}`,
      })),
    });
  }

  // Categories
  if (product.productCategories?.nodes?.length > 0) {
    const categoryNodes = product.productCategories.nodes;
    specs.push({
      label: 'Categories',
      value: categoryNodes.map((cat: any) => cat.name).join(', '),
      links: categoryNodes.map((cat: any) => ({
        text: cat.name,
        url: `/shop/category/${cat.slug}`,
      })),
    });
  }

  // Tags
  if (product.productTags?.nodes?.length > 0) {
    specs.push({
      label: 'Tags',
      value: product.productTags.nodes.map((tag: any) => tag.name).join(', ')
    });
  }

  // Dimensions (weight, length, width, height)
  const dimensions: string[] = [];
  if (product.weight) {
    dimensions.push(`Weight: ${product.weight}`);
  }
  if (product.length && product.width && product.height) {
    dimensions.push(`Dimensions: ${product.length} × ${product.width} × ${product.height}`);
  }
  if (dimensions.length > 0) {
    specs.push({
      label: 'Shipping',
      value: dimensions.join(' | ')
    });
  }

  // Stock availability
  const stockStatus = product.stockStatus || 'OUT_OF_STOCK';
  specs.push({
    label: 'Availability',
    value: stockStatus === 'IN_STOCK' ? 'In Stock' :
           stockStatus === 'OUT_OF_STOCK' ? 'Out of Stock' : 'On Backorder'
  });

  if (product.stockQuantity) {
    specs.push({ label: 'Stock Quantity', value: product.stockQuantity.toString() });
  }

  // Product attributes (non-variation attributes for display)
  if (product.attributes?.nodes) {
    for (const attr of product.attributes.nodes) {
      // Only show visible, non-variation attributes in specifications
      if (attr.visible && !attr.variation && attr.options?.length > 0) {
        const attrName = attr.name.toLowerCase();
        const isColor = attrName === 'pa_color' || attrName === 'color';
        const isMaterial = attrName === 'pa_material' || attrName === 'material';

        // Add links for color and material attributes
        if (isColor || isMaterial) {
          const filterParam = isColor ? 'color' : 'material';
          specs.push({
            label: formatAttributeName(attr.name),
            value: attr.options.map((opt: string) => formatAttributeValue(opt)).join(', '),
            links: attr.options.map((opt: string) => ({
              text: formatAttributeValue(opt),
              // Use lowercase slug format for the URL
              url: `/shop?${filterParam}=${opt.toLowerCase().replace(/\s+/g, '-')}`,
            })),
          });
        } else {
          specs.push({
            label: formatAttributeName(attr.name),
            value: attr.options.map((opt: string) => formatAttributeValue(opt)).join(', ')
          });
        }
      }
    }
  }

  return specs;
}

/**
 * Get product by slug from WooCommerce
 */
export async function getProductBySlug(slug: string): Promise<EnhancedProduct | null> {
  try {
    const { data } = await getClient().query({
      query: GET_PRODUCT_BY_SLUG,
      variables: { slug },
    });

    const product = data?.product;
    if (!product) return null;

    const isVariable = product.type === 'VARIABLE';
    const specifications = extractSpecifications(product, isVariable);

    // Extract brands
    const brands: ProductBrand[] = product.productBrands?.nodes?.map((brand: any) => ({
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
    })) || [];

    // Extract dimensions
    const dimensions: ProductDimensions = {
      weight: product.weight || null,
      length: product.length || null,
      width: product.width || null,
      height: product.height || null,
    };

    const enhancedProduct: EnhancedProduct = {
      id: product.id,
      databaseId: product.databaseId,
      name: product.name,
      slug: product.slug,
      description: product.description || null,
      shortDescription: product.shortDescription || null,
      sku: product.sku || null,
      price: product.price || null,
      regularPrice: product.regularPrice || null,
      salePrice: product.salePrice || null,
      onSale: product.onSale || false,
      stockStatus: product.stockStatus || 'OUT_OF_STOCK',
      stockQuantity: product.stockQuantity || null,
      image: product.image ? {
        url: product.image.sourceUrl,
        altText: product.image.altText || product.name,
      } : null,
      galleryImages: product.galleryImages?.nodes?.map((img: any) => ({
        url: img.sourceUrl,
        altText: img.altText || product.name,
      })),
      categories: product.productCategories?.nodes?.map((cat: any) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
      })) || [],
      tags: product.productTags?.nodes?.map((tag: any) => ({
        id: tag.id,
        name: tag.name,
        slug: tag.slug,
      })),
      type: product.type || 'SIMPLE',
      averageRating: product.averageRating,
      reviewCount: product.reviewCount,
      attributes: product.attributes?.nodes?.map((attr: any) => ({
        name: attr.name,
        options: attr.options || [],
        visible: attr.visible ?? true,
      })),
      variations: product.variations?.nodes?.map((v: any) => ({
        id: v.id,
        name: v.name,
        sku: v.sku || null,
        price: v.price || null,
        regularPrice: v.regularPrice || null,
        salePrice: v.salePrice || null,
        stockStatus: v.stockStatus || 'OUT_OF_STOCK',
        stockQuantity: v.stockQuantity || null,
        attributes: v.attributes?.nodes?.map((a: any) => ({
          name: a.name,
          value: a.value,
        })) || [],
        image: v.image ? {
          url: v.image.sourceUrl,
          altText: v.image.altText || v.name,
        } : null,
      })),
      specifications,
      gallery: [
        // Primary image first
        ...(product.image ? [{
          id: product.image.id || '0',
          url: product.image.sourceUrl,
          altText: product.image.altText || product.name,
          isPrimary: true,
        }] : []),
        // Gallery images
        ...(product.galleryImages?.nodes?.map((img: any, index: number) => ({
          id: img.id || String(index + 1),
          url: img.sourceUrl,
          altText: img.altText || product.name,
          isPrimary: false,
        })) || []),
      ],
      brands,
      dimensions,
      featured: product.featured || false,
      purchaseNote: product.purchaseNote || null,
      externalUrl: product.externalUrl || null,
      buttonText: product.buttonText || null,
    };

    return enhancedProduct;
  } catch (error) {
    console.error('Error fetching product by slug:', error);
    return null;
  }
}

/**
 * Get all product slugs for static generation
 */
export async function getAllProductSlugs(): Promise<string[]> {
  try {
    const { data } = await getClient().query({
      query: GET_ALL_PRODUCT_SLUGS,
    });

    return data?.products?.nodes?.map((p: { slug: string }) => p.slug) || [];
  } catch (error) {
    console.error('Error fetching product slugs:', error);
    return [];
  }
}
