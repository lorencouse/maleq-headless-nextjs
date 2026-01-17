#!/usr/bin/env bun
/**
 * Build Category Hierarchy Script
 *
 * Reads categories from data/categories-extracted.json and organizes them
 * by hierarchy level for efficient syncing to WooCommerce.
 *
 * Output: data/category-hierarchy.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { CategoryHierarchy, SourceCategory } from '../lib/williams-trading/types';

interface ExtractedCategory {
  code: string;
  name: string;
  parent: string;
}

interface ExtractedData {
  categories: ExtractedCategory[];
}

function buildCategoryHierarchy(): CategoryHierarchy {
  console.log('📂 Reading categories-extracted.json...');

  // Read source data
  const dataPath = join(process.cwd(), 'data', 'categories-extracted.json');
  const rawData = readFileSync(dataPath, 'utf-8');
  const data: ExtractedData = JSON.parse(rawData);

  console.log(`✅ Loaded ${data.categories.length} categories`);

  // Build a map for quick parent lookups
  const categoryMap = new Map<string, ExtractedCategory>();
  for (const category of data.categories) {
    categoryMap.set(category.code, category);
  }

  // Validate parent relationships
  console.log('🔍 Validating parent relationships...');
  const missingParents: string[] = [];

  for (const category of data.categories) {
    if (category.parent !== '0' && !categoryMap.has(category.parent)) {
      missingParents.push(
        `Category "${category.name}" (${category.code}) references missing parent: ${category.parent}`
      );
    }
  }

  if (missingParents.length > 0) {
    console.error('❌ Found categories with missing parents:');
    missingParents.forEach(msg => console.error(`  - ${msg}`));
    throw new Error('Cannot proceed with invalid parent relationships');
  }

  console.log('✅ All parent relationships are valid');

  // Calculate level for each category
  console.log('📊 Calculating hierarchy levels...');

  interface CategoryWithLevel extends SourceCategory {
    level: number;
  }

  const categoriesWithLevels: CategoryWithLevel[] = [];

  function getLevel(code: string, visited = new Set<string>()): number {
    // Prevent infinite loops
    if (visited.has(code)) {
      throw new Error(`Circular dependency detected for category ${code}`);
    }
    visited.add(code);

    const category = categoryMap.get(code);
    if (!category) {
      throw new Error(`Category ${code} not found`);
    }

    // Top-level category
    if (category.parent === '0') {
      return 0;
    }

    // Recursive: parent's level + 1
    return getLevel(category.parent, visited) + 1;
  }

  let maxLevel = 0;

  for (const category of data.categories) {
    const level = getLevel(category.code);
    maxLevel = Math.max(maxLevel, level);

    categoriesWithLevels.push({
      code: category.code,
      name: category.name,
      parent: category.parent,
      level,
    });
  }

  console.log(`✅ Max hierarchy depth: ${maxLevel + 1} levels (0-${maxLevel})`);

  // Organize by level
  const levels: Record<string, SourceCategory[]> = {};

  for (let i = 0; i <= maxLevel; i++) {
    levels[i.toString()] = categoriesWithLevels
      .filter(cat => cat.level === i)
      .map(cat => ({
        code: cat.code,
        name: cat.name,
        parent: cat.parent,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically
  }

  // Print summary by level
  console.log('\n📋 Category distribution by level:');
  for (let i = 0; i <= maxLevel; i++) {
    const count = levels[i.toString()].length;
    console.log(`  Level ${i}: ${count} categories`);
  }

  // Build final structure
  const hierarchy: CategoryHierarchy = {
    levels,
    maxLevel,
    totalCategories: data.categories.length,
    metadata: {
      generated: new Date().toISOString(),
      source: 'data/categories-extracted.json',
    },
  };

  return hierarchy;
}

function main() {
  console.log('🚀 Building category hierarchy...\n');

  try {
    const hierarchy = buildCategoryHierarchy();

    // Write output file
    const outputPath = join(process.cwd(), 'data', 'category-hierarchy.json');
    writeFileSync(outputPath, JSON.stringify(hierarchy, null, 2), 'utf-8');

    console.log(`\n✅ Successfully created category-hierarchy.json`);
    console.log(`📄 Output: ${outputPath}`);
    console.log(`📊 Total categories: ${hierarchy.totalCategories}`);
    console.log(`📏 Max level: ${hierarchy.maxLevel}`);
    console.log(`⏰ Generated: ${hierarchy.metadata.generated}`);

  } catch (error) {
    console.error('\n❌ Error building category hierarchy:');
    console.error(error);
    process.exit(1);
  }
}

main();
