#!/usr/bin/env bun

/**
 * Direct SQL Category Import Script
 *
 * Imports categories directly into WordPress/WooCommerce MySQL database
 * Maintains parent-child hierarchies using the product_cat taxonomy
 *
 * Usage:
 *   bun scripts/import-categories-direct.ts [options]
 *
 * Options:
 *   --dry-run             Show what would be imported without making changes
 */

import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import mysql from 'mysql2/promise';

// Local by Flywheel MySQL connection
const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

interface CategoryData {
  code: string;
  name: string;
  parent: string;
}

interface ImportOptions {
  dryRun: boolean;
}

interface CategoryMapping {
  codeToId: Record<string, number>;
  codeToSlug: Record<string, string>;
  lastUpdated: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const options: ImportOptions = {
    dryRun: false,
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Direct SQL Category Import Script

Usage:
  bun scripts/import-categories-direct.ts [options]

Options:
  --dry-run             Show what would be imported without making changes
  --help, -h            Show this help message
      `);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Generate URL-friendly slug from name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim()
    .substring(0, 200);
}

/**
 * Main import class
 */
class DirectCategoryImporter {
  private connection: mysql.Connection | null = null;
  private options: ImportOptions;
  private codeToTermId: Map<string, number> = new Map();
  private slugCounter: Map<string, number> = new Map();

  constructor(options: ImportOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    this.connection = await mysql.createConnection({
      socketPath: LOCAL_MYSQL_SOCKET,
      user: LOCAL_DB_USER,
      password: LOCAL_DB_PASS,
      database: LOCAL_DB_NAME,
    });
    console.log('✓ Connected to Local MySQL database\n');
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
    }
  }

  /**
   * Check if a category already exists by slug
   */
  async categoryExistsBySlug(slug: string): Promise<number | null> {
    if (!this.connection) throw new Error('Not connected');

    const [rows] = await this.connection.execute(
      `SELECT t.term_id
       FROM wp_terms t
       JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
       WHERE t.slug = ? AND tt.taxonomy = 'product_cat'`,
      [slug]
    );

    return (rows as any[]).length > 0 ? (rows as any[])[0].term_id : null;
  }

  /**
   * Check if a category already exists by name
   */
  async categoryExistsByName(name: string): Promise<{ termId: number; slug: string } | null> {
    if (!this.connection) throw new Error('Not connected');

    const [rows] = await this.connection.execute(
      `SELECT t.term_id, t.slug
       FROM wp_terms t
       JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
       WHERE t.name = ? AND tt.taxonomy = 'product_cat'`,
      [name]
    );

    if ((rows as any[]).length > 0) {
      return {
        termId: (rows as any[])[0].term_id,
        slug: (rows as any[])[0].slug,
      };
    }
    return null;
  }

  /**
   * Get unique slug (append number if already exists)
   */
  async getUniqueSlug(baseSlug: string): Promise<string> {
    let slug = baseSlug;
    let counter = this.slugCounter.get(baseSlug) || 0;

    while (await this.categoryExistsBySlug(slug)) {
      counter++;
      slug = `${baseSlug}-${counter}`;
    }

    this.slugCounter.set(baseSlug, counter);
    return slug;
  }

  /**
   * Import a single category
   */
  async importCategory(
    category: CategoryData,
    parentTermId: number
  ): Promise<{ termId: number; slug: string } | null> {
    if (!this.connection) throw new Error('Not connected');

    // Check if category already exists by name
    const existing = await this.categoryExistsByName(category.name);
    if (existing) {
      this.codeToTermId.set(category.code, existing.termId);
      return existing;
    }

    const baseSlug = generateSlug(category.name);
    const slug = await this.getUniqueSlug(baseSlug);

    if (this.options.dryRun) {
      // In dry run, use a fake term ID for tracking hierarchy
      const fakeTermId = parseInt(category.code) + 100000;
      this.codeToTermId.set(category.code, fakeTermId);
      const parentInfo = parentTermId > 0 ? ` (parent: ${parentTermId})` : ' (root)';
      console.log(`[DRY RUN] Would create: ${category.name} (${category.code})${parentInfo}`);
      return { termId: fakeTermId, slug };
    }

    try {
      // Create term in wp_terms
      const [termResult] = await this.connection.execute(
        `INSERT INTO wp_terms (name, slug, term_group) VALUES (?, ?, 0)`,
        [category.name, slug]
      );
      const termId = (termResult as any).insertId;

      // Create term taxonomy entry with parent
      await this.connection.execute(
        `INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count)
         VALUES (?, 'product_cat', ?, ?, 0)`,
        [termId, `Category code: ${category.code}`, parentTermId]
      );

      this.codeToTermId.set(category.code, termId);
      return { termId, slug };
    } catch (error) {
      console.error(`  ✗ Error creating ${category.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Sort categories so parents are created before children
   */
  sortCategoriesByHierarchy(categories: CategoryData[]): CategoryData[] {
    const sorted: CategoryData[] = [];
    const remaining = [...categories];
    const processed = new Set<string>();

    // Add root categories (parent = '0') first
    const roots = remaining.filter(cat => cat.parent === '0');
    sorted.push(...roots);
    roots.forEach(cat => processed.add(cat.code));

    // Iteratively add children whose parents have been processed
    let iterations = 0;
    const maxIterations = 100;

    while (remaining.length > sorted.length && iterations < maxIterations) {
      iterations++;

      for (const category of remaining) {
        if (!processed.has(category.code)) {
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
   * Import all categories
   */
  async importCategories(categories: CategoryData[]): Promise<{
    created: number;
    skipped: number;
    errors: number;
    mapping: CategoryMapping;
  }> {
    const results = {
      created: 0,
      skipped: 0,
      errors: 0,
      mapping: {
        codeToId: {} as Record<string, number>,
        codeToSlug: {} as Record<string, string>,
        lastUpdated: new Date().toISOString(),
      },
    };

    // Sort categories so parents come before children
    const sortedCategories = this.sortCategoriesByHierarchy(categories);

    console.log(`Importing ${sortedCategories.length} categories...\n`);

    // Count hierarchy levels
    const rootCount = sortedCategories.filter(c => c.parent === '0').length;
    const childCount = sortedCategories.length - rootCount;
    console.log(`  Root categories: ${rootCount}`);
    console.log(`  Child categories: ${childCount}\n`);

    for (const category of sortedCategories) {
      // Determine parent term ID
      let parentTermId = 0;
      if (category.parent !== '0') {
        const parentId = this.codeToTermId.get(category.parent);
        if (parentId) {
          parentTermId = parentId;
        } else {
          console.warn(`  ⚠ Parent ${category.parent} not found for ${category.name}, using root`);
        }
      }

      // Check if already exists
      const existing = await this.categoryExistsByName(category.name);

      if (existing) {
        results.mapping.codeToId[category.code] = existing.termId;
        results.mapping.codeToSlug[category.code] = existing.slug;
        this.codeToTermId.set(category.code, existing.termId);
        results.skipped++;
        continue;
      }

      const result = await this.importCategory(category, parentTermId);

      if (result) {
        if (!this.options.dryRun) {
          const parentInfo = parentTermId > 0 ? ` (parent: ${parentTermId})` : ' (root)';
          console.log(`✓ Created: ${category.name} (${category.code}) → ID: ${result.termId}${parentInfo}`);
        }
        results.mapping.codeToId[category.code] = result.termId;
        results.mapping.codeToSlug[category.code] = result.slug;
        results.created++;
      } else {
        results.errors++;
      }
    }

    return results;
  }

  /**
   * Update category counts based on actual product assignments
   */
  async updateCategoryCounts(): Promise<void> {
    if (!this.connection || this.options.dryRun) return;

    console.log('\nUpdating category counts...');

    // This updates the count field in wp_term_taxonomy based on actual product assignments
    await this.connection.execute(`
      UPDATE wp_term_taxonomy tt
      SET count = (
        SELECT COUNT(*)
        FROM wp_term_relationships tr
        WHERE tr.term_taxonomy_id = tt.term_taxonomy_id
      )
      WHERE tt.taxonomy = 'product_cat'
    `);

    console.log('✓ Category counts updated');
  }

  /**
   * Rebuild the product_cat_children option cache
   * WooCommerce uses this to display category hierarchies
   */
  async rebuildChildrenCache(): Promise<void> {
    if (!this.connection || this.options.dryRun) return;

    console.log('Rebuilding category hierarchy cache...');

    // Get all parent-child relationships
    const [rows] = await this.connection.execute(`
      SELECT tt.parent as parent_id, tt.term_id as child_id
      FROM wp_term_taxonomy tt
      WHERE tt.taxonomy = 'product_cat' AND tt.parent > 0
      ORDER BY tt.parent, tt.term_id
    `);

    // Build children map
    const children = new Map<number, number[]>();
    for (const row of rows as any[]) {
      if (!children.has(row.parent_id)) {
        children.set(row.parent_id, []);
      }
      children.get(row.parent_id)!.push(row.child_id);
    }

    // Serialize to PHP format
    let serialized = `a:${children.size}:{`;
    for (const [parentId, childIds] of children) {
      serialized += `i:${parentId};a:${childIds.length}:{`;
      childIds.forEach((childId, idx) => {
        serialized += `i:${idx};i:${childId};`;
      });
      serialized += `}`;
    }
    serialized += `}`;

    // Update or insert the option
    const [existing] = await this.connection.execute(
      `SELECT option_id FROM wp_options WHERE option_name = 'product_cat_children'`
    );

    if ((existing as any[]).length > 0) {
      await this.connection.execute(
        `UPDATE wp_options SET option_value = ? WHERE option_name = 'product_cat_children'`,
        [serialized]
      );
    } else {
      await this.connection.execute(
        `INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('product_cat_children', ?, 'yes')`,
        [serialized]
      );
    }

    // Clear WooCommerce transient caches
    await this.connection.execute(`
      DELETE FROM wp_options
      WHERE option_name LIKE '_transient%wc_term%'
      OR option_name LIKE '_transient%product_cat%'
      OR option_name LIKE '_transient%woocommerce%'
    `);

    console.log(`✓ Category hierarchy cache rebuilt (${children.size} parent categories)`);
  }
}

/**
 * Main function
 */
async function main() {
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Direct SQL Category Import            ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Dry Run: ${options.dryRun}`);
  console.log();

  // Load categories from JSON
  const categoriesPath = join(process.cwd(), 'data', 'categories-extracted.json');
  console.log(`Loading categories from: ${categoriesPath}`);

  const raw = readFileSync(categoriesPath, 'utf-8');
  const data = JSON.parse(raw);
  const categories: CategoryData[] = data.categories || [];

  console.log(`✓ Loaded ${categories.length} categories from JSON\n`);

  // Import categories
  const importer = new DirectCategoryImporter(options);

  try {
    await importer.connect();
    const results = await importer.importCategories(categories);

    // Update category counts
    await importer.updateCategoryCounts();

    // Rebuild children cache for WooCommerce hierarchy display
    await importer.rebuildChildrenCache();

    // Print summary
    console.log('\n=== IMPORT SUMMARY ===');
    console.log(`Created: ${results.created}`);
    console.log(`Skipped (already exist): ${results.skipped}`);
    console.log(`Errors: ${results.errors}`);

    // Save mapping
    if (!options.dryRun) {
      const mappingPath = join(process.cwd(), 'data', 'category-mapping.json');
      writeFileSync(mappingPath, JSON.stringify(results.mapping, null, 2), 'utf-8');
      console.log(`\n✓ Mapping saved to: ${mappingPath}`);
      console.log(`  Total mappings: ${Object.keys(results.mapping.codeToId).length}`);
    }

  } finally {
    await importer.disconnect();
  }

  console.log('\n✓ Import completed successfully');
}

main().catch(error => {
  console.error('\n✗ Import failed:', error);
  process.exit(1);
});
