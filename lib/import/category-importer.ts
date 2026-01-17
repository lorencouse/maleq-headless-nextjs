import { wooClient } from '../woocommerce/client';
import type { WooCategory } from '../woocommerce/types';
import { writeFileSync } from 'fs';
import { join } from 'path';
import type { XMLProduct } from './xml-parser';

interface CategoryData {
  code: string;
  name: string;
  parent: string;
}

interface CategoryMapping {
  codeToId: Record<string, number>;
  codeToSlug: Record<string, string>;
  lastUpdated: string;
}

/**
 * Import categories from XML products into WooCommerce
 */
export class CategoryImporter {
  private mappingPath: string;

  constructor() {
    this.mappingPath = join(process.cwd(), 'data', 'category-mapping.json');
  }

  /**
   * Generate slug from category name
   */
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .trim();
  }

  /**
   * Extract all unique categories from products
   */
  extractCategories(products: XMLProduct[]): CategoryData[] {
    const categoryMap = new Map<string, CategoryData>();

    for (const product of products) {
      for (const category of product.categories) {
        if (category.code && !categoryMap.has(category.code)) {
          categoryMap.set(category.code, {
            code: category.code,
            name: category.name,
            parent: category.parent,
          });
        }
      }
    }

    return Array.from(categoryMap.values());
  }

  /**
   * Import categories with proper hierarchy
   */
  async importCategories(categories: CategoryData[]): Promise<{
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
  }> {
    console.log('\n=== IMPORTING CATEGORIES ===\n');
    console.log(`Found ${categories.length} unique categories\n`);

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[],
    };

    const mapping: CategoryMapping = {
      codeToId: {},
      codeToSlug: {},
      lastUpdated: new Date().toISOString(),
    };

    // Get ALL existing categories (fetch in batches)
    console.log('Fetching all existing categories from WooCommerce...');
    const existingCategories: WooCategory[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const batch = await wooClient.getCategories({ per_page: 100, page });
      existingCategories.push(...batch);
      hasMore = batch.length === 100;
      page++;
    }

    const existingBySlug = new Map<string, WooCategory>();
    const existingByName = new Map<string, WooCategory>();

    existingCategories.forEach(cat => {
      if (cat.slug) {
        existingBySlug.set(cat.slug, cat);
      }
      if (cat.name) {
        existingByName.set(cat.name.toLowerCase(), cat);
      }
    });

    console.log(`Found ${existingCategories.length} existing categories in WooCommerce\n`);

    // Sort categories so parents are created before children
    const sortedCategories = this.sortCategoriesByHierarchy(categories);

    // Map categories (only use existing categories, don't create new ones)
    for (const category of sortedCategories) {
      try {
        const slug = this.generateSlug(category.name);

        // Try to find by slug first, then by name
        let existing = existingBySlug.get(slug);
        if (!existing) {
          existing = existingByName.get(category.name.toLowerCase());
        }

        if (existing && existing.id) {
          // Category exists - create mapping
          console.log(`✓ Mapped: ${category.name} (${category.code}) → ID: ${existing.id}`);
          mapping.codeToId[category.code] = existing.id;
          mapping.codeToSlug[category.code] = existing.slug || slug;
          results.skipped++;
        } else {
          // Category doesn't exist - skip it
          console.log(`⊕ Skipped: ${category.name} (${category.code}) - not found in WooCommerce`);
          results.skipped++;
        }
      } catch (error) {
        const errorMsg = `Failed to map ${category.name} (${category.code}): ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
        console.error(`✗ ${errorMsg}`);
        results.errors.push(errorMsg);
      }
    }

    // Save mapping
    this.saveMapping(mapping);

    // Print summary
    console.log('\n=== CATEGORY MAPPING SUMMARY ===');
    console.log(`✓ Mapped: ${results.skipped}`);
    console.log(`✗ Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      console.log('\nErrors:');
      results.errors.forEach(err => console.log(`  - ${err}`));
    }

    return results;
  }

  /**
   * Sort categories so parents come before children
   */
  private sortCategoriesByHierarchy(categories: CategoryData[]): CategoryData[] {
    const sorted: CategoryData[] = [];
    const remaining = [...categories];
    const processed = new Set<string>();

    // Add root categories (parent = '0') first
    const roots = remaining.filter(cat => cat.parent === '0');
    sorted.push(...roots);
    roots.forEach(cat => processed.add(cat.code));

    // Iteratively add children whose parents have been processed
    let iterations = 0;
    const maxIterations = 100; // Prevent infinite loops

    while (remaining.length > sorted.length && iterations < maxIterations) {
      iterations++;

      for (const category of remaining) {
        if (!processed.has(category.code)) {
          // Add if parent is processed or parent doesn't exist
          if (category.parent === '0' || processed.has(category.parent)) {
            sorted.push(category);
            processed.add(category.code);
          }
        }
      }
    }

    // Add any remaining categories (orphans or circular references)
    for (const category of remaining) {
      if (!processed.has(category.code)) {
        console.warn(`Warning: Category ${category.name} (${category.code}) has invalid parent ${category.parent}`);
        sorted.push(category);
      }
    }

    return sorted;
  }

  /**
   * Save category mapping to file
   */
  private saveMapping(mapping: CategoryMapping): void {
    writeFileSync(this.mappingPath, JSON.stringify(mapping, null, 2), 'utf-8');
    console.log(`✓ Category mapping saved to ${this.mappingPath}`);
  }

  /**
   * Load category mapping from file
   */
  loadMapping(): CategoryMapping | null {
    try {
      const { readFileSync } = require('fs');
      const raw = readFileSync(this.mappingPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
