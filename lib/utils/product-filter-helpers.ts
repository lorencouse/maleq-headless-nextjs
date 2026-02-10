import type { UnifiedProduct, FilterOption } from '@/lib/products/combined-service';

/**
 * Extract available filter options (brands, materials, colors) from a list of products.
 * Used by both the server-side shop page and the client-side ShopPageClient.
 */
export function extractFilterOptionsFromProducts(products: UnifiedProduct[]): {
  brands: FilterOption[];
  materials: FilterOption[];
  colors: FilterOption[];
} {
  const brandMap = new Map<string, { name: string; slug: string; count: number }>();
  const materialMap = new Map<string, { name: string; slug: string; count: number }>();
  const colorMap = new Map<string, { name: string; slug: string; count: number }>();

  for (const product of products) {
    if (product.brands) {
      for (const brand of product.brands) {
        const existing = brandMap.get(brand.slug);
        if (existing) {
          existing.count++;
        } else {
          brandMap.set(brand.slug, { name: brand.name, slug: brand.slug, count: 1 });
        }
      }
    }

    if (product.materials) {
      for (const material of product.materials) {
        const existing = materialMap.get(material.slug);
        if (existing) {
          existing.count++;
        } else {
          materialMap.set(material.slug, { name: material.name, slug: material.slug, count: 1 });
        }
      }
    }

    if (product.attributes) {
      for (const attr of product.attributes) {
        const attrNameLower = attr.name.toLowerCase();
        if (attrNameLower === 'color' || attrNameLower === 'pa_color') {
          for (const option of attr.options) {
            const slug = option.toLowerCase().replace(/\s+/g, '-');
            const existing = colorMap.get(slug);
            if (existing) {
              existing.count++;
            } else {
              colorMap.set(slug, { name: option, slug, count: 1 });
            }
          }
        }
      }
    }
  }

  return {
    brands: Array.from(brandMap.values())
      .map(b => ({ id: b.slug, name: b.name, slug: b.slug, count: b.count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    materials: Array.from(materialMap.values())
      .map(m => ({ id: m.slug, name: m.name, slug: m.slug, count: m.count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    colors: Array.from(colorMap.values())
      .map(c => ({ id: c.slug, name: c.name, slug: c.slug, count: c.count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
