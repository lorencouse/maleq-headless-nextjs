import { getClient } from '@/lib/apollo/client';
import { GET_PRODUCT_BY_SLUG, GET_ALL_PRODUCT_SLUGS } from '@/lib/queries/products';
import type { UnifiedProduct } from './combined-service';
import { formatAttributeName, formatAttributeValue } from '@/lib/utils/woocommerce-format';
import type {
  GraphQLProduct,
  GraphQLImage,
  GraphQLCategory,
  GraphQLTag,
  GraphQLBrand,
  GraphQLAttribute,
  GraphQLVariation,
  GraphQLVariationAttribute,
} from '@/lib/types/woocommerce';

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
  description: string | null;
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  stockStatus: string;
  stockQuantity: number | null;
  weight: string | null;
  length: string | null;
  width: string | null;
  height: string | null;
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
function extractSpecifications(product: GraphQLProduct, isVariable: boolean): ProductSpecification[] {
  const specs: ProductSpecification[] = [];

  // Only show parent SKU for non-variable products
  // Variable products show variation SKU in the selector
  if (product.sku && !isVariable) {
    specs.push({ label: 'SKU', value: product.sku });
  }

  // Brands
  const brandNodes = product.productBrands?.nodes;
  if (brandNodes && brandNodes.length > 0) {
    specs.push({
      label: 'Brand',
      value: brandNodes.map((brand: GraphQLBrand) => brand.name).join(', '),
      links: brandNodes.map((brand: GraphQLBrand) => ({
        text: brand.name,
        url: `/shop?brand=${brand.slug}`,
      })),
    });
  }

  // Categories
  const categoryNodes = product.productCategories?.nodes;
  if (categoryNodes && categoryNodes.length > 0) {
    specs.push({
      label: 'Categories',
      value: categoryNodes.map((cat: GraphQLCategory) => cat.name).join(', '),
      links: categoryNodes.map((cat: GraphQLCategory) => ({
        text: cat.name,
        url: `/product-category/${cat.slug}`,
      })),
    });
  }

  // Tags
  const tagNodes = product.productTags?.nodes;
  if (tagNodes && tagNodes.length > 0) {
    specs.push({
      label: 'Tags',
      value: tagNodes.map((tag: GraphQLTag) => tag.name).join(', ')
    });
  }

  // Weight
  if (product.weight) {
    specs.push({
      label: 'Weight',
      value: `${product.weight} lbs`
    });
  }

  // Product dimensions - show whatever is available
  const dimensionParts: string[] = [];
  if (product.length) {
    dimensionParts.push(`Length: ${product.length}"`);
  }
  if (product.width) {
    dimensionParts.push(`Width: ${product.width}"`);
  }
  if (product.height) {
    dimensionParts.push(`Height: ${product.height}"`);
  }
  if (dimensionParts.length > 0) {
    specs.push({
      label: 'Dimensions',
      value: dimensionParts.join(' | ')
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
  const attributeNodes = product.attributes?.nodes;
  if (attributeNodes) {
    for (const attr of attributeNodes) {
      // Only show visible, non-variation attributes in specifications
      if (attr.visible && !attr.variation && attr.options && attr.options.length > 0) {
        const attrName = attr.name.toLowerCase();
        const isColor = attrName === 'pa_color' || attrName === 'color';
        const isMaterial = attrName === 'pa_material' || attrName === 'material';

        // Flatten options - some may contain comma-separated values that need splitting
        const flattenedOptions = attr.options.flatMap((opt) =>
          opt.split(/[,\/]+/).map((o) => o.trim()).filter((o) => o.length > 0)
        );

        // Add links for color and material attributes
        if (isColor || isMaterial) {
          const filterParam = isColor ? 'color' : 'material';
          specs.push({
            label: formatAttributeName(attr.name),
            value: flattenedOptions.map((opt) => formatAttributeValue(opt)).join(', '),
            links: flattenedOptions.map((opt) => ({
              text: formatAttributeValue(opt),
              // Use lowercase slug format for the URL
              url: `/shop?${filterParam}=${opt.toLowerCase().replace(/\s+/g, '-')}`,
            })),
          });
        } else {
          specs.push({
            label: formatAttributeName(attr.name),
            value: flattenedOptions.map((opt) => formatAttributeValue(opt)).join(', ')
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
      fetchPolicy: 'no-cache',
    });

    const product = data?.product as GraphQLProduct | null;
    if (!product) return null;

    const isVariable = product.type === 'VARIABLE';
    const specifications = extractSpecifications(product, isVariable);

    // Extract brands
    const brandNodes = product.productBrands?.nodes;
    const brands: ProductBrand[] = brandNodes
      ? brandNodes.map((brand: GraphQLBrand) => ({
          id: brand.id,
          name: brand.name,
          slug: brand.slug,
        }))
      : [];

    // Extract dimensions
    const dimensions: ProductDimensions = {
      weight: product.weight || null,
      length: product.length || null,
      width: product.width || null,
      height: product.height || null,
    };

    // Extract gallery images
    const galleryNodes = product.galleryImages?.nodes;
    const galleryImages = galleryNodes
      ? galleryNodes.map((img: GraphQLImage) => ({
          url: img.sourceUrl,
          altText: img.altText || product.name,
        }))
      : undefined;

    // Extract categories
    const categoryNodes = product.productCategories?.nodes;
    const categories = categoryNodes
      ? categoryNodes.map((cat: GraphQLCategory) => ({
          id: cat.id,
          name: cat.name,
          slug: cat.slug,
        }))
      : [];

    // Extract tags
    const tagNodes = product.productTags?.nodes;
    const tags = tagNodes
      ? tagNodes.map((tag: GraphQLTag) => ({
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
        }))
      : undefined;

    // Extract attributes
    const attributeNodes = product.attributes?.nodes;
    const attributes = attributeNodes
      ? attributeNodes.map((attr: GraphQLAttribute) => ({
          name: attr.name,
          options: attr.options || [],
          visible: attr.visible ?? true,
        }))
      : undefined;

    // Extract variations
    const variationNodes = product.variations?.nodes;
    const variations = variationNodes
      ? variationNodes.map((v: GraphQLVariation) => {
          const varAttrNodes = v.attributes?.nodes;
          return {
            id: v.id,
            name: v.name,
            sku: v.sku || null,
            description: v.description || null,
            price: v.price || null,
            regularPrice: v.regularPrice || null,
            salePrice: v.salePrice || null,
            stockStatus: v.stockStatus || 'OUT_OF_STOCK',
            stockQuantity: v.stockQuantity || null,
            weight: v.weight || null,
            length: v.length || null,
            width: v.width || null,
            height: v.height || null,
            attributes: varAttrNodes
              ? varAttrNodes.map((a: GraphQLVariationAttribute) => ({
                  name: a.name,
                  value: a.value,
                }))
              : [],
            image: v.image ? {
              url: v.image.sourceUrl,
              altText: v.image.altText || v.name,
            } : null,
          };
        })
      : undefined;

    // Build gallery array
    const gallery = [
      // Primary image first
      ...(product.image ? [{
        id: product.image.id || '0',
        url: product.image.sourceUrl,
        altText: product.image.altText || product.name,
        isPrimary: true,
      }] : []),
      // Gallery images
      ...(galleryNodes
        ? galleryNodes.map((img: GraphQLImage, index: number) => ({
            id: img.id || String(index + 1),
            url: img.sourceUrl,
            altText: img.altText || product.name,
            isPrimary: false,
          }))
        : []),
    ];

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
      galleryImages,
      categories,
      tags,
      type: product.type || 'SIMPLE',
      averageRating: product.averageRating,
      reviewCount: product.reviewCount,
      attributes,
      variations,
      specifications,
      gallery,
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
      fetchPolicy: 'no-cache',
    });

    return data?.products?.nodes?.map((p: { slug: string }) => p.slug) || [];
  } catch (error) {
    console.error('Error fetching product slugs:', error);
    return [];
  }
}
