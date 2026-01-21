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

/**
 * Find the parent category of a given category by slug
 */
export function findParentCategory(
  categories: HierarchicalCategory[],
  childSlug: string,
  parent: HierarchicalCategory | null = null
): { name: string; slug: string } | null {
  for (const cat of categories) {
    // Check if this category is the parent of the target
    if (cat.children.length > 0) {
      const childFound = cat.children.find(child => child.slug === childSlug);
      if (childFound) {
        return { name: cat.name, slug: cat.slug };
      }
      // Recursively search in children
      const foundInChildren = findParentCategory(cat.children, childSlug, cat);
      if (foundInChildren) return foundInChildren;
    }
  }
  return null;
}
