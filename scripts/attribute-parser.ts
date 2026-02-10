/**
 * Attribute Parser Script
 * Extracts missing taxonomy data from product titles, descriptions, and existing data
 *
 * Uses shared extraction utilities from lib/import/attribute-extractor.ts
 * to ensure consistency with the product importer.
 *
 * Usage:
 *   bun run scripts/attribute-parser.ts --analyze    # Analyze and show extraction results
 *   bun run scripts/attribute-parser.ts --test       # Test extraction on sample products
 *   bun run scripts/attribute-parser.ts --dry-run    # Show what would be updated
 *   bun run scripts/attribute-parser.ts --apply      # Apply extracted data to database
 */

import {
  extractDimensions,
  extractWeight,
  extractMaterialsFromText,
  extractColorsFromText,
  type ExtractedAttributes,
  type ExtractedDimensions,
  type ExtractedWeight,
} from '../lib/import/attribute-extractor';

interface ProductData {
  id: number;
  title: string;
  description: string;
  existingMaterials?: string;
  existingColor?: string;
  existingLength?: string;
  existingWidth?: string;
  existingHeight?: string;
  existingWeight?: string;
}

// Local interface for this script's needs (extends shared types)
interface ScriptExtractedAttributes {
  materials: string[];
  colors: string[];
  dimensions: ExtractedDimensions;
  weight?: ExtractedWeight;
  size?: string;
  volume?: {
    value: number;
    unit: string;
  };
}

// ==================== VOLUME/SIZE PATTERNS (script-specific) ====================

const VOLUME_PATTERNS = [
  /(\d+(?:\.\d+)?)\s*(?:fluid\s+)?(?:ounces?|oz\.?)\b/gi,
  /(\d+(?:\.\d+)?)\s*(?:ml|milliliters?)\b/gi,
  /(\d+(?:\.\d+)?)\s*(?:liters?|l)\b/gi,
];

const SIZE_PATTERNS = [
  /size[:\s]+([XSML]+(?:\/[XSML]+)?|small|medium|large|x-?large|xx-?large|one\s+size)/gi,
  /\b(small|medium|large|x-?large|xx-?large|one\s+size(?:\s+fits\s+(?:all|most))?)\b/gi,
];

// ==================== SCRIPT-SPECIFIC EXTRACTION FUNCTIONS ====================

/**
 * Extract volume from text
 */
function extractVolume(text: string, title: string): ScriptExtractedAttributes['volume'] | undefined {
  const combinedText = `${title} ${text}`;

  for (const pattern of VOLUME_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(combinedText);
    if (match && match[1]) {
      const value = parseFloat(match[1]);
      if (!isNaN(value) && value > 0) {
        const matchLower = match[0].toLowerCase();
        let unit = 'oz';
        if (matchLower.includes('ml') || matchLower.includes('milliliter')) {
          unit = 'ml';
        } else if (matchLower.includes('liter') || matchLower.match(/\bl\b/)) {
          unit = 'L';
        }
        return { value, unit };
      }
    }
  }

  return undefined;
}

/**
 * Extract size from text
 */
function extractSize(text: string, title: string): string | undefined {
  const combinedText = `${title} ${text}`;

  for (const pattern of SIZE_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(combinedText);
    if (match && match[1]) {
      const size = match[1].toUpperCase()
        .replace('X-LARGE', 'XL')
        .replace('XX-LARGE', 'XXL')
        .replace('SMALL', 'S')
        .replace('MEDIUM', 'M')
        .replace('LARGE', 'L');
      return size;
    }
  }

  return undefined;
}

/**
 * Extract all attributes from a product using shared extraction utilities
 */
function extractAttributes(product: ProductData): ScriptExtractedAttributes {
  const { title, description } = product;

  return {
    materials: extractMaterialsFromText(description),
    colors: extractColorsFromText(description, title),
    dimensions: extractDimensions(description),
    weight: extractWeight(description),
    size: extractSize(description, title),
    volume: extractVolume(description, title),
  };
}

