/**
 * Attribute Parser Script
 * Extracts missing taxonomy data from product titles, descriptions, and existing data
 *
 * Usage:
 *   bun run scripts/attribute-parser.ts --analyze    # Analyze and show extraction results
 *   bun run scripts/attribute-parser.ts --test       # Test extraction on sample products
 *   bun run scripts/attribute-parser.ts --dry-run    # Show what would be updated
 *   bun run scripts/attribute-parser.ts --apply      # Apply extracted data to database
 */

import { normalizeMaterial, normalizeColor, parseMaterials } from '../lib/import/attribute-normalizer';

// ==================== TYPE DEFINITIONS ====================

interface ExtractedAttributes {
  materials: string[];
  colors: string[];
  dimensions: {
    length?: number;
    insertableLength?: number;
    width?: number;
    diameter?: number;
    circumference?: number;
    height?: number;
  };
  size?: string;
  volume?: {
    value: number;
    unit: string;
  };
}

interface ProductData {
  id: number;
  title: string;
  description: string;
  existingMaterials?: string;
  existingColor?: string;
}

// ==================== DIMENSION PATTERNS ====================

/**
 * Regex patterns for extracting dimensions from text
 */
const DIMENSION_PATTERNS = {
  // Length patterns: "length 7.5 inches", "length: 7.5in", "7.5 inches long"
  length: [
    /(?:total\s+)?length[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")\s+(?:long|in\s+length)/gi,
    /length\s*[:\s]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)/gi,
  ],

  // Insertable length: "insertable length 6.5 inches", "insertable: 6.5in"
  insertableLength: [
    /insertable\s*(?:length)?[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/gi,
    /insertion\s*(?:length)?[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)/gi,
    /insertable[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)/gi,
  ],

  // Width patterns: "width 1.5 inches", "1.5 inches wide"
  width: [
    /width[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")\s+(?:wide|in\s+width)/gi,
  ],

  // Diameter patterns: "diameter 1.25 inches", "1.25in diameter"
  diameter: [
    /diameter[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")\s+(?:diameter|dia\.?)/gi,
  ],

  // Circumference: "circumference 4.5 inches"
  circumference: [
    /circumference[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/gi,
  ],

  // Height: "height 3 inches"
  height: [
    /height[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/gi,
  ],
};

// ==================== MATERIAL PATTERNS ====================

/**
 * Common material keywords to search for in descriptions
 */
const MATERIAL_KEYWORDS = [
  'silicone', 'abs plastic', 'abs', 'tpe', 'tpr', 'pvc',
  'thermoplastic elastomer', 'thermoplastic rubber',
  'latex', 'rubber', 'metal', 'stainless steel', 'steel',
  'aluminum', 'glass', 'leather', 'faux leather', 'pu leather',
  'nylon', 'spandex', 'polyester', 'cotton', 'lace',
  'vinyl', 'cyberskin', 'ultraskyn', 'bioskin', 'fanta flesh',
  'polycarbonate', 'polypropylene', 'polyurethane',
  'velvet', 'satin', 'mesh', 'feather', 'wood', 'bamboo',
  'ceramic', 'crystal', 'acrylic', 'resin', 'jelly',
];

/**
 * Patterns for extracting materials from structured text
 * These are strict patterns that only match explicit material declarations
 */
const MATERIAL_EXTRACTION_PATTERNS = [
  // "Material: Silicone" or "Materials: ABS, Silicone" - strict pattern
  /\bMaterials?[:\s]+([A-Za-z,\s\/\-]+?)(?:\.|Categories:|Features:|Specifications:|Key\s+features|$)/gi,
  // "body safe materials ABS plastic" - must be followed by known material
  /body\s+safe\s+materials?\s+([A-Za-z,\s\/\-]+?)(?:\.|!|\?|\n|Categories:|$)/gi,
];

// ==================== COLOR PATTERNS ====================

/**
 * Common color names to extract
 */
const COLOR_NAMES = [
  // Basic colors
  'black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple',
  'pink', 'brown', 'gray', 'grey', 'clear', 'transparent',

  // Skin tones
  'flesh', 'nude', 'vanilla', 'caramel', 'chocolate', 'mocha', 'coffee',
  'light flesh', 'dark flesh', 'tan', 'beige',

  // Metallic
  'gold', 'silver', 'bronze', 'copper', 'rose gold', 'chrome',

  // Pink variants
  'hot pink', 'light pink', 'baby pink', 'blush', 'rose', 'fuchsia', 'magenta',

  // Purple variants
  'violet', 'lavender', 'plum', 'lilac', 'indigo',

  // Blue variants
  'navy', 'royal blue', 'light blue', 'sky blue', 'teal', 'turquoise', 'aqua',

  // Red variants
  'crimson', 'scarlet', 'burgundy', 'maroon', 'wine', 'cherry',

  // Multi-color
  'rainbow', 'multi', 'multicolor', 'assorted',
];

/**
 * Patterns for extracting colors from structured text
 */
const COLOR_EXTRACTION_PATTERNS = [
  // "Color: Black" or "Colors: Black, Pink" - strict pattern
  /\bColors?[:\s]+([A-Za-z,\s\/\-]+?)(?:\.|Categories:|Material|Features:|$)/gi,
];

// ==================== VOLUME PATTERNS ====================

/**
 * Volume/capacity patterns
 */
const VOLUME_PATTERNS = [
  // "6 oz", "6 ounces", "6oz"
  /(\d+(?:\.\d+)?)\s*(?:fluid\s+)?(?:ounces?|oz\.?)\b/gi,
  // "100ml", "100 ml"
  /(\d+(?:\.\d+)?)\s*(?:ml|milliliters?)\b/gi,
  // "1 liter", "1L"
  /(\d+(?:\.\d+)?)\s*(?:liters?|l)\b/gi,
];

// ==================== SIZE PATTERNS ====================

/**
 * Size patterns for clothing and accessories
 */
const SIZE_PATTERNS = [
  // "Size: Small", "Size S/M"
  /size[:\s]+([XSML]+(?:\/[XSML]+)?|small|medium|large|x-?large|xx-?large|one\s+size)/gi,
  // Common sizes in text
  /\b(small|medium|large|x-?large|xx-?large|one\s+size(?:\s+fits\s+(?:all|most))?)\b/gi,
];

// ==================== EXTRACTION FUNCTIONS ====================

/**
 * Extract a numeric dimension value from text using patterns
 */
function extractDimension(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(text);
    if (match && match[1]) {
      const value = parseFloat(match[1]);
      if (!isNaN(value) && value > 0 && value < 100) { // Reasonable bounds for product dimensions
        return value;
      }
    }
  }
  return undefined;
}

/**
 * Extract all dimensions from text
 */
export function extractDimensions(text: string): ExtractedAttributes['dimensions'] {
  const dimensions: ExtractedAttributes['dimensions'] = {};

  dimensions.length = extractDimension(text, DIMENSION_PATTERNS.length);
  dimensions.insertableLength = extractDimension(text, DIMENSION_PATTERNS.insertableLength);
  dimensions.width = extractDimension(text, DIMENSION_PATTERNS.width);
  dimensions.diameter = extractDimension(text, DIMENSION_PATTERNS.diameter);
  dimensions.circumference = extractDimension(text, DIMENSION_PATTERNS.circumference);
  dimensions.height = extractDimension(text, DIMENSION_PATTERNS.height);

  // Clean up undefined values
  Object.keys(dimensions).forEach(key => {
    if (dimensions[key as keyof typeof dimensions] === undefined) {
      delete dimensions[key as keyof typeof dimensions];
    }
  });

  return dimensions;
}

/**
 * False positive material contexts - if these phrases appear, skip the keyword
 */
const MATERIAL_FALSE_POSITIVE_CONTEXTS = [
  'latex condom compatible',
  'latex compatible',
  'compatible with latex',
  'safe with latex',
  'rubber latex condom',
  'natural rubber latex',
  'latex condoms',
  'velvet pouch',
  'velvet storage',
  'velvet bag',
  'satin pouch',
  'satin bag',
  'wood grain',
];

/**
 * Extract materials from text
 */
export function extractMaterials(text: string, title: string = ''): string[] {
  const materials: Set<string> = new Set();

  // First, try structured patterns like "Material: X"
  for (const pattern of MATERIAL_EXTRACTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        // Clean and validate the match
        const matchText = match[1].trim();

        // Skip if it's too long (probably captured too much)
        if (matchText.length > 100) continue;

        // Split by comma and process each part
        const parts = matchText.split(/[,\/]+/);
        for (const part of parts) {
          const trimmedPart = part.trim();
          if (trimmedPart.length === 0) continue;

          // Extract just the material name from each part
          const materialName = extractMaterialName(trimmedPart);
          if (materialName) {
            materials.add(materialName);
          }
        }
      }
    }
  }

  return Array.from(materials);
}

/**
 * List of known valid material names for exact matching
 */
const KNOWN_MATERIALS = [
  'abs plastic', 'abs', 'silicone', 'tpe', 'tpr', 'pvc', 'latex', 'rubber',
  'metal', 'steel', 'stainless steel', 'aluminum', 'glass', 'borosilicate glass',
  'leather', 'faux leather', 'pu leather', 'nylon', 'spandex', 'polyester',
  'cotton', 'lace', 'vinyl', 'polycarbonate', 'polypropylene', 'polyurethane',
  'velvet', 'satin', 'mesh', 'feathers', 'feather', 'wood', 'bamboo',
  'ceramic', 'crystals', 'crystal', 'acrylic', 'resin', 'jelly',
  'cyberskin', 'bioskin', 'ultraskyn', 'faux fur', 'elastomer',
  'thermoplastic elastomer', 'thermoplastic rubber', 'sil-a-gel',
  'pure silicone', 'enhanced pvc', 'medical grade silicone',
];

/**
 * Extract just the material name from a string, removing extra words
 */
function extractMaterialName(text: string): string | null {
  const lowerText = text.toLowerCase().trim();

  // Try to match known materials
  for (const material of KNOWN_MATERIALS) {
    if (lowerText.includes(material)) {
      // Return the normalized material name
      const normalized = normalizeMaterial(material);
      return normalized;
    }
  }

  return null;
}

/**
 * Check if a material name is a known/valid material
 */
function isKnownMaterial(material: string): boolean {
  const lowerMaterial = material.toLowerCase().trim();

  // Skip if too long (likely a sentence, not a material)
  if (lowerMaterial.split(' ').length > 4) return false;

  // Skip known false positives (product parts, not materials)
  const falsePositives = [
    'allows for', 'stretch', 'placed right', 'contains no',
    'phthalate free', 'phthalate or', 'remote control', 'power control',
    'coating on', 'butt plug', 'cock ring', 'cage', 'egg',
  ];
  if (falsePositives.some(fp => lowerMaterial.includes(fp))) return false;

  return KNOWN_MATERIALS.some(known => lowerMaterial.includes(known));
}

/**
 * Color false positives to filter out
 */
const COLOR_FALSE_POSITIVES = [
  'may vary', 'vary', 'of each', 'star sign', 'block with',
  'classic', 'skin tone', 'light skin', 'dark skin',
  'over time', 'and blue', 'and pink', 'and black', 'and white',
  'and red', 'and purple', 'package', 'and sizes', 'sizes',
  'ice pink', 'ice blue', 'ice', 'cerise', 'berry',
];

/**
 * Extract colors from text and title
 */
export function extractColors(text: string, title: string): string[] {
  const colors: Set<string> = new Set();
  const lowerTitle = title.toLowerCase();

  // First, try structured patterns like "Color: X"
  for (const pattern of COLOR_EXTRACTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        const colorStr = match[1].trim().toLowerCase();

        // Skip false positives
        if (COLOR_FALSE_POSITIVES.some(fp => colorStr.includes(fp))) continue;

        // Split on comma and process each
        const colorParts = colorStr.split(/[,\/]+/);
        for (const part of colorParts) {
          const trimmed = part.trim();
          if (trimmed.length > 0 && trimmed.length < 20) {
            const normalized = normalizeColor(trimmed);
            if (normalized && !COLOR_FALSE_POSITIVES.some(fp => normalized.toLowerCase().includes(fp))) {
              colors.add(normalized);
            }
          }
        }
      }
    }
  }

  // Search for color names in title (most reliable)
  for (const colorName of COLOR_NAMES) {
    const colorLower = colorName.toLowerCase();
    // Check title - use word boundaries to avoid partial matches
    const titleWords = lowerTitle.split(/\s+/);
    if (titleWords.includes(colorLower) ||
        lowerTitle.includes(` ${colorLower} `) ||
        lowerTitle.endsWith(` ${colorLower}`) ||
        lowerTitle.startsWith(`${colorLower} `)) {
      const normalized = normalizeColor(colorName);
      if (normalized) {
        colors.add(normalized);
      }
    }
  }

  return Array.from(colors);
}

