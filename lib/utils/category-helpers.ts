import type { HierarchicalCategory } from '@/lib/products/combined-service';

/**
 * Recursively find a category by slug in the hierarchical category tree
 */
export function findCategoryBySlug(
  categories: HierarchicalCategory[],
  slug: string
): HierarchicalCategory | undefined {
  for (const cat of categories) {
    if (cat.slug === slug) return cat;
    if (cat.children.length > 0) {
      const found = findCategoryBySlug(cat.children, slug);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Flatten hierarchical categories into a single-level array
 */
export function flattenCategories(categories: HierarchicalCategory[]): HierarchicalCategory[] {
  return categories.reduce((acc: HierarchicalCategory[], cat) => {
    acc.push(cat);
    if (cat.children.length > 0) {
      acc.push(...flattenCategories(cat.children));
    }
    return acc;
  }, []);
}