// ==================== DATABASE INTERACTION ====================

import { config } from './lib/db';

/**
 * Execute a MySQL query and return results
 */
async function queryMySQL(sql: string): Promise<string> {
  const { $ } = await import('bun');
  const result = await $`mysql --socket="${config.socketPath}" -u ${config.user} -p${config.password} ${config.database} -e ${sql} 2>/dev/null`.text();
  return result;
}

/**
 * Parse MySQL tabular output into objects
 */
function parseMySQLOutput(output: string): Record<string, string>[] {
  const lines = output.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split('\t');
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Fetch products from database
 */
async function fetchProducts(limit: number = 100, offset: number = 0): Promise<ProductData[]> {
  const sql = `
    SELECT
      p.ID as id,
      p.post_title as title,
      p.post_content as description,
      MAX(CASE WHEN pm.meta_key = '_wt_material' THEN pm.meta_value END) as existingMaterials,
      MAX(CASE WHEN pm.meta_key = '_wt_color' THEN pm.meta_value END) as existingColor
    FROM wp_posts p
    LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
      AND pm.meta_key IN ('_wt_material', '_wt_color')
    WHERE p.post_type = 'product'
    AND p.post_status = 'publish'
    GROUP BY p.ID, p.post_title, p.post_content
    ORDER BY p.ID
    LIMIT ${limit} OFFSET ${offset}
  `;

  const output = await queryMySQL(sql);
  const rows = parseMySQLOutput(output);

  return rows.map(row => ({
    id: parseInt(row.id),
    title: row.title,
    description: row.description,
    existingMaterials: row.existingMaterials,
    existingColor: row.existingColor,
  }));
}

/**
 * Get count of products
 */
async function getProductCount(): Promise<number> {
  const sql = `
    SELECT COUNT(*) as count
    FROM wp_posts
    WHERE post_type = 'product'
    AND post_status = 'publish'
  `;

  const output = await queryMySQL(sql);
  const rows = parseMySQLOutput(output);
  return parseInt(rows[0]?.count || '0');
}

// ==================== ANALYSIS AND REPORTING ====================

interface AnalysisResults {
  totalProducts: number;
  productsWithExtractedMaterials: number;
  productsWithExtractedColors: number;
  productsWithExtractedDimensions: number;
  materialFrequency: Map<string, number>;
  colorFrequency: Map<string, number>;
  sampleExtractions: Array<{
    id: number;
    title: string;
    extracted: ExtractedAttributes;
  }>;
}

/**
 * Analyze products and show extraction statistics
 */
async function analyzeProducts(sampleSize: number = 500): Promise<AnalysisResults> {
  console.log('Fetching products for analysis...');

  const products = await fetchProducts(sampleSize);
  const results: AnalysisResults = {
    totalProducts: products.length,
    productsWithExtractedMaterials: 0,
    productsWithExtractedColors: 0,
    productsWithExtractedDimensions: 0,
    materialFrequency: new Map(),
    colorFrequency: new Map(),
    sampleExtractions: [],
  };

  console.log(`Analyzing ${products.length} products...`);

  for (const product of products) {
    const extracted = extractAttributes(product);

    // Count products with extracted data
    if (extracted.materials.length > 0) {
      results.productsWithExtractedMaterials++;
      extracted.materials.forEach(m => {
        results.materialFrequency.set(m, (results.materialFrequency.get(m) || 0) + 1);
      });
    }

    if (extracted.colors.length > 0) {
      results.productsWithExtractedColors++;
      extracted.colors.forEach(c => {
        results.colorFrequency.set(c, (results.colorFrequency.get(c) || 0) + 1);
      });
    }

    if (Object.keys(extracted.dimensions).length > 0) {
      results.productsWithExtractedDimensions++;
    }

    // Collect samples
    if (results.sampleExtractions.length < 20 &&
        (extracted.materials.length > 0 || extracted.colors.length > 0 || Object.keys(extracted.dimensions).length > 0)) {
      results.sampleExtractions.push({
        id: product.id,
        title: product.title,
        extracted,
      });
    }
  }

  return results;
}

/**
 * Print analysis results
 */
function printAnalysisResults(results: AnalysisResults): void {
  console.log('\n========================================');
  console.log('         EXTRACTION ANALYSIS');
  console.log('========================================\n');

  console.log(`Total products analyzed: ${results.totalProducts}`);
  console.log(`Products with extractable materials: ${results.productsWithExtractedMaterials} (${(results.productsWithExtractedMaterials / results.totalProducts * 100).toFixed(1)}%)`);
  console.log(`Products with extractable colors: ${results.productsWithExtractedColors} (${(results.productsWithExtractedColors / results.totalProducts * 100).toFixed(1)}%)`);
  console.log(`Products with extractable dimensions: ${results.productsWithExtractedDimensions} (${(results.productsWithExtractedDimensions / results.totalProducts * 100).toFixed(1)}%)`);

  console.log('\n--- Top 20 Extracted Materials ---');
  const sortedMaterials = Array.from(results.materialFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  sortedMaterials.forEach(([material, count]) => {
    console.log(`  ${material}: ${count}`);
  });

  console.log('\n--- Top 20 Extracted Colors ---');
  const sortedColors = Array.from(results.colorFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  sortedColors.forEach(([color, count]) => {
    console.log(`  ${color}: ${count}`);
  });

  console.log('\n--- Sample Extractions ---');
  results.sampleExtractions.slice(0, 10).forEach(sample => {
    console.log(`\n[${sample.id}] ${sample.title}`);
    if (sample.extracted.materials.length > 0) {
      console.log(`  Materials: ${sample.extracted.materials.join(', ')}`);
    }
    if (sample.extracted.colors.length > 0) {
      console.log(`  Colors: ${sample.extracted.colors.join(', ')}`);
    }
    if (Object.keys(sample.extracted.dimensions).length > 0) {
      console.log(`  Dimensions: ${JSON.stringify(sample.extracted.dimensions)}`);
    }
    if (sample.extracted.weight) {
      console.log(`  Weight: ${sample.extracted.weight.value} ${sample.extracted.weight.unit}`);
    }
    if (sample.extracted.volume) {
      console.log(`  Volume: ${sample.extracted.volume.value} ${sample.extracted.volume.unit}`);
    }
  });
}

// ==================== TAXONOMY ASSIGNMENT ====================

interface ProductUpdate {
  id: number;
  title: string;
  materials: string[];
  colors: string[];
  dimensions: ExtractedAttributes['dimensions'];
  weight?: ExtractedAttributes['weight'];
  hasMissingMaterials: boolean;
  hasMissingColors: boolean;
}

/**
 * Fetch products that are missing material taxonomy assignments
 */
async function fetchProductsMissingMaterials(limit: number = 1000): Promise<ProductData[]> {
  const sql = `
    SELECT
      p.ID as id,
      p.post_title as title,
      p.post_content as description,
      MAX(CASE WHEN pm.meta_key = '_wt_material' THEN pm.meta_value END) as existingMaterials,
      MAX(CASE WHEN pm.meta_key = '_wt_color' THEN pm.meta_value END) as existingColor
    FROM wp_posts p
    LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
      AND pm.meta_key IN ('_wt_material', '_wt_color')
    LEFT JOIN wp_term_relationships tr ON p.ID = tr.object_id
    LEFT JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
      AND tt.taxonomy = 'product_material'
    WHERE p.post_type = 'product'
    AND p.post_status = 'publish'
    AND tt.term_taxonomy_id IS NULL
    GROUP BY p.ID, p.post_title, p.post_content
    ORDER BY p.ID
    LIMIT ${limit}
  `;

  const output = await queryMySQL(sql);
  const rows = parseMySQLOutput(output);

  return rows.map(row => ({
    id: parseInt(row.id),
    title: row.title,
    description: row.description,
    existingMaterials: row.existingMaterials,
    existingColor: row.existingColor,
  }));
}

/**
 * Get or create a taxonomy term and return its ID
 */
async function getOrCreateTerm(name: string, taxonomy: string): Promise<number | null> {
  const escapedName = name.replace(/'/g, "''");

  // First, try to find existing term
  const findSql = `
    SELECT t.term_id
    FROM wp_terms t
    JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
    WHERE t.name = '${escapedName}'
    AND tt.taxonomy = '${taxonomy}'
    LIMIT 1
  `;

  const findOutput = await queryMySQL(findSql);
  const findRows = parseMySQLOutput(findOutput);

  if (findRows.length > 0 && findRows[0].term_id) {
    return parseInt(findRows[0].term_id);
  }

  // Create new term
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const insertTermSql = `
    INSERT INTO wp_terms (name, slug)
    VALUES ('${escapedName}', '${slug}')
  `;

  await queryMySQL(insertTermSql);

  // Get the inserted term ID
  const getIdSql = `SELECT LAST_INSERT_ID() as id`;
  const idOutput = await queryMySQL(getIdSql);
  const idRows = parseMySQLOutput(idOutput);
  const termId = parseInt(idRows[0]?.id || '0');

  if (termId === 0) return null;

  // Create term taxonomy entry
  const insertTaxSql = `
    INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count)
    VALUES (${termId}, '${taxonomy}', '', 0, 0)
  `;

  await queryMySQL(insertTaxSql);

  return termId;
}

/**
 * Assign a taxonomy term to a product
 */
async function assignTermToProduct(productId: number, termId: number): Promise<void> {
  // Get term_taxonomy_id
  const getTtIdSql = `
    SELECT term_taxonomy_id
    FROM wp_term_taxonomy
    WHERE term_id = ${termId}
    LIMIT 1
  `;

  const ttOutput = await queryMySQL(getTtIdSql);
  const ttRows = parseMySQLOutput(ttOutput);

  if (ttRows.length === 0) return;

  const termTaxonomyId = parseInt(ttRows[0].term_taxonomy_id);

  // Check if relationship already exists
  const checkSql = `
    SELECT object_id
    FROM wp_term_relationships
    WHERE object_id = ${productId}
    AND term_taxonomy_id = ${termTaxonomyId}
    LIMIT 1
  `;

  const checkOutput = await queryMySQL(checkSql);
  const checkRows = parseMySQLOutput(checkOutput);

  if (checkRows.length > 0) return; // Already assigned

  // Create relationship
  const insertSql = `
    INSERT INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
    VALUES (${productId}, ${termTaxonomyId}, 0)
  `;

  await queryMySQL(insertSql);

  // Update term count
  const updateCountSql = `
    UPDATE wp_term_taxonomy
    SET count = count + 1
    WHERE term_taxonomy_id = ${termTaxonomyId}
  `;

  await queryMySQL(updateCountSql);
}

/**
 * Update product meta value
 */
async function updateProductMeta(productId: number, metaKey: string, metaValue: string): Promise<void> {
  const escapedValue = metaValue.replace(/'/g, "''");

  // Check if meta exists
  const checkSql = `
    SELECT meta_id
    FROM wp_postmeta
    WHERE post_id = ${productId}
    AND meta_key = '${metaKey}'
    LIMIT 1
  `;

  const checkOutput = await queryMySQL(checkSql);
  const checkRows = parseMySQLOutput(checkOutput);

  if (checkRows.length > 0) {
    // Update existing
    const updateSql = `
      UPDATE wp_postmeta
      SET meta_value = '${escapedValue}'
      WHERE post_id = ${productId}
      AND meta_key = '${metaKey}'
    `;
    await queryMySQL(updateSql);
  } else {
    // Insert new
    const insertSql = `
      INSERT INTO wp_postmeta (post_id, meta_key, meta_value)
      VALUES (${productId}, '${metaKey}', '${escapedValue}')
    `;
    await queryMySQL(insertSql);
  }
}

/**
 * Update product dimensions
 */
async function updateProductDimensions(productId: number, dimensions: ExtractedAttributes['dimensions']): Promise<void> {
  if (dimensions.length) {
    await updateProductMeta(productId, '_length', dimensions.length.toString());
  }
  if (dimensions.width) {
    await updateProductMeta(productId, '_width', dimensions.width.toString());
  }
  if (dimensions.height) {
    await updateProductMeta(productId, '_height', dimensions.height.toString());
  }
}

/**
 * Update product weight (convert to standard unit - WooCommerce uses shop settings)
 */
async function updateProductWeight(productId: number, weight: ExtractedAttributes['weight']): Promise<void> {
  if (!weight) return;

  // WooCommerce typically stores weight in the shop's weight unit
  // We'll store as ounces for consistency with the description
  // Convert to lbs if needed (0.0625 lbs = 1 oz)
  const weightInLbs = weight.valueInOz / 16;
  await updateProductMeta(productId, '_weight', weightInLbs.toFixed(2));
}

/**
 * Dry run - show proposed changes without applying them
 */
async function runDryRun(): Promise<void> {
  console.log('Dry run - analyzing products for potential updates...\n');

  const products = await fetchProductsMissingMaterials(500);
  console.log(`Found ${products.length} products missing material taxonomy\n`);

  const updates: ProductUpdate[] = [];

  for (const product of products) {
    const extracted = extractAttributes(product);

    // Only include products where we can extract something useful
    if (extracted.materials.length > 0 || extracted.colors.length > 0 || Object.keys(extracted.dimensions).length > 0 || extracted.weight) {
      updates.push({
        id: product.id,
        title: product.title,
        materials: extracted.materials,
        colors: extracted.colors,
        dimensions: extracted.dimensions,
        weight: extracted.weight,
        hasMissingMaterials: !product.existingMaterials || product.existingMaterials === 'NULL',
        hasMissingColors: !product.existingColor || product.existingColor === 'NULL',
      });
    }
  }

  console.log(`\n========================================`);
  console.log(`         DRY RUN SUMMARY`);
  console.log(`========================================\n`);

  console.log(`Products with extractable data: ${updates.length}`);
  console.log(`Products that would receive material taxonomy: ${updates.filter(u => u.materials.length > 0).length}`);
  console.log(`Products that would receive color data: ${updates.filter(u => u.colors.length > 0 && u.hasMissingColors).length}`);
  console.log(`Products that would receive dimensions: ${updates.filter(u => Object.keys(u.dimensions).length > 0).length}`);
  console.log(`Products that would receive weight: ${updates.filter(u => u.weight).length}`);

  console.log('\n--- Sample Updates (first 20) ---');
  updates.slice(0, 20).forEach(update => {
    console.log(`\n[${update.id}] ${update.title}`);
    if (update.materials.length > 0) {
      console.log(`  + Materials: ${update.materials.join(', ')}`);
    }
    if (update.colors.length > 0 && update.hasMissingColors) {
      console.log(`  + Colors: ${update.colors.join(', ')}`);
    }
    if (Object.keys(update.dimensions).length > 0) {
      console.log(`  + Dimensions: ${JSON.stringify(update.dimensions)}`);
    }
    if (update.weight) {
      console.log(`  + Weight: ${update.weight.value} ${update.weight.unit}`);
    }
  });

  console.log('\n\nTo apply these changes, run with --apply flag');
}

/**
 * Fetch all products with pagination (for full processing)
 */
async function fetchAllProducts(limit: number, offset: number): Promise<ProductData[]> {
  const sql = `
    SELECT
      p.ID as id,
      p.post_title as title,
      p.post_content as description,
      MAX(CASE WHEN pm.meta_key = '_wt_material' THEN pm.meta_value END) as existingMaterials,
      MAX(CASE WHEN pm.meta_key = '_wt_color' THEN pm.meta_value END) as existingColor,
      MAX(CASE WHEN pm.meta_key = '_length' THEN pm.meta_value END) as existingLength,
      MAX(CASE WHEN pm.meta_key = '_width' THEN pm.meta_value END) as existingWidth,
      MAX(CASE WHEN pm.meta_key = '_height' THEN pm.meta_value END) as existingHeight,
      MAX(CASE WHEN pm.meta_key = '_weight' THEN pm.meta_value END) as existingWeight
    FROM wp_posts p
    LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
      AND pm.meta_key IN ('_wt_material', '_wt_color', '_length', '_width', '_height', '_weight')
    WHERE p.post_type = 'product'
    AND p.post_status = 'publish'
    GROUP BY p.ID, p.post_title, p.post_content
    ORDER BY p.ID
    LIMIT ${limit} OFFSET ${offset}
  `;

  const output = await queryMySQL(sql);
  const rows = parseMySQLOutput(output);

  return rows.map(row => ({
    id: parseInt(row.id),
    title: row.title,
    description: row.description,
    existingMaterials: row.existingMaterials,
    existingColor: row.existingColor,
    existingLength: row.existingLength,
    existingWidth: row.existingWidth,
    existingHeight: row.existingHeight,
    existingWeight: row.existingWeight,
  })) as ProductData[];
}

/**
 * Check if product already has material taxonomy assigned
 */
async function hasProductMaterialTaxonomy(productId: number): Promise<boolean> {
  const sql = `
    SELECT 1
    FROM wp_term_relationships tr
    JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
    WHERE tr.object_id = ${productId}
    AND tt.taxonomy = 'product_material'
    LIMIT 1
  `;
  const output = await queryMySQL(sql);
  const rows = parseMySQLOutput(output);
  return rows.length > 0;
}

/**
 * Apply extracted data to database
 */
async function applyChanges(): Promise<void> {
  console.log('Applying extracted data to database...\n');

  // Get total count of products
  const totalCount = await getProductCount();
  console.log(`Found ${totalCount} total products to process\n`);

  const batchSize = 100;
  let offset = 0;
  let totalProcessed = 0;
  let totalMaterialsAssigned = 0;
  let totalColorsUpdated = 0;
  let totalDimensionsUpdated = 0;
  let totalWeightsUpdated = 0;
  let batchNumber = 0;

  while (offset < totalCount) {
    batchNumber++;
    const products = await fetchAllProducts(batchSize, offset);

    if (products.length === 0) {
      console.log('No more products to process.');
      break;
    }

    console.log(`Processing batch ${batchNumber}: products ${offset + 1}-${offset + products.length} of ${totalCount}...`);

    for (const product of products) {
      const extracted = extractAttributes(product);
      let productUpdated = false;

      // Check if product needs material taxonomy
      const hasMaterialTax = await hasProductMaterialTaxonomy(product.id);

      // Assign material taxonomy terms (only if not already assigned)
      if (!hasMaterialTax && extracted.materials.length > 0) {
        for (const material of extracted.materials) {
          const termId = await getOrCreateTerm(material, 'product_material');
          if (termId) {
            await assignTermToProduct(product.id, termId);
            totalMaterialsAssigned++;
            productUpdated = true;
          }
        }

        // Also update the meta value if missing
        if (!product.existingMaterials || product.existingMaterials === 'NULL') {
          await updateProductMeta(product.id, '_wt_material', extracted.materials.join(', '));
        }
      }

      // Update colors if missing
      if (extracted.colors.length > 0 && (!product.existingColor || product.existingColor === 'NULL')) {
        await updateProductMeta(product.id, '_wt_color', extracted.colors.join(', '));
        totalColorsUpdated++;
        productUpdated = true;
      }

      // Update dimensions if found and missing
      const dims = extracted.dimensions;
      const existingProduct = product as any;
      let dimsUpdated = false;

      if (dims.length && (!existingProduct.existingLength || existingProduct.existingLength === 'NULL' || existingProduct.existingLength === '')) {
        await updateProductMeta(product.id, '_length', dims.length.toString());
        dimsUpdated = true;
      }
      if (dims.width && (!existingProduct.existingWidth || existingProduct.existingWidth === 'NULL' || existingProduct.existingWidth === '')) {
        await updateProductMeta(product.id, '_width', dims.width.toString());
        dimsUpdated = true;
      }
      if (dims.height && (!existingProduct.existingHeight || existingProduct.existingHeight === 'NULL' || existingProduct.existingHeight === '')) {
        await updateProductMeta(product.id, '_height', dims.height.toString());
        dimsUpdated = true;
      }

      if (dimsUpdated) {
        totalDimensionsUpdated++;
        productUpdated = true;
      }

      // Update weight if found and missing
      if (extracted.weight && (!existingProduct.existingWeight || existingProduct.existingWeight === 'NULL' || existingProduct.existingWeight === '')) {
        await updateProductWeight(product.id, extracted.weight);
        totalWeightsUpdated++;
        productUpdated = true;
      }

      totalProcessed++;
    }

    offset += batchSize;

    // Progress indicator
    const progress = Math.round((offset / totalCount) * 100);
    console.log(`  Progress: ${Math.min(progress, 100)}% | Materials: ${totalMaterialsAssigned} | Colors: ${totalColorsUpdated} | Dimensions: ${totalDimensionsUpdated} | Weights: ${totalWeightsUpdated}`);
  }

  console.log(`\n========================================`);
  console.log(`         APPLY COMPLETE`);
  console.log(`========================================\n`);

  console.log(`Products processed: ${totalProcessed}`);
  console.log(`Material terms assigned: ${totalMaterialsAssigned}`);
  console.log(`Color values updated: ${totalColorsUpdated}`);
  console.log(`Dimension values updated: ${totalDimensionsUpdated}`);
  console.log(`Weight values updated: ${totalWeightsUpdated}`);
}

// ==================== MAIN ENTRY POINT ====================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || '--analyze';

  console.log('Attribute Parser - Extract missing taxonomy data from products\n');

  switch (command) {
    case '--analyze':
      const analysisResults = await analyzeProducts(500);
      printAnalysisResults(analysisResults);
      break;

    case '--test':
      console.log('Testing extraction on sample products...\n');
      const testProducts = await fetchProducts(20);
      for (const product of testProducts) {
        console.log(`\n[${product.id}] ${product.title}`);
        console.log(`  Existing materials: ${product.existingMaterials || '(none)'}`);
        console.log(`  Existing color: ${product.existingColor || '(none)'}`);

        const extracted = extractAttributes(product);
        console.log('  Extracted:');
        console.log(`    Materials: ${extracted.materials.length > 0 ? extracted.materials.join(', ') : '(none)'}`);
        console.log(`    Colors: ${extracted.colors.length > 0 ? extracted.colors.join(', ') : '(none)'}`);
        console.log(`    Dimensions: ${Object.keys(extracted.dimensions).length > 0 ? JSON.stringify(extracted.dimensions) : '(none)'}`);
      }
      break;

    case '--dry-run':
      await runDryRun();
      break;

    case '--apply':
      await applyChanges();
      break;

    default:
      console.log('Usage:');
      console.log('  bun run scripts/attribute-parser.ts --analyze    # Analyze extraction results');
      console.log('  bun run scripts/attribute-parser.ts --test       # Test on sample products');
      console.log('  bun run scripts/attribute-parser.ts --dry-run    # Show proposed changes');
      console.log('  bun run scripts/attribute-parser.ts --apply      # Apply to database');
  }
}

main().catch(console.error);