/**
 * Extract volume from text
 */
export function extractVolume(text: string, title: string): ExtractedAttributes['volume'] | undefined {
  const combinedText = `${title} ${text}`;

  for (const pattern of VOLUME_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(combinedText);
    if (match && match[1]) {
      const value = parseFloat(match[1]);
      if (!isNaN(value) && value > 0) {
        // Determine unit
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
export function extractSize(text: string, title: string): string | undefined {
  const combinedText = `${title} ${text}`;

  for (const pattern of SIZE_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(combinedText);
    if (match && match[1]) {
      // Normalize size
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
 * Extract all attributes from a product
 */
export function extractAttributes(product: ProductData): ExtractedAttributes {
  const { title, description } = product;

  return {
    materials: extractMaterials(description, title),
    colors: extractColors(description, title),
    dimensions: extractDimensions(description),
    size: extractSize(description, title),
    volume: extractVolume(description, title),
  };
}

// ==================== DATABASE INTERACTION ====================

/**
 * MySQL connection configuration for Local by Flywheel
 */
const MYSQL_CONFIG = {
  socketPath: `${process.env.HOME}/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock`,
  user: 'root',
  password: 'root',
  database: 'local',
};

/**
 * Execute a MySQL query and return results
 */
async function queryMySQL(sql: string): Promise<string> {
  const { $ } = await import('bun');
  const result = await $`mysql --socket="${MYSQL_CONFIG.socketPath}" -u ${MYSQL_CONFIG.user} -p${MYSQL_CONFIG.password} ${MYSQL_CONFIG.database} -e ${sql} 2>/dev/null`.text();
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
    if (extracted.materials.length > 0 || extracted.colors.length > 0 || Object.keys(extracted.dimensions).length > 0) {
      updates.push({
        id: product.id,
        title: product.title,
        materials: extracted.materials,
        colors: extracted.colors,
        dimensions: extracted.dimensions,
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
  });

  console.log('\n\nTo apply these changes, run with --apply flag');
}

/**
 * Apply extracted data to database
 */
async function applyChanges(): Promise<void> {
  console.log('Applying extracted data to database...\n');

  // Get total count of products missing materials
  const countSql = `
    SELECT COUNT(*) as count
    FROM wp_posts p
    LEFT JOIN wp_term_relationships tr ON p.ID = tr.object_id
    LEFT JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
      AND tt.taxonomy = 'product_material'
    WHERE p.post_type = 'product'
    AND p.post_status = 'publish'
    AND tt.term_taxonomy_id IS NULL
  `;
  const countOutput = await queryMySQL(countSql);
  const countRows = parseMySQLOutput(countOutput);
  const totalMissing = parseInt(countRows[0]?.count || '0');

  console.log(`Found ${totalMissing} products missing material taxonomy\n`);

  const batchSize = 100;
  let totalProcessed = 0;
  let totalMaterialsAssigned = 0;
  let totalColorsUpdated = 0;
  let totalDimensionsUpdated = 0;
  const processedIds = new Set<number>();

  // Process in batches with a maximum limit
  const maxIterations = Math.ceil(totalMissing / batchSize) + 10; // Add buffer for safety
  let iterations = 0;

  while (iterations < maxIterations) {
    const products = await fetchProductsMissingMaterials(batchSize);

    // Filter out already processed products (safety check)
    const newProducts = products.filter(p => !processedIds.has(p.id));

    if (newProducts.length === 0) {
      console.log('No more unprocessed products found.');
      break;
    }

    console.log(`Processing batch ${iterations + 1}: ${newProducts.length} products...`);

    for (const product of newProducts) {
      processedIds.add(product.id);
      const extracted = extractAttributes(product);

      // Assign material taxonomy terms
      if (extracted.materials.length > 0) {
        for (const material of extracted.materials) {
          const termId = await getOrCreateTerm(material, 'product_material');
          if (termId) {
            await assignTermToProduct(product.id, termId);
            totalMaterialsAssigned++;
          }
        }

        // Also update the meta value if missing
        if (!product.existingMaterials || product.existingMaterials === 'NULL') {
          await updateProductMeta(product.id, '_wt_material', extracted.materials.join(', '));
        }
      } else {
        // No materials extracted - assign a placeholder term to prevent re-processing
        // Or we can just track it and move on
      }

      // Update colors if missing
      if (extracted.colors.length > 0 && (!product.existingColor || product.existingColor === 'NULL')) {
        await updateProductMeta(product.id, '_wt_color', extracted.colors.join(', '));
        totalColorsUpdated++;
      }

      // Update dimensions if found
      if (Object.keys(extracted.dimensions).length > 0) {
        await updateProductDimensions(product.id, extracted.dimensions);
        totalDimensionsUpdated++;
      }

      totalProcessed++;
    }

    iterations++;

    // Safety check
    if (totalProcessed >= totalMissing) {
      console.log('Processed all products.');
      break;
    }
  }

  console.log(`\n========================================`);
  console.log(`         APPLY COMPLETE`);
  console.log(`========================================\n`);

  console.log(`Products processed: ${totalProcessed}`);
  console.log(`Material terms assigned: ${totalMaterialsAssigned}`);
  console.log(`Color values updated: ${totalColorsUpdated}`);
  console.log(`Dimension values updated: ${totalDimensionsUpdated}`);
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
