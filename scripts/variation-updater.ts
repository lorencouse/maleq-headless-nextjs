/**
 * Variation Updater Script
 * Updates existing product variations with missing description, weight, and dimensions
 *
 * Data sources (in priority order):
 * 1. XML data file (matched by SKU/barcode)
 * 2. Text extraction from existing description
 *
 * Usage:
 *   bun run scripts/variation-updater.ts --analyze    # Analyze variations and show what's missing
 *   bun run scripts/variation-updater.ts --dry-run    # Show what would be updated
 *   bun run scripts/variation-updater.ts --apply      # Apply updates to database
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { parseString } from 'xml2js';
import { promisify } from 'util';
import {
  extractDimensions,
  extractWeight,
  enhanceProductAttributes,
  type ExtractedDimensions,
  type ExtractedWeight,
} from '../lib/import/attribute-extractor';

const parseXML = promisify(parseString);

// ==================== TYPE DEFINITIONS ====================

interface VariationData {
  id: number;
  parentId: number;
  parentTitle: string;
  sku: string;
  barcode: string;
  description: string;
  existingWeight: string;
  existingLength: string;
  existingWidth: string;
  existingHeight: string;
}

interface XMLProductData {
  sku: string;
  barcode: string;
  name: string;
  description: string;
  weight: string;
  length: string;
  diameter: string;
  height: string;
  color: string;
  material: string;
}

interface VariationUpdate {
  id: number;
  parentTitle: string;
  sku: string;
  currentDescription: string;
  newDescription: string | null;
  currentWeight: string;
  newWeight: string | null;
  currentLength: string;
  newLength: string | null;
  currentWidth: string;
  newWidth: string | null;
  currentHeight: string;
  newHeight: string | null;
}

// ==================== DATABASE INTERACTION ====================

const MYSQL_CONFIG = {
  socketPath: `${process.env.HOME}/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock`,
  user: 'root',
  password: 'root',
  database: 'local',
};

async function queryMySQL(sql: string): Promise<string> {
  const { $ } = await import('bun');
  const result = await $`mysql --socket="${MYSQL_CONFIG.socketPath}" -u ${MYSQL_CONFIG.user} -p${MYSQL_CONFIG.password} ${MYSQL_CONFIG.database} -e ${sql} 2>/dev/null`.text();
  return result;
}

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

// ==================== XML DATA LOADING ====================

let xmlProductsCache: Map<string, XMLProductData> | null = null;

async function loadXMLProducts(): Promise<Map<string, XMLProductData>> {
  if (xmlProductsCache) return xmlProductsCache;

  const xmlPath = join(process.cwd(), 'data', 'products-filtered.xml');
  console.log(`Loading XML data from: ${xmlPath}`);

  try {
    const xmlContent = readFileSync(xmlPath, 'utf-8');
    const result = await parseXML(xmlContent) as any;

    const products = new Map<string, XMLProductData>();

    if (!result.products?.product) {
      console.warn('No products found in XML');
      return products;
    }

    const rawProducts = Array.isArray(result.products.product)
      ? result.products.product
      : [result.products.product];

    for (const raw of rawProducts) {
      const barcode = raw.barcode?.[0] || '';
      const sku = raw.sku?.[0] || '';

      if (!barcode && !sku) continue;

      const product: XMLProductData = {
        sku,
        barcode,
        name: raw.name?.[0] || '',
        description: raw.description?.[0] || '',
        weight: raw.weight?.[0] || '',
        length: raw.length?.[0] || '',
        diameter: raw.diameter?.[0] || '',
        height: raw.height?.[0] || '',
        color: raw.color?.[0] || '',
        material: raw.material?.[0] || '',
      };

      // Index by both barcode and sku for lookup
      if (barcode) products.set(barcode, product);
      if (sku && sku !== barcode) products.set(sku, product);
    }

    console.log(`Loaded ${products.size} products from XML\n`);
    xmlProductsCache = products;
    return products;
  } catch (error) {
    console.error('Failed to load XML:', error);
    return new Map();
  }
}

// ==================== VARIATION QUERIES ====================

async function getVariationCount(): Promise<number> {
  const sql = `
    SELECT COUNT(*) as count
    FROM wp_posts
    WHERE post_type = 'product_variation'
    AND post_status = 'publish'
  `;

  const output = await queryMySQL(sql);
  const rows = parseMySQLOutput(output);
  return parseInt(rows[0]?.count || '0');
}

async function fetchVariations(limit: number, offset: number): Promise<VariationData[]> {
  const sql = `
    SELECT
      v.ID as id,
      v.post_parent as parentId,
      p.post_title as parentTitle,
      v.post_excerpt as description,
      MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) as sku,
      MAX(CASE WHEN pm.meta_key = '_wt_barcode' THEN pm.meta_value END) as barcode,
      MAX(CASE WHEN pm.meta_key = '_weight' THEN pm.meta_value END) as existingWeight,
      MAX(CASE WHEN pm.meta_key = '_length' THEN pm.meta_value END) as existingLength,
      MAX(CASE WHEN pm.meta_key = '_width' THEN pm.meta_value END) as existingWidth,
      MAX(CASE WHEN pm.meta_key = '_height' THEN pm.meta_value END) as existingHeight
    FROM wp_posts v
    LEFT JOIN wp_posts p ON v.post_parent = p.ID
    LEFT JOIN wp_postmeta pm ON v.ID = pm.post_id
      AND pm.meta_key IN ('_sku', '_wt_barcode', '_weight', '_length', '_width', '_height')
    WHERE v.post_type = 'product_variation'
    AND v.post_status = 'publish'
    GROUP BY v.ID, v.post_parent, p.post_title, v.post_excerpt
    ORDER BY v.ID
    LIMIT ${limit} OFFSET ${offset}
  `;

  const output = await queryMySQL(sql);
  const rows = parseMySQLOutput(output);

  return rows.map(row => ({
    id: parseInt(row.id),
    parentId: parseInt(row.parentId),
    parentTitle: row.parentTitle || '',
    sku: row.sku || '',
    barcode: row.barcode || '',
    description: row.description || '',
    existingWeight: row.existingWeight || '',
    existingLength: row.existingLength || '',
    existingWidth: row.existingWidth || '',
    existingHeight: row.existingHeight || '',
  }));
}

// ==================== UPDATE LOGIC ====================

function isEmptyValue(value: string | null | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return trimmed === '' || trimmed === 'NULL' || trimmed === '0' || trimmed === '0.00';
}

function cleanDescription(description: string): string {
  // Remove year markers at end
  let cleaned = description.replace(/\s*20\d{2}\s*\.?\s*$/g, '');
  // Remove "Restricted, Amazon Restricted" and similar
  cleaned = cleaned.replace(/\s*Restricted[^.]*\.\s*$/gi, '');
  // Remove excessive whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function calculateUpdates(variation: VariationData, xmlProduct: XMLProductData | null): VariationUpdate | null {
  const update: VariationUpdate = {
    id: variation.id,
    parentTitle: variation.parentTitle,
    sku: variation.sku,
    currentDescription: variation.description,
    newDescription: null,
    currentWeight: variation.existingWeight,
    newWeight: null,
    currentLength: variation.existingLength,
    newLength: null,
    currentWidth: variation.existingWidth,
    newWidth: null,
    currentHeight: variation.existingHeight,
    newHeight: null,
  };

  let hasUpdates = false;

  if (xmlProduct) {
    // Use enhanceProductAttributes to get the best data
    const enhanced = enhanceProductAttributes(
      {
        color: xmlProduct.color,
        material: xmlProduct.material,
        weight: xmlProduct.weight,
        length: xmlProduct.length,
        width: xmlProduct.diameter,
        height: xmlProduct.height,
      },
      cleanDescription(xmlProduct.description),
      xmlProduct.name
    );

    // Update description if missing
    if (isEmptyValue(variation.description) && xmlProduct.description) {
      update.newDescription = cleanDescription(xmlProduct.description);
      hasUpdates = true;
    }

    // Update weight if missing
    if (isEmptyValue(variation.existingWeight) && enhanced.weight) {
      update.newWeight = enhanced.weight;
      hasUpdates = true;
    }

    // Update dimensions if missing
    if (isEmptyValue(variation.existingLength) && enhanced.length) {
      update.newLength = enhanced.length;
      hasUpdates = true;
    }
    if (isEmptyValue(variation.existingWidth) && enhanced.width) {
      update.newWidth = enhanced.width;
      hasUpdates = true;
    }
    if (isEmptyValue(variation.existingHeight) && enhanced.height) {
      update.newHeight = enhanced.height;
      hasUpdates = true;
    }
  } else if (variation.description) {
    // No XML data - try to extract from existing description
    const dims = extractDimensions(variation.description);
    const weight = extractWeight(variation.description);

    if (isEmptyValue(variation.existingWeight) && weight) {
      // Convert oz to lbs
      const weightInLbs = weight.valueInOz / 16;
      update.newWeight = weightInLbs.toFixed(2);
      hasUpdates = true;
    }

    if (isEmptyValue(variation.existingLength) && dims.length) {
      update.newLength = dims.length.toString();
      hasUpdates = true;
    }
    if (isEmptyValue(variation.existingWidth) && dims.width) {
      update.newWidth = dims.width.toString();
      hasUpdates = true;
    }
    if (isEmptyValue(variation.existingHeight) && dims.height) {
      update.newHeight = dims.height.toString();
      hasUpdates = true;
    }
  }

  return hasUpdates ? update : null;
}

// ==================== DATABASE UPDATE FUNCTIONS ====================

async function updateVariationMeta(variationId: number, metaKey: string, metaValue: string): Promise<void> {
  const escapedValue = metaValue.replace(/'/g, "''").replace(/\\/g, '\\\\');

  // Check if meta exists
  const checkSql = `
    SELECT meta_id
    FROM wp_postmeta
    WHERE post_id = ${variationId}
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
      WHERE post_id = ${variationId}
      AND meta_key = '${metaKey}'
    `;
    await queryMySQL(updateSql);
  } else {
    // Insert new
    const insertSql = `
      INSERT INTO wp_postmeta (post_id, meta_key, meta_value)
      VALUES (${variationId}, '${metaKey}', '${escapedValue}')
    `;
    await queryMySQL(insertSql);
  }
}

async function updateVariationDescription(variationId: number, description: string): Promise<void> {
  const escapedDesc = description.replace(/'/g, "''").replace(/\\/g, '\\\\');

  // WooCommerce stores variation descriptions in the _variation_description meta field
  // Also update post_content for completeness
  await updateVariationMeta(variationId, '_variation_description', description);

  // Update post_content as well (some themes use this)
  const sql = `
    UPDATE wp_posts
    SET post_content = '${escapedDesc}'
    WHERE ID = ${variationId}
  `;

  await queryMySQL(sql);
}

// ==================== COMMANDS ====================

async function runAnalyze(): Promise<void> {
  console.log('Analyzing variations for missing data...\n');

  const xmlProducts = await loadXMLProducts();
  const totalCount = await getVariationCount();
  console.log(`Found ${totalCount} total variations\n`);

  const batchSize = 500;
  let offset = 0;
  let totalMissingDescription = 0;
  let totalMissingWeight = 0;
  let totalMissingDimensions = 0;
  let totalWithXMLMatch = 0;
  let totalUpdatable = 0;

  while (offset < totalCount) {
    const variations = await fetchVariations(batchSize, offset);
    if (variations.length === 0) break;

    for (const variation of variations) {
      // Look up XML data
      const xmlProduct = xmlProducts.get(variation.sku) || xmlProducts.get(variation.barcode) || null;

      if (xmlProduct) totalWithXMLMatch++;

      // Check what's missing
      if (isEmptyValue(variation.description)) totalMissingDescription++;
      if (isEmptyValue(variation.existingWeight)) totalMissingWeight++;
      if (isEmptyValue(variation.existingLength) || isEmptyValue(variation.existingWidth) || isEmptyValue(variation.existingHeight)) {
        totalMissingDimensions++;
      }

      // Check if we can update
      const update = calculateUpdates(variation, xmlProduct);
      if (update) totalUpdatable++;
    }

    offset += batchSize;
    console.log(`  Processed ${Math.min(offset, totalCount)} of ${totalCount}...`);
  }

  console.log('\n========================================');
  console.log('         ANALYSIS RESULTS');
  console.log('========================================\n');

  console.log(`Total variations: ${totalCount}`);
  console.log(`Variations with XML match: ${totalWithXMLMatch} (${(totalWithXMLMatch / totalCount * 100).toFixed(1)}%)`);
  console.log(`\nMissing data:`);
  console.log(`  - Missing description: ${totalMissingDescription} (${(totalMissingDescription / totalCount * 100).toFixed(1)}%)`);
  console.log(`  - Missing weight: ${totalMissingWeight} (${(totalMissingWeight / totalCount * 100).toFixed(1)}%)`);
  console.log(`  - Missing dimensions: ${totalMissingDimensions} (${(totalMissingDimensions / totalCount * 100).toFixed(1)}%)`);
  console.log(`\nUpdatable variations: ${totalUpdatable}`);
  console.log('\nRun with --dry-run to see specific updates');
}

async function runDryRun(): Promise<void> {
  console.log('Dry run - showing proposed updates...\n');

  const xmlProducts = await loadXMLProducts();
  const totalCount = await getVariationCount();

  const batchSize = 100;
  let offset = 0;
  const updates: VariationUpdate[] = [];

  while (offset < totalCount && updates.length < 50) {
    const variations = await fetchVariations(batchSize, offset);
    if (variations.length === 0) break;

    for (const variation of variations) {
      const xmlProduct = xmlProducts.get(variation.sku) || xmlProducts.get(variation.barcode) || null;
      const update = calculateUpdates(variation, xmlProduct);

      if (update) {
        updates.push(update);
        if (updates.length >= 50) break;
      }
    }

    offset += batchSize;
  }

  console.log('========================================');
  console.log('         DRY RUN RESULTS');
  console.log('========================================\n');

  console.log(`Showing first ${updates.length} updatable variations:\n`);

  for (const update of updates) {
    console.log(`\n[${update.id}] ${update.parentTitle} (SKU: ${update.sku})`);

    if (update.newDescription) {
      const preview = update.newDescription.substring(0, 100) + (update.newDescription.length > 100 ? '...' : '');
      console.log(`  + Description: "${preview}"`);
    }
    if (update.newWeight) {
      console.log(`  + Weight: ${update.newWeight} lbs (was: ${update.currentWeight || 'empty'})`);
    }
    if (update.newLength) {
      console.log(`  + Length: ${update.newLength}" (was: ${update.currentLength || 'empty'})`);
    }
    if (update.newWidth) {
      console.log(`  + Width: ${update.newWidth}" (was: ${update.currentWidth || 'empty'})`);
    }
    if (update.newHeight) {
      console.log(`  + Height: ${update.newHeight}" (was: ${update.currentHeight || 'empty'})`);
    }
  }

  console.log('\n\nTo apply these changes, run with --apply flag');
}

async function runApply(): Promise<void> {
  console.log('Applying updates to variations...\n');

  const xmlProducts = await loadXMLProducts();
  const totalCount = await getVariationCount();
  console.log(`Processing ${totalCount} variations...\n`);

  const batchSize = 100;
  let offset = 0;
  let totalProcessed = 0;
  let totalDescriptionsUpdated = 0;
  let totalWeightsUpdated = 0;
  let totalDimensionsUpdated = 0;
  let batchNumber = 0;

  while (offset < totalCount) {
    batchNumber++;
    const variations = await fetchVariations(batchSize, offset);
    if (variations.length === 0) break;

    console.log(`Processing batch ${batchNumber}: variations ${offset + 1}-${offset + variations.length} of ${totalCount}...`);

    for (const variation of variations) {
      const xmlProduct = xmlProducts.get(variation.sku) || xmlProducts.get(variation.barcode) || null;
      const update = calculateUpdates(variation, xmlProduct);

      if (update) {
        // Apply description update
        if (update.newDescription) {
          await updateVariationDescription(variation.id, update.newDescription);
          totalDescriptionsUpdated++;
        }

        // Apply weight update
        if (update.newWeight) {
          await updateVariationMeta(variation.id, '_weight', update.newWeight);
          totalWeightsUpdated++;
        }

        // Apply dimension updates
        let dimsUpdated = false;
        if (update.newLength) {
          await updateVariationMeta(variation.id, '_length', update.newLength);
          dimsUpdated = true;
        }
        if (update.newWidth) {
          await updateVariationMeta(variation.id, '_width', update.newWidth);
          dimsUpdated = true;
        }
        if (update.newHeight) {
          await updateVariationMeta(variation.id, '_height', update.newHeight);
          dimsUpdated = true;
        }
        if (dimsUpdated) totalDimensionsUpdated++;
      }

      totalProcessed++;
    }

    offset += batchSize;

    // Progress indicator
    const progress = Math.round((offset / totalCount) * 100);
    console.log(`  Progress: ${Math.min(progress, 100)}% | Descriptions: ${totalDescriptionsUpdated} | Weights: ${totalWeightsUpdated} | Dimensions: ${totalDimensionsUpdated}`);
  }

  console.log('\n========================================');
  console.log('         APPLY COMPLETE');
  console.log('========================================\n');

  console.log(`Variations processed: ${totalProcessed}`);
  console.log(`Descriptions updated: ${totalDescriptionsUpdated}`);
  console.log(`Weights updated: ${totalWeightsUpdated}`);
  console.log(`Dimensions updated: ${totalDimensionsUpdated}`);
}

// ==================== MAIN ENTRY POINT ====================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || '--analyze';

  console.log('Variation Updater - Update variations with missing description, weight, and dimensions\n');

  switch (command) {
    case '--analyze':
      await runAnalyze();
      break;
    case '--dry-run':
      await runDryRun();
      break;
    case '--apply':
      await runApply();
      break;
    default:
      console.log('Usage:');
      console.log('  bun run scripts/variation-updater.ts --analyze   # Analyze missing data');
      console.log('  bun run scripts/variation-updater.ts --dry-run   # Show proposed updates');
      console.log('  bun run scripts/variation-updater.ts --apply     # Apply updates to database');
  }
}

main().catch(console.error);
