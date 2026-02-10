#!/usr/bin/env bun

/**
 * Fix and Merge Variations Script
 *
 * Two main capabilities:
 *
 * 1. FIX ATTRIBUTES: Find variations with compound attribute values
 *    (e.g., pa_style="green-l" which should be pa_color="neon-green" + pa_size="l")
 *    and split them into proper multi-attribute variations.
 *
 * 2. MERGE PARENTS: Find multiple variable/simple products that share the
 *    same base product name and merge them into a single parent product
 *    with multiple variation attributes (e.g., Color + Size).
 *
 * Usage:
 *   bun scripts/fix-and-merge-variations.ts [mode] [options]
 *
 * Modes:
 *   --analyze              Show what would be fixed/merged (default)
 *   --fix-attributes       Fix compound attribute values on existing variations
 *   --merge                Merge duplicate parent products
 *   --dry-run              Show detailed changes without applying
 *
 * Options:
 *   --limit <n>            Limit number of groups to process
 *   --product-id <id>      Process specific parent product
 *   --search <term>        Filter by product name search term
 *   --output <file>        Write JSON report
 *   --min-group-size <n>   Minimum products to form merge group (default: 2)
 *   --max-group-size <n>   Maximum products per merge group (default: 20)
 *   --help, -h             Show help
 */

import { writeFileSync } from 'fs';
import { getConnection } from './lib/db';

// ==================== TYPES ====================

interface VariationRecord {
  id: number;
  parentId: number;
  parentTitle: string;
  attrKey: string;
  attrValue: string;
  price: string;
  sku: string;
}

interface FixAction {
  variationId: number;
  parentId: number;
  parentTitle: string;
  oldAttrKey: string;
  oldAttrValue: string;
  newColor: string | null;
  newSize: string | null;
}

interface ParentProduct {
  id: number;
  title: string;
  slug: string;
  description: string;
  shortDescription: string;
  price: string;
  thumbnailId: number | null;
  galleryIds: string;
  variationCount: number;
  reviewCount: number;
  brandName: string;
  productType: string;
}

interface MergeGroup {
  groupId: number;
  baseName: string;
  brandName: string;
  products: ParentProduct[];
  suggestedParentId: number;
  totalVariations: number;
}

interface ScriptOptions {
  mode: 'analyze' | 'fix-attributes' | 'merge' | 'dry-run';
  limit?: number;
  productId?: number;
  search?: string;
  output?: string;
  minGroupSize: number;
  maxGroupSize: number;
}

// ==================== MULTI-WORD COLOR LISTS ====================

const MULTI_WORD_COLORS = [
  'neon green', 'neon pink', 'neon blue', 'neon yellow', 'neon orange', 'neon lime',
  'neon purple', 'neon red',
  'hot pink', 'hot pnk', 'hot red',
  'light blue', 'light pink', 'light purple', 'light green',
  'dark blue', 'dark green', 'dark purple', 'dark red', 'dark brown',
  'royal blue', 'baby blue', 'sky blue', 'baby pink', 'dusty rose', 'dusty pink',
  'wine red', 'burgundy red', 'deep purple', 'forest green', 'lime green',
  'midnight blue', 'midnight black', 'pearl white', 'rose gold', 'matte black',
  'black ice', 'classic white',
];

const SINGLE_COLORS = [
  'red', 'blue', 'green', 'pink', 'purple', 'black', 'white', 'clear',
  'silver', 'gold', 'bronze', 'copper', 'grey', 'gray', 'brown',
  'yellow', 'orange', 'teal', 'navy', 'nude', 'tan', 'beige', 'ivory',
  'wine', 'burgundy', 'charcoal', 'coral', 'fuchsia', 'indigo',
  'magenta', 'maroon', 'olive', 'plum', 'salmon', 'turquoise', 'violet',
  'neon', 'midnight', 'pearl', 'matte', 'rose',
  // Common abbreviations
  'blk', 'wht', 'pnk', 'prp', 'blu', 'grn', 'gld', 'slv', 'brn', 'ylw',
];

const SIZE_SLUGS = new Set([
  'xs', 'x-small', 'xsmall',
  's', 'sm', 'small',
  'm', 'med', 'medium',
  'l', 'lg', 'large',
  'xl', 'x-large', 'xlarge',
  'xxl', 'xx-large', '2xl',
  'xxxl', 'xxx-large', '3xl', '4xl',
  'o-s', 'os', 'one-size',
  'q-s', 'qs', 'queen', 'os-queen',
  's-m', 'm-l', 'l-xl', 'xl-xxl',
  'mini', 'petite', 'regular', 'plus', 'jumbo', 'giant', 'king',
  '1x', '2x', '3x', '4x', '1xl', '2xl', '3xl',
  '1x-2x', '3x-4x',
]);

const SIZE_PATTERNS = /^(xs|x-?small|s|sm|small|m|med|medium|l|lg|large|xl|x-?large|xxl|xx-?large|xxxl|2xl|3xl|4xl|o-?s|os|one-?size|q-?s|qs|queen|os-?queen|s-m|m-l|l-xl|xl-xxl|mini|petite|regular|plus|jumbo|giant|king|1x|2x|3x|4x|1xl|2xl|3xl|1x-2x|3x-4x)$/i;

// ==================== ARG PARSING ====================

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const options: ScriptOptions = {
    mode: 'analyze',
    minGroupSize: 2,
    maxGroupSize: 20,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--analyze': options.mode = 'analyze'; break;
      case '--fix-attributes': options.mode = 'fix-attributes'; break;
      case '--merge': options.mode = 'merge'; break;
      case '--dry-run': options.mode = 'dry-run'; break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--product-id':
        options.productId = parseInt(args[++i], 10);
        break;
      case '--search':
        options.search = args[++i];
        break;
      case '--output':
        options.output = args[++i];
        break;
      case '--min-group-size':
        options.minGroupSize = parseInt(args[++i], 10);
        break;
      case '--max-group-size':
        options.maxGroupSize = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        console.log(`
Fix and Merge Variations Script

Modes:
  --analyze              Show analysis of compound attributes and merge candidates (default)
  --fix-attributes       Fix compound attribute values on existing variations
  --merge                Merge duplicate parent products into single products
  --dry-run              Show detailed plan without making changes

Options:
  --limit <n>            Limit number of items to process
  --product-id <id>      Process specific parent product
  --search <term>        Filter by product name search term
  --output <file>        Write JSON report to file
  --min-group-size <n>   Minimum products to form merge group (default: 2)
  --max-group-size <n>   Maximum products per merge group (default: 20)
`);
        process.exit(0);
    }
  }

  return options;
}

// ==================== ATTRIBUTE PARSING ====================

/**
 * Parse a compound slug into color and size components.
 * e.g., "green-l" -> { color: "green", size: "l" }
 *        "neon-green" -> { color: "neon-green", size: null }
 *        "black-sm" -> { color: "black", size: "sm" }
 *        "green-2xl" -> { color: "green", size: "2xl" }
 */
function parseCompoundSlug(slug: string): { color: string | null; size: string | null; isCompound: boolean } {
  const lower = slug.toLowerCase();

  // Check if it's a known multi-word color slug (joined by -)
  for (const mc of MULTI_WORD_COLORS) {
    const mcSlug = mc.replace(/\s+/g, '-');
    if (lower === mcSlug) {
      return { color: mcSlug, size: null, isCompound: false };
    }
  }

  // Check if it's a pure size
  if (SIZE_PATTERNS.test(lower)) {
    return { color: null, size: lower, isCompound: false };
  }

  // Check if it's a pure single color
  if (SINGLE_COLORS.includes(lower)) {
    return { color: lower, size: null, isCompound: false };
  }

  // Try to split into color + size
  // Strategy: try to find a size suffix
  const parts = lower.split('-');

  // Try matching progressively longer suffixes as size
  for (let splitAt = parts.length - 1; splitAt >= 1; splitAt--) {
    const sizePart = parts.slice(splitAt).join('-');
    const colorPart = parts.slice(0, splitAt).join('-');

    if (SIZE_PATTERNS.test(sizePart)) {
      // Verify the color part looks like a color
      const isKnownColor = SINGLE_COLORS.includes(colorPart) ||
        MULTI_WORD_COLORS.some(mc => mc.replace(/\s+/g, '-') === colorPart);

      if (isKnownColor) {
        return { color: colorPart, size: sizePart, isCompound: true };
      }
    }
  }

  // Try matching a color prefix and treating the rest as size
  for (let splitAt = 1; splitAt < parts.length; splitAt++) {
    const colorPart = parts.slice(0, splitAt).join('-');
    const sizePart = parts.slice(splitAt).join('-');

    const isKnownColor = SINGLE_COLORS.includes(colorPart) ||
      MULTI_WORD_COLORS.some(mc => mc.replace(/\s+/g, '-') === colorPart);

    if (isKnownColor && SIZE_PATTERNS.test(sizePart)) {
      return { color: colorPart, size: sizePart, isCompound: true };
    }
  }

  // Not a compound value we can parse
  return { color: null, size: null, isCompound: false };
}

// ==================== SUPER BASE NAME EXTRACTION ====================

/**
 * Extract a "super base name" by stripping ALL variant words including
 * both colors AND sizes. Used for finding products that should be merged.
 * More aggressive than extractBaseName() which is used for same-price grouping.
 */
function extractSuperBaseName(title: string): string {
  let name = title.trim();

  // Normalize hyphens before color words to spaces (e.g., "Detail-black" -> "Detail black")
  // But first protect size combos by converting them to non-hyphen forms
  name = name.replace(/\bx-large\b/gi, 'XLARGE');
  name = name.replace(/\bxx-large\b/gi, 'XXLARGE');
  name = name.replace(/\bxxx-large\b/gi, 'XXXLARGE');
  name = name.replace(/\bx-small\b/gi, 'XSMALL');

  name = name.replace(/-(?=black|white|red|blue|green|pink|purple|navy|wine|grey|gray|nude|beige|orange|yellow|silver|gold|clear|brown|teal|ivory|coral|turquoise|burgundy|neon|hot|light|dark|royal|baby|small|medium|large|mini|petite)(\b)/gi, ' ');

  // Remove trailing quote marks
  name = name.replace(/\s*["″"]\s*$/g, '').trim();

  // Remove volume/dimension/pack patterns
  name = name.replace(/\s*\.?\d+(\.\d+)?\s*(FL\.?\s*)?(OZ|OUNCES?|ML|MILLILITERS?|L|LITERS?|G|GRAMS?|MG|LB|LBS|POUNDS?|O)\.?\s*(\/\s*\.?\d+(\.\d+)?\s*(FL\.?\s*)?(OZ|OUNCES?|ML|MILLILITERS?|L|LITERS?|G|GRAMS?|MG|LB|LBS|POUNDS?|O)\.?)?\b/gi, '');
  name = name.replace(/\s*\d+(\.\d+)?\s*(INCHES?|IN|"|″|MM|MILLIMETERS?|CM|CENTIMETERS?|FT|FEET|FOOT)\b/gi, '');
  name = name.replace(/\s*\d+\s*(PK|PACK|PC|PCS|PIECES?|CT|COUNT)\s*(BOWL|BOX|BAG|DISPLAY|JAR)?\b/gi, '');

  // Remove bracketed/parenthesized content
  name = name.replace(/\s*\[.*?\]/g, '');
  name = name.replace(/\s*\(net\)/gi, '');
  name = name.replace(/\s*\(.*?\)/g, '');

  // Remove common packaging/display suffixes BEFORE color/size stripping
  // so "Black Large Hanging" becomes "Black Large" and can then be stripped
  for (let i = 0; i < 2; i++) {
    name = name.replace(/\s+HANGING\s*$/gi, '');
    name = name.replace(/\s+HANGI?\s*$/gi, ''); // truncated "Hanging"
    name = name.replace(/\s+BOXED\s*$/gi, '');
    name = name.replace(/\s+CARDED\s*$/gi, '');
    name = name.replace(/\s+DISPLAY\s*$/gi, '');
  }

  // Remove multi-word colors
  for (const color of MULTI_WORD_COLORS) {
    const regex = new RegExp(`\\s+${color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    name = name.replace(regex, '');
  }

  // Remove multi-word color variants anywhere that look like trailing modifiers
  for (const color of MULTI_WORD_COLORS) {
    const regex = new RegExp(`\\s+${color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    // Only remove if it's near the end (last 30% of name)
    const match = name.match(regex);
    if (match && match.index && match.index > name.length * 0.6) {
      name = name.substring(0, match.index) + name.substring(match.index + match[0].length);
    }
  }

  // Remove multi-word size patterns first (e.g., "Extra Large", "Extra Small")
  name = name.replace(/\s+EXTRA\s+LARGE\b/gi, '');
  name = name.replace(/\s+EXTRA\s+SMALL\b/gi, '');

  // Remove size abbreviations (including hyphenated forms)
  name = name.replace(/\s+(XS|X-?SMALL|X-?LARGE|XX-?LARGE|XXX-?LARGE|XXL|XXXL|2XL|3XL|4XL|S\/M|M\/L|L\/XL|XL\/XXL|O\/S|OS|ONE\s*SIZE|QUEEN|Q\/S|OS\s*QUEEN|OSQ|1X|2X|3X|4X|1X\/2X|3X\/4X|1XL|2XL|3XL)\b/gi, '');
  name = name.replace(/\s+[SML]\s*$/gi, '');

  // Remove single-word colors at end (multiple passes)
  const colorWords = [
    'RED', 'BLUE', 'GREEN', 'PINK', 'PURPLE', 'BLACK', 'WHITE', 'CLEAR',
    'SILVER', 'GOLD', 'BRONZE', 'COPPER', 'GREY', 'GRAY', 'BROWN',
    'YELLOW', 'TEAL', 'NAVY', 'NUDE', 'TAN', 'BEIGE', 'IVORY', 'ORANGE',
    'WINE', 'BURGUNDY', 'CHARCOAL', 'CORAL', 'FUCHSIA', 'INDIGO',
    'MAGENTA', 'MAROON', 'OLIVE', 'PLUM', 'SALMON', 'TURQUOISE', 'VIOLET',
    'NEON', 'MIDNIGHT', 'PEARL', 'MATTE', 'ROSE',
    // Color abbreviations
    'BLK', 'WHT', 'PNK', 'PRP', 'BLU', 'GRN', 'GLD', 'SLV', 'BRN', 'YLW',
  ];

  const sizeWords = [
    'SMALL', 'MEDIUM', 'LARGE', 'XLARGE', 'XXLARGE', 'XXXLARGE', 'XSMALL',
    'X-LARGE', 'XX-LARGE', 'XXX-LARGE', 'X-SMALL',
    'SM', 'MED', 'LG', 'XL', 'XXL', 'XXXL', 'XS',
    'MINI', 'PETITE', 'REGULAR', 'JUMBO', 'GIANT', 'KING', 'QUEEN',
    'EXTRA', // for "Extra Large" after "Large" is stripped
  ];

  const allVariantWords = [...colorWords, ...sizeWords];

  for (let pass = 0; pass < 4; pass++) {
    for (const word of allVariantWords) {
      const regex = new RegExp(`\\s+${word}\\s*$`, 'i');
      name = name.replace(regex, '');
    }
  }

  // Remove standalone decimal numbers at end
  name = name.replace(/\s+\d+\.?\d*\s*$/gi, '');

  // Clean up
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/[\s.\-,/]+$/, '').trim();

  return name;
}

// ==================== NORMALIZATION ====================

function normalizeColor(color: string): string {
  const colorMap: Record<string, string> = {
    'black': 'Black', 'white': 'White', 'clear': 'Clear', 'red': 'Red',
    'blue': 'Blue', 'green': 'Green', 'pink': 'Pink', 'purple': 'Purple',
    'silver': 'Silver', 'gold': 'Gold', 'yellow': 'Yellow', 'orange': 'Orange',
    'brown': 'Brown', 'gray': 'Gray', 'grey': 'Gray', 'nude': 'Nude',
    'tan': 'Tan', 'beige': 'Beige', 'ivory': 'Ivory', 'teal': 'Teal',
    'navy': 'Navy', 'bronze': 'Bronze', 'copper': 'Copper', 'rose': 'Rose',
    'pearl': 'Pearl', 'midnight': 'Midnight', 'matte': 'Matte',
    'wine': 'Wine', 'burgundy': 'Burgundy', 'charcoal': 'Charcoal',
    'coral': 'Coral', 'fuchsia': 'Fuchsia', 'indigo': 'Indigo',
    'magenta': 'Magenta', 'maroon': 'Maroon', 'olive': 'Olive',
    'plum': 'Plum', 'salmon': 'Salmon', 'turquoise': 'Turquoise', 'violet': 'Violet',
    // Common abbreviations
    'blk': 'Black', 'wht': 'White', 'pnk': 'Pink', 'prp': 'Purple',
    'blu': 'Blue', 'grn': 'Green', 'gld': 'Gold', 'slv': 'Silver',
    'brn': 'Brown', 'ylw': 'Yellow',
    'neon green': 'Neon Green', 'neon pink': 'Neon Pink', 'neon blue': 'Neon Blue',
    'neon yellow': 'Neon Yellow', 'neon orange': 'Neon Orange', 'neon lime': 'Neon Lime',
    'neon purple': 'Neon Purple', 'neon red': 'Neon Red',
    'hot pink': 'Hot Pink', 'hot pnk': 'Hot Pink', 'hot red': 'Hot Red',
    'light blue': 'Light Blue', 'light pink': 'Light Pink', 'light purple': 'Light Purple',
    'light green': 'Light Green',
    'dark blue': 'Dark Blue', 'dark green': 'Dark Green', 'dark purple': 'Dark Purple',
    'dark red': 'Dark Red', 'dark brown': 'Dark Brown',
    'royal blue': 'Royal Blue', 'baby blue': 'Baby Blue', 'sky blue': 'Sky Blue',
    'baby pink': 'Baby Pink', 'dusty rose': 'Dusty Rose', 'dusty pink': 'Dusty Pink',
    'wine red': 'Wine Red', 'burgundy red': 'Burgundy Red', 'deep purple': 'Deep Purple',
    'forest green': 'Forest Green', 'lime green': 'Lime Green',
    'midnight blue': 'Midnight Blue', 'midnight black': 'Midnight Black',
    'pearl white': 'Pearl White', 'rose gold': 'Rose Gold', 'matte black': 'Matte Black',
    'black ice': 'Black Ice', 'classic white': 'Classic White',
  };
  const lower = color.toLowerCase().replace(/-/g, ' ').trim();
  return colorMap[lower] || applyTitleCase(color.replace(/-/g, ' '));
}

function normalizeSize(size: string): string {
  const sizeMap: Record<string, string> = {
    'xs': 'X-Small', 'x-small': 'X-Small', 'xsmall': 'X-Small',
    's': 'Small', 'sm': 'Small', 'small': 'Small',
    'm': 'Medium', 'med': 'Medium', 'medium': 'Medium',
    'l': 'Large', 'lg': 'Large', 'large': 'Large',
    'xl': 'X-Large', 'x-large': 'X-Large', 'xlarge': 'X-Large',
    'xxl': 'XX-Large', 'xx-large': 'XX-Large', '2xl': 'XX-Large',
    'xxxl': 'XXX-Large', 'xxx-large': 'XXX-Large', '3xl': 'XXX-Large', '4xl': 'XXXX-Large',
    'o-s': 'One Size', 'os': 'One Size', 'one-size': 'One Size',
    'q-s': 'Queen', 'qs': 'Queen', 'queen': 'Queen', 'os-queen': 'Queen',
    's-m': 'S/M', 'm-l': 'M/L', 'l-xl': 'L/XL', 'xl-xxl': 'XL/XXL',
    'mini': 'Mini', 'petite': 'Petite', 'regular': 'Regular',
    'plus': 'Plus', 'jumbo': 'Jumbo', 'giant': 'Giant', 'king': 'King',
    '1x': '1X', '2x': '2X', '3x': '3X', '4x': '4X',
    '1xl': '1XL', '1x-2x': '1X/2X', '3x-4x': '3X/4X',
  };
  const lower = size.toLowerCase().trim();
  return sizeMap[lower] || size.toUpperCase();
}

function applyTitleCase(text: string): string {
  return text
    .toLowerCase()
    .split(' ')
    .map((word, index) => {
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ')
    .trim();
}

// ==================== DATABASE HELPERS ====================

async function getOrCreateAttribute(connection: mysql.Connection, attributeName: string): Promise<number> {
  const slug = attributeName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const [existing] = await connection.execute(
    `SELECT attribute_id FROM wp_woocommerce_attribute_taxonomies WHERE attribute_name = ?`,
    [slug]
  );

  if ((existing as any[]).length > 0) {
    return (existing as any[])[0].attribute_id;
  }

  const [result] = await connection.execute(
    `INSERT INTO wp_woocommerce_attribute_taxonomies (attribute_name, attribute_label, attribute_type, attribute_orderby, attribute_public)
     VALUES (?, ?, 'select', 'menu_order', 0)`,
    [slug, attributeName]
  );

  return (result as any).insertId;
}

async function getOrCreateTerm(connection: mysql.Connection, termName: string, taxonomy: string): Promise<{ termId: number; termTaxonomyId: number; slug: string }> {
  const slug = termName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 200);

  const [existing] = await connection.execute(
    `SELECT t.term_id, tt.term_taxonomy_id, t.slug
     FROM wp_terms t
     JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
     WHERE t.slug = ? AND tt.taxonomy = ?`,
    [slug, taxonomy]
  );

  if ((existing as any[]).length > 0) {
    return {
      termId: (existing as any[])[0].term_id,
      termTaxonomyId: (existing as any[])[0].term_taxonomy_id,
      slug: (existing as any[])[0].slug,
    };
  }

  const [termResult] = await connection.execute(
    `INSERT INTO wp_terms (name, slug, term_group) VALUES (?, ?, 0)`,
    [termName, slug]
  );
  const termId = (termResult as any).insertId;

  const [ttResult] = await connection.execute(
    `INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (?, ?, '', 0, 0)`,
    [termId, taxonomy]
  );
  const termTaxonomyId = (ttResult as any).insertId;

  return { termId, termTaxonomyId, slug };
}

/**
 * Serialize product_attributes for multiple attribute taxonomies
 */
function serializeMultiAttributes(taxonomies: string[]): string {
  const count = taxonomies.length;
  let inner = '';
  for (let i = 0; i < taxonomies.length; i++) {
    const tax = taxonomies[i];
    inner += `s:${tax.length}:"${tax}";a:6:{s:4:"name";s:${tax.length}:"${tax}";s:5:"value";s:0:"";s:8:"position";i:${i};s:10:"is_visible";i:1;s:12:"is_variation";i:1;s:11:"is_taxonomy";i:1;}`;
  }
  return `a:${count}:{${inner}}`;
}

// ==================== PART 1: FIX COMPOUND ATTRIBUTES ====================

async function findCompoundAttributes(connection: mysql.Connection, options: ScriptOptions): Promise<FixAction[]> {
  let whereClause = '';
  const params: any[] = [];

  if (options.productId) {
    whereClause = 'AND v.post_parent = ?';
    params.push(options.productId);
  }

  if (options.search) {
    whereClause += ' AND p.post_title LIKE ?';
    params.push(`%${options.search}%`);
  }

  // Find all variations with attribute_pa_style or attribute_pa_color that have compound values
  const query = `
    SELECT v.ID as id, v.post_parent as parentId, p.post_title as parentTitle,
      v.post_title as variationTitle,
      pm.meta_key as attrKey, pm.meta_value as attrValue,
      pm_price.meta_value as price, pm_sku.meta_value as sku
    FROM wp_posts v
    JOIN wp_posts p ON v.post_parent = p.ID
    JOIN wp_postmeta pm ON v.ID = pm.post_id AND pm.meta_key LIKE 'attribute_pa_%'
    LEFT JOIN wp_postmeta pm_price ON v.ID = pm_price.post_id AND pm_price.meta_key = '_price'
    LEFT JOIN wp_postmeta pm_sku ON v.ID = pm_sku.post_id AND pm_sku.meta_key = '_sku'
    WHERE v.post_type = 'product_variation' AND v.post_status = 'publish'
    ${whereClause}
    ORDER BY v.post_parent, v.ID
  `;

  const [rows] = await connection.execute(query, params);
  const fixActions: FixAction[] = [];

  for (const row of rows as any[]) {
    const parsed = parseCompoundSlug(row.attrValue);

    if (parsed.isCompound && parsed.color && parsed.size) {
      let fixedColor = parsed.color;

      // Try to recover multi-word color from the variation title or parent title
      // e.g., parent="Bikini Neon", variation title has " - Green L" -> full color is "Neon Green"
      // The variation title often has format: "Parent Title - VariantValue"
      const varTitle = (row.variationTitle || '').toLowerCase();
      const parentTitle = (row.parentTitle || '').toLowerCase();
      // Normalize separators so "Neon - Green" becomes "Neon Green"
      const combinedText = `${parentTitle} ${varTitle}`.replace(/\s*[-–]\s*/g, ' ').replace(/\s+/g, ' ');

      for (const mc of MULTI_WORD_COLORS) {
        if (combinedText.includes(mc)) {
          // Check that the single-word color from the slug is part of this multi-word color
          const slugColor = parsed.color.replace(/-/g, ' ');
          if (mc.includes(slugColor)) {
            fixedColor = mc.replace(/\s+/g, '-');
            break;
          }
        }
      }

      // Also check: if parent title ends with a color modifier (Neon, Light, Dark, etc.)
      // and the slug starts with a color, combine them
      if (fixedColor === parsed.color) {
        const colorPrefixes = ['neon', 'light', 'dark', 'hot', 'royal', 'baby', 'sky', 'dusty', 'deep', 'forest', 'lime', 'midnight', 'pearl', 'matte', 'wine', 'burgundy'];
        for (const prefix of colorPrefixes) {
          if (parentTitle.endsWith(` ${prefix}`)) {
            const slugColor = parsed.color.replace(/-/g, ' ');
            const combined = `${prefix} ${slugColor}`;
            if (MULTI_WORD_COLORS.includes(combined)) {
              fixedColor = combined.replace(/\s+/g, '-');
              break;
            }
          }
        }
      }

      fixActions.push({
        variationId: row.id,
        parentId: row.parentId,
        parentTitle: row.parentTitle,
        oldAttrKey: row.attrKey,
        oldAttrValue: row.attrValue,
        newColor: fixedColor,
        newSize: parsed.size,
      });
    }
  }

  if (options.limit) {
    return fixActions.slice(0, options.limit);
  }

  return fixActions;
}

async function applyAttributeFixes(connection: mysql.Connection, fixes: FixAction[]): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  // Group fixes by parent to update parent attributes once
  const byParent = new Map<number, FixAction[]>();
  for (const fix of fixes) {
    if (!byParent.has(fix.parentId)) {
      byParent.set(fix.parentId, []);
    }
    byParent.get(fix.parentId)!.push(fix);
  }

  for (const [parentId, parentFixes] of byParent) {
    await connection.beginTransaction();
    try {
      // Ensure pa_color and pa_size attributes exist
      await getOrCreateAttribute(connection, 'Color');
      await getOrCreateAttribute(connection, 'Size');

      // Get ALL variations for this parent (not just the ones being fixed)
      const [allVars] = await connection.execute(
        `SELECT v.ID as id,
          MAX(CASE WHEN pm.meta_key = 'attribute_pa_color' THEN pm.meta_value END) as color,
          MAX(CASE WHEN pm.meta_key = 'attribute_pa_size' THEN pm.meta_value END) as size,
          MAX(CASE WHEN pm.meta_key = 'attribute_pa_style' THEN pm.meta_value END) as style,
          MAX(CASE WHEN pm.meta_key = 'attribute_pa_variant' THEN pm.meta_value END) as variant
        FROM wp_posts v
        LEFT JOIN wp_postmeta pm ON v.ID = pm.post_id AND pm.meta_key LIKE 'attribute_pa_%'
        WHERE v.post_parent = ? AND v.post_type = 'product_variation'
        GROUP BY v.ID`,
        [parentId]
      );

      const fixMap = new Map(parentFixes.map(f => [f.variationId, f]));
      const allColors = new Set<string>();
      const allSizes = new Set<string>();
      let needsColor = false;
      let needsSize = false;

      // Determine what attributes this parent needs
      for (const v of allVars as any[]) {
        const fix = fixMap.get(v.id);
        if (fix) {
          // This variation is being fixed
          allColors.add(fix.newColor!);
          allSizes.add(fix.newSize!);
          needsColor = true;
          needsSize = true;
        } else {
          // Existing variation - check what it already has
          if (v.color) allColors.add(v.color);
          if (v.size) allSizes.add(v.size);
          if (v.color) needsColor = true;
          if (v.size) needsSize = true;
        }
      }

      // Fix each variation
      for (const fix of parentFixes) {
        // Remove the old attribute
        await connection.execute(
          `DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`,
          [fix.variationId, fix.oldAttrKey]
        );

        // Add color attribute
        if (fix.newColor) {
          // Remove any existing color attribute first
          await connection.execute(
            `DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = 'attribute_pa_color'`,
            [fix.variationId]
          );
          await connection.execute(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_color', ?)`,
            [fix.variationId, fix.newColor]
          );

          // Create term and link to parent
          const colorName = normalizeColor(fix.newColor);
          const { termTaxonomyId } = await getOrCreateTerm(connection, colorName, 'pa_color');
          await connection.execute(
            `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
            [parentId, termTaxonomyId]
          );
        }

        // Add size attribute
        if (fix.newSize) {
          await connection.execute(
            `DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = 'attribute_pa_size'`,
            [fix.variationId]
          );
          await connection.execute(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_size', ?)`,
            [fix.variationId, fix.newSize]
          );

          const sizeName = normalizeSize(fix.newSize);
          const { termTaxonomyId } = await getOrCreateTerm(connection, sizeName, 'pa_size');
          await connection.execute(
            `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
            [parentId, termTaxonomyId]
          );
        }
      }

      // Update parent _product_attributes to include all needed taxonomies
      const taxonomies: string[] = [];
      if (needsColor) taxonomies.push('pa_color');
      if (needsSize) taxonomies.push('pa_size');

      // Check if parent already has other attributes we need to preserve
      const [existingAttrs] = await connection.execute(
        `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_attributes'`,
        [parentId]
      );

      if ((existingAttrs as any[]).length > 0) {
        const existingStr = (existingAttrs as any[])[0].meta_value as string;
        // Check for other taxonomies in the existing serialized data
        if (existingStr.includes('pa_flavor') && !taxonomies.includes('pa_flavor')) {
          taxonomies.push('pa_flavor');
        }
        if (existingStr.includes('pa_style') && !taxonomies.includes('pa_style')) {
          // Only keep pa_style if there are variations still using it
          const [styleCount] = await connection.execute(
            `SELECT COUNT(*) as cnt FROM wp_postmeta WHERE post_id IN (
              SELECT ID FROM wp_posts WHERE post_parent = ? AND post_type = 'product_variation'
            ) AND meta_key = 'attribute_pa_style'`,
            [parentId]
          );
          if ((styleCount as any[])[0].cnt > 0) {
            taxonomies.push('pa_style');
          }
        }
      }

      const serialized = serializeMultiAttributes(taxonomies);
      await connection.execute(
        `DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_attributes'`,
        [parentId]
      );
      await connection.execute(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_attributes', ?)`,
        [parentId, serialized]
      );

      // Remove old pa_style term from parent if no variations use it anymore
      const [remainingStyle] = await connection.execute(
        `SELECT COUNT(*) as cnt FROM wp_postmeta WHERE post_id IN (
          SELECT ID FROM wp_posts WHERE post_parent = ? AND post_type = 'product_variation'
        ) AND meta_key = 'attribute_pa_style'`,
        [parentId]
      );
      if ((remainingStyle as any[])[0].cnt === 0) {
        await connection.execute(
          `DELETE tr FROM wp_term_relationships tr
           JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
           WHERE tr.object_id = ? AND tt.taxonomy = 'pa_style'`,
          [parentId]
        );
      }

      await connection.commit();
      success += parentFixes.length;
      console.log(`  Fixed ${parentFixes.length} variations for parent ${parentId} "${parentFixes[0].parentTitle}"`);

    } catch (error) {
      await connection.rollback();
      failed += parentFixes.length;
      console.error(`  FAILED parent ${parentId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return { success, failed };
}

// ==================== PART 2: MERGE PARENTS ====================

async function findMergeGroups(connection: mysql.Connection, options: ScriptOptions): Promise<MergeGroup[]> {
  let whereClause = '';
  const params: any[] = [];

  if (options.productId) {
    whereClause = 'AND p.ID = ?';
    params.push(options.productId);
  }

  if (options.search) {
    whereClause += ' AND p.post_title LIKE ?';
    params.push(`%${options.search}%`);
  }

  // Fetch all variable + simple products
  const query = `
    SELECT
      p.ID as id,
      p.post_title as title,
      p.post_name as slug,
      p.post_content as description,
      p.post_excerpt as shortDescription,
      COALESCE(pm_price.meta_value, '0') as price,
      pm_thumb.meta_value as thumbnailId,
      COALESCE(pm_gallery.meta_value, '') as galleryIds,
      t_type.slug as productType,
      (SELECT COUNT(*) FROM wp_posts v WHERE v.post_parent = p.ID AND v.post_type = 'product_variation') as variationCount,
      (SELECT COUNT(*) FROM wp_comments c WHERE c.comment_post_ID = p.ID AND c.comment_type = 'review') as reviewCount,
      (SELECT t.name FROM wp_term_relationships tr2
       JOIN wp_term_taxonomy tt2 ON tr2.term_taxonomy_id = tt2.term_taxonomy_id AND tt2.taxonomy = 'product_brand'
       JOIN wp_terms t ON tt2.term_id = t.term_id
       WHERE tr2.object_id = p.ID LIMIT 1) as brandName
    FROM wp_posts p
    JOIN wp_term_relationships tr ON p.ID = tr.object_id
    JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id AND tt.taxonomy = 'product_type'
    JOIN wp_terms t_type ON tt.term_id = t_type.term_id AND t_type.slug IN ('variable', 'simple')
    LEFT JOIN wp_postmeta pm_price ON p.ID = pm_price.post_id AND pm_price.meta_key = '_price'
    LEFT JOIN wp_postmeta pm_thumb ON p.ID = pm_thumb.post_id AND pm_thumb.meta_key = '_thumbnail_id'
    LEFT JOIN wp_postmeta pm_gallery ON p.ID = pm_gallery.post_id AND pm_gallery.meta_key = '_product_image_gallery'
    WHERE p.post_type = 'product' AND p.post_status = 'publish'
    ${whereClause}
    ORDER BY p.post_title
  `;

  const [rows] = await connection.execute(query, params);
  const products: ParentProduct[] = [];
  const seen = new Set<number>();

  for (const row of rows as any[]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    products.push({
      id: row.id,
      title: row.title || '',
      slug: row.slug || '',
      description: row.description || '',
      shortDescription: row.shortDescription || '',
      price: row.price || '0',
      thumbnailId: row.thumbnailId ? parseInt(row.thumbnailId) : null,
      galleryIds: row.galleryIds || '',
      variationCount: parseInt(row.variationCount) || 0,
      reviewCount: parseInt(row.reviewCount) || 0,
      brandName: row.brandName || 'Unknown',
      productType: row.productType,
    });
  }

  console.log(`  Fetched ${products.length} products (variable + simple)`);

  // Pass 1: Group by brand + superBaseName
  console.log('  Pass 1: Grouping by brand + superBaseName...');
  const groupMap = new Map<string, ParentProduct[]>();

  for (const product of products) {
    const superBase = extractSuperBaseName(product.title);
    if (!superBase || superBase.length < 5) continue;

    const key = `${product.brandName}|${superBase.toUpperCase()}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key)!.push(product);
  }

  // Collect multi-product groups and track which products are already grouped
  const mergeGroups: MergeGroup[] = [];
  let groupId = 0;
  const groupedIds = new Set<number>();

  for (const [key, prods] of groupMap) {
    if (prods.length < options.minGroupSize) continue;
    if (prods.length > options.maxGroupSize) continue;

    const hasVariable = prods.some(p => p.productType === 'variable');
    if (!hasVariable && prods.length < 2) continue;

    groupId++;
    const superBase = extractSuperBaseName(prods[0].title);
    const suggestedParent = selectMergeParent(prods);

    mergeGroups.push({
      groupId,
      baseName: applyTitleCase(superBase),
      brandName: prods[0].brandName,
      products: prods,
      suggestedParentId: suggestedParent.id,
      totalVariations: prods.reduce((sum, p) => sum + p.variationCount, 0),
    });

    for (const p of prods) groupedIds.add(p.id);
  }

  console.log(`    Found ${mergeGroups.length} name-based groups`);

  // Pass 2: Group ungrouped products by shared thumbnail image (by file URL, not attachment ID)
  console.log('  Pass 2: Grouping ungrouped products by shared thumbnail image...');
  const ungrouped = products.filter(p => !groupedIds.has(p.id) && p.thumbnailId && p.thumbnailId > 0);

  // Resolve thumbnail IDs to their file URLs (guid) so we catch duplicate attachment imports
  const thumbIds = [...new Set(ungrouped.map(p => p.thumbnailId!))];
  const thumbIdToGuid = new Map<number, string>();

  if (thumbIds.length > 0) {
    // Batch query in chunks of 500
    for (let i = 0; i < thumbIds.length; i += 500) {
      const chunk = thumbIds.slice(i, i + 500);
      const placeholders = chunk.map(() => '?').join(',');
      const [guidRows] = await connection.execute(
        `SELECT ID, guid FROM wp_posts WHERE ID IN (${placeholders})`,
        chunk
      );
      for (const row of guidRows as any[]) {
        // Normalize: extract just the filename from the guid URL
        const guid = (row.guid || '') as string;
        const filename = guid.split('/').pop() || guid;
        thumbIdToGuid.set(row.ID, filename);
      }
    }
  }

  // Group by normalized image filename instead of raw attachment ID
  const byThumbGuid = new Map<string, ParentProduct[]>();

  for (const product of ungrouped) {
    const filename = thumbIdToGuid.get(product.thumbnailId!);
    if (!filename) continue;

    if (!byThumbGuid.has(filename)) {
      byThumbGuid.set(filename, []);
    }
    byThumbGuid.get(filename)!.push(product);
  }

  let imageGroups = 0;
  for (const [imageFile, prods] of byThumbGuid) {
    if (prods.length < 2) continue;
    if (prods.length > options.maxGroupSize) continue;

    // All must be same brand
    const brands = new Set(prods.map(p => p.brandName));
    if (brands.size > 1) continue;

    // Verify the titles are actually similar by comparing super base names
    // This ensures "Bodysuit" and "Halter & Panty" (different items) don't get merged
    const superBaseNames = prods.map(p => extractSuperBaseName(p.title).toUpperCase());
    // Use the longest super base name as reference (less likely to be truncated)
    const longestBase = superBaseNames.reduce((a, b) => a.length >= b.length ? a : b);
    const allSameBase = superBaseNames.every(base => base === longestBase);
    if (!allSameBase) {
      // Allow if one base is a prefix of another (truncated title) or very high word overlap
      const allSimilar = superBaseNames.every(base => {
        if (base === longestBase) return true;
        // Check prefix match (handles truncated titles)
        if (longestBase.startsWith(base) || base.startsWith(longestBase)) return true;
        // Strict word overlap (>85%) as last resort
        const baseWords = new Set(base.split(/\s+/));
        const refWords = new Set(longestBase.split(/\s+/));
        const shared = [...refWords].filter(w => baseWords.has(w)).length;
        return shared / Math.max(refWords.size, baseWords.size) > 0.85;
      });
      if (!allSimilar) continue;
    }

    groupId++;
    imageGroups++;
    const superBase = extractSuperBaseName(prods[0].title);
    const suggestedParent = selectMergeParent(prods);

    mergeGroups.push({
      groupId,
      baseName: applyTitleCase(superBase),
      brandName: prods[0].brandName,
      products: prods,
      suggestedParentId: suggestedParent.id,
      totalVariations: prods.reduce((sum, p) => sum + p.variationCount, 0),
    });

    for (const p of prods) groupedIds.add(p.id);
  }

  console.log(`    Found ${imageGroups} image-based groups`);

  // Sort by total products (largest first)
  mergeGroups.sort((a, b) => b.products.length - a.products.length);
  mergeGroups.forEach((g, i) => g.groupId = i + 1);

  if (options.limit) {
    return mergeGroups.slice(0, options.limit);
  }

  return mergeGroups;
}

function selectMergeParent(products: ParentProduct[]): ParentProduct {
  let bestScore = -1;
  let bestProduct = products[0];

  for (const product of products) {
    let score = 0;
    // Prefer variable products (already have variations set up)
    if (product.productType === 'variable') score += 5;
    // Prefer products with more variations
    score += product.variationCount * 2;
    // Prefer products with images
    if (product.thumbnailId) score += 3;
    if (product.galleryIds) score += 2;
    // Prefer products with content
    if (product.description && product.description.length > 50) score += 2;
    // Prefer products with reviews
    score += product.reviewCount;

    if (score > bestScore) {
      bestScore = score;
      bestProduct = product;
    }
  }

  return bestProduct;
}

/**
 * Determine the color and size for a product based on its title
 * compared to the super base name.
 */
function extractColorAndSize(title: string, superBaseName: string): { color: string | null; size: string | null } {
  // Normalize hyphens before color/size words to spaces for matching
  const normalizedTitle = title.replace(/-(?=black|white|red|blue|green|pink|purple|navy|wine|grey|gray|nude|beige|orange|yellow|silver|gold|clear|brown|teal|ivory|coral|turquoise|burgundy|neon|hot|light|dark|royal|baby|small|medium|large|x-large|xx-large|o-s|mini|petite|blk|wht|pnk|prp|blu|grn|gld|slv|brn|ylw)\b/gi, ' ');
  const upper = normalizedTitle.toUpperCase();
  const superUpper = superBaseName.toUpperCase();

  // Get the suffix (part after the super base name)
  let suffix = '';
  const idx = upper.indexOf(superUpper);
  if (idx >= 0) {
    suffix = normalizedTitle.substring(idx + superBaseName.length).trim();
  } else {
    // Try with original title too
    const origIdx = title.toUpperCase().indexOf(superUpper);
    if (origIdx >= 0) {
      suffix = title.substring(origIdx + superBaseName.length).trim();
    } else {
      // Fuzzy: just take the trailing part that differs
      suffix = normalizedTitle;
    }
  }

  // Clean the suffix
  suffix = suffix.replace(/^[\s\-.:]+|[\s\-.:]+$/g, '').trim();

  if (!suffix) return { color: null, size: null };

  const lowerSuffix = suffix.toLowerCase();

  // Check for multi-word color first
  let color: string | null = null;
  let size: string | null = null;

  for (const mc of MULTI_WORD_COLORS) {
    if (lowerSuffix.includes(mc)) {
      color = mc.replace(/\s+/g, '-');
      // Remove the color from suffix to find remaining size
      const remaining = lowerSuffix.replace(mc, '').replace(/^[\s\-]+|[\s\-]+$/g, '').trim();
      if (remaining && SIZE_PATTERNS.test(remaining.replace(/\s+/g, '-'))) {
        size = remaining.replace(/\s+/g, '-');
      }
      break;
    }
  }

  // Check for single-word color
  if (!color) {
    const words = suffix.split(/[\s\-]+/);
    for (const word of words) {
      if (SINGLE_COLORS.includes(word.toLowerCase())) {
        color = word.toLowerCase();
        // Check remaining words for size
        const remaining = words.filter(w => w.toLowerCase() !== color).join('-').toLowerCase();
        if (remaining && SIZE_PATTERNS.test(remaining)) {
          size = remaining;
        }
        break;
      }
    }
  }

  // Check for size if not found yet
  if (!size) {
    const words = suffix.split(/[\s\-]+/);
    for (const word of words) {
      if (SIZE_PATTERNS.test(word.toLowerCase())) {
        size = word.toLowerCase();
        break;
      }
    }
    // Also check combined size patterns like "S/M"
    if (!size) {
      const sizeMatch = suffix.match(/\b(S\/M|M\/L|L\/XL|XL\/XXL|O\/S|OS|1X|2X|3X|4X|1X\/2X|3X\/4X|OSQ)\b/i);
      if (sizeMatch) {
        size = sizeMatch[1].toLowerCase().replace(/\//g, '-');
      }
    }
  }

  return { color, size };
}

async function executeMerge(connection: mysql.Connection, group: MergeGroup): Promise<{ success: boolean; error?: string }> {
  await connection.beginTransaction();

  try {
    const keepParentId = group.suggestedParentId;
    const otherProducts = group.products.filter(p => p.id !== keepParentId);

    console.log(`    Merging ${group.products.length} products -> parent ${keepParentId}`);

    // Step 1: Make sure parent is 'variable' type
    const [typeCheck] = await connection.execute(
      `SELECT t.slug FROM wp_term_relationships tr
       JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id AND tt.taxonomy = 'product_type'
       JOIN wp_terms t ON tt.term_id = t.term_id
       WHERE tr.object_id = ?`,
      [keepParentId]
    );

    const currentType = (typeCheck as any[])[0]?.slug;

    if (currentType === 'simple') {
      // Convert to variable
      const [simpleTypeRows] = await connection.execute(
        `SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt
         JOIN wp_terms t ON tt.term_id = t.term_id
         WHERE t.slug = 'simple' AND tt.taxonomy = 'product_type'`
      );
      const [variableTypeRows] = await connection.execute(
        `SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt
         JOIN wp_terms t ON tt.term_id = t.term_id
         WHERE t.slug = 'variable' AND tt.taxonomy = 'product_type'`
      );

      const simpleTermTaxId = (simpleTypeRows as any[])[0]?.term_taxonomy_id;
      const variableTermTaxId = (variableTypeRows as any[])[0]?.term_taxonomy_id;

      await connection.execute(
        `DELETE FROM wp_term_relationships WHERE object_id = ? AND term_taxonomy_id = ?`,
        [keepParentId, simpleTermTaxId]
      );
      await connection.execute(
        `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
        [keepParentId, variableTermTaxId]
      );
    }

    // Step 2: Rename parent to super base name
    const parentSlug = group.baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 200);
    await connection.execute(
      `UPDATE wp_posts SET post_title = ?, post_name = ? WHERE ID = ?`,
      [group.baseName, parentSlug, keepParentId]
    );

    // Step 2b: If kept parent was a simple product, create a variation for its own data
    const keepParentData = group.products.find(p => p.id === keepParentId)!;
    if (keepParentData.productType === 'simple') {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const { color, size } = extractColorAndSize(keepParentData.title, group.baseName);

      const [varResult] = await connection.execute(
        `INSERT INTO wp_posts (
          post_author, post_date, post_date_gmt, post_content, post_title,
          post_excerpt, post_status, comment_status, ping_status, post_password,
          post_name, to_ping, pinged, post_modified, post_modified_gmt,
          post_content_filtered, post_parent, guid, menu_order, post_type,
          post_mime_type, comment_count
        ) VALUES (
          1, ?, ?, '', '',
          '', 'publish', 'closed', 'closed', '',
          '', '', '', ?, ?,
          '', ?, '', 0, 'product_variation',
          '', 0
        )`,
        [now, now, now, now, keepParentId]
      );

      const parentVarId = (varResult as any).insertId;

      await connection.execute(
        `UPDATE wp_posts SET guid = ? WHERE ID = ?`,
        [`http://maleq-local.local/?post_type=product_variation&p=${parentVarId}`, parentVarId]
      );

      // Copy relevant meta from parent
      const metaKeys = ['_sku', '_regular_price', '_sale_price', '_price', '_stock', '_stock_status',
        '_manage_stock', '_backorders', '_virtual', '_downloadable', '_thumbnail_id', '_low_stock_amount',
        '_wt_barcode', '_wt_color', '_wt_material'];

      const [parentMetas] = await connection.execute(
        `SELECT meta_key, meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key IN (${metaKeys.map(() => '?').join(',')})`,
        [keepParentId, ...metaKeys]
      );

      for (const meta of parentMetas as any[]) {
        await connection.execute(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
          [parentVarId, meta.meta_key, meta.meta_value]
        );
      }

      if (color) {
        await connection.execute(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_color', ?)`,
          [parentVarId, color]
        );
      }
      if (size) {
        await connection.execute(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_size', ?)`,
          [parentVarId, size]
        );
      }

      // Add to WooCommerce lookup
      const pPrice = (parentMetas as any[]).find(m => m.meta_key === '_price')?.meta_value || '0';
      const pSku = (parentMetas as any[]).find(m => m.meta_key === '_sku')?.meta_value || '';
      const pStock = parseInt((parentMetas as any[]).find(m => m.meta_key === '_stock')?.meta_value || '0');
      const pStockStatus = (parentMetas as any[]).find(m => m.meta_key === '_stock_status')?.meta_value || 'outofstock';

      await connection.execute(
        `INSERT INTO wp_wc_product_meta_lookup (
          product_id, sku, \`virtual\`, downloadable, min_price, max_price,
          onsale, stock_quantity, stock_status, rating_count, average_rating, total_sales
        ) VALUES (?, ?, 0, 0, ?, ?, 0, ?, ?, 0, 0, 0)`,
        [parentVarId, pSku, pPrice, pPrice, pStock, pStockStatus]
      );
    }

    // Step 3: Re-parent variations from other products
    for (const other of otherProducts) {
      if (other.productType === 'variable') {
        // Move all variations to the new parent
        await connection.execute(
          `UPDATE wp_posts SET post_parent = ? WHERE post_parent = ? AND post_type = 'product_variation'`,
          [keepParentId, other.id]
        );
      } else {
        // 'simple' product - need to convert to variation
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

        // Determine color/size from title
        const { color, size } = extractColorAndSize(other.title, group.baseName);

        // Create a new variation post for this simple product's data
        const [varResult] = await connection.execute(
          `INSERT INTO wp_posts (
            post_author, post_date, post_date_gmt, post_content, post_title,
            post_excerpt, post_status, comment_status, ping_status, post_password,
            post_name, to_ping, pinged, post_modified, post_modified_gmt,
            post_content_filtered, post_parent, guid, menu_order, post_type,
            post_mime_type, comment_count
          ) VALUES (
            1, ?, ?, '', '',
            '', 'publish', 'closed', 'closed', '',
            '', '', '', ?, ?,
            '', ?, '', 0, 'product_variation',
            '', 0
          )`,
          [now, now, now, now, keepParentId]
        );

        const variationId = (varResult as any).insertId;

        await connection.execute(
          `UPDATE wp_posts SET guid = ? WHERE ID = ?`,
          [`http://maleq-local.local/?post_type=product_variation&p=${variationId}`, variationId]
        );

        // Copy relevant meta from the simple product
        const metaKeys = ['_sku', '_regular_price', '_sale_price', '_price', '_stock', '_stock_status',
          '_manage_stock', '_backorders', '_virtual', '_downloadable', '_thumbnail_id', '_low_stock_amount',
          '_wt_barcode', '_wt_color', '_wt_material'];

        const [metas] = await connection.execute(
          `SELECT meta_key, meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key IN (${metaKeys.map(() => '?').join(',')})`,
          [other.id, ...metaKeys]
        );

        for (const meta of metas as any[]) {
          await connection.execute(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
            [variationId, meta.meta_key, meta.meta_value]
          );
        }

        // Add color/size attributes to the new variation
        if (color) {
          await connection.execute(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_color', ?)`,
            [variationId, color]
          );
        }
        if (size) {
          await connection.execute(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_size', ?)`,
            [variationId, size]
          );
        }

        // Add to WooCommerce lookup table
        const otherPrice = (metas as any[]).find(m => m.meta_key === '_price')?.meta_value || '0';
        const otherSku = (metas as any[]).find(m => m.meta_key === '_sku')?.meta_value || '';
        const otherStock = parseInt((metas as any[]).find(m => m.meta_key === '_stock')?.meta_value || '0');
        const otherStockStatus = (metas as any[]).find(m => m.meta_key === '_stock_status')?.meta_value || 'outofstock';

        await connection.execute(
          `INSERT INTO wp_wc_product_meta_lookup (
            product_id, sku, \`virtual\`, downloadable, min_price, max_price,
            onsale, stock_quantity, stock_status, rating_count, average_rating, total_sales
          ) VALUES (?, ?, 0, 0, ?, ?, 0, ?, ?, 0, 0, 0)`,
          [variationId, otherSku, otherPrice, otherPrice, otherStock, otherStockStatus]
        );

        // Now delete/hide the original simple product
        await connection.execute(
          `UPDATE wp_posts SET post_status = 'trash' WHERE ID = ?`,
          [other.id]
        );
      }
    }

    // Step 4: Move reviews from other parents to keep parent
    for (const other of otherProducts) {
      await connection.execute(
        `UPDATE wp_comments SET comment_post_ID = ? WHERE comment_post_ID = ?`,
        [keepParentId, other.id]
      );
    }

    // Step 5: Copy categories/brands from other products to parent (if missing)
    for (const other of otherProducts) {
      // Copy product_cat and product_brand relationships
      const [otherTerms] = await connection.execute(
        `SELECT tr.term_taxonomy_id, tt.taxonomy
         FROM wp_term_relationships tr
         JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
         WHERE tr.object_id = ? AND tt.taxonomy IN ('product_cat', 'product_brand')`,
        [other.id]
      );

      for (const term of otherTerms as any[]) {
        await connection.execute(
          `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
          [keepParentId, term.term_taxonomy_id]
        );
      }

      // Trash the other parent (if variable) - variations already moved
      if (other.productType === 'variable') {
        await connection.execute(
          `UPDATE wp_posts SET post_status = 'trash' WHERE ID = ?`,
          [other.id]
        );
      }
    }

    // Step 6: Collect all variation attributes and update parent
    const [allVariations] = await connection.execute(
      `SELECT v.ID as id,
        GROUP_CONCAT(DISTINCT CASE WHEN pm.meta_key = 'attribute_pa_color' THEN pm.meta_value END) as color,
        GROUP_CONCAT(DISTINCT CASE WHEN pm.meta_key = 'attribute_pa_size' THEN pm.meta_value END) as size,
        GROUP_CONCAT(DISTINCT CASE WHEN pm.meta_key = 'attribute_pa_style' THEN pm.meta_value END) as style,
        GROUP_CONCAT(DISTINCT CASE WHEN pm.meta_key = 'attribute_pa_flavor' THEN pm.meta_value END) as flavor
      FROM wp_posts v
      LEFT JOIN wp_postmeta pm ON v.ID = pm.post_id AND pm.meta_key LIKE 'attribute_pa_%'
      WHERE v.post_parent = ? AND v.post_type = 'product_variation' AND v.post_status = 'publish'
      GROUP BY v.ID`,
      [keepParentId]
    );

    const hasColor = (allVariations as any[]).some(v => v.color);
    const hasSize = (allVariations as any[]).some(v => v.size);
    const hasStyle = (allVariations as any[]).some(v => v.style);
    const hasFlavor = (allVariations as any[]).some(v => v.flavor);

    // Ensure attributes exist and set up terms
    const taxonomies: string[] = [];
    if (hasColor) {
      await getOrCreateAttribute(connection, 'Color');
      taxonomies.push('pa_color');

      // Link all color terms to parent
      const colorValues = new Set((allVariations as any[]).filter(v => v.color).map(v => v.color));
      for (const colorSlug of colorValues) {
        const colorName = normalizeColor(colorSlug);
        const { termTaxonomyId } = await getOrCreateTerm(connection, colorName, 'pa_color');
        await connection.execute(
          `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
          [keepParentId, termTaxonomyId]
        );
      }
    }
    if (hasSize) {
      await getOrCreateAttribute(connection, 'Size');
      taxonomies.push('pa_size');

      const sizeValues = new Set((allVariations as any[]).filter(v => v.size).map(v => v.size));
      for (const sizeSlug of sizeValues) {
        const sizeName = normalizeSize(sizeSlug);
        const { termTaxonomyId } = await getOrCreateTerm(connection, sizeName, 'pa_size');
        await connection.execute(
          `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
          [keepParentId, termTaxonomyId]
        );
      }
    }
    if (hasStyle) {
      await getOrCreateAttribute(connection, 'Style');
      taxonomies.push('pa_style');
    }
    if (hasFlavor) {
      await getOrCreateAttribute(connection, 'Flavor');
      taxonomies.push('pa_flavor');
    }

    // Set _product_attributes
    if (taxonomies.length > 0) {
      const serialized = serializeMultiAttributes(taxonomies);
      await connection.execute(
        `DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_attributes'`,
        [keepParentId]
      );
      await connection.execute(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_attributes', ?)`,
        [keepParentId, serialized]
      );
    }

    // Step 7: Update parent pricing
    const [priceRows] = await connection.execute(
      `SELECT MIN(CAST(pm.meta_value AS DECIMAL(10,2))) as minPrice,
              MAX(CAST(pm.meta_value AS DECIMAL(10,2))) as maxPrice
       FROM wp_posts v
       JOIN wp_postmeta pm ON v.ID = pm.post_id AND pm.meta_key = '_price'
       WHERE v.post_parent = ? AND v.post_type = 'product_variation' AND v.post_status = 'publish'`,
      [keepParentId]
    );

    const minPrice = (priceRows as any[])[0]?.minPrice || 0;
    const maxPrice = (priceRows as any[])[0]?.maxPrice || 0;

    // Update or insert parent price
    await connection.execute(
      `DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key IN ('_price', '_regular_price', '_sale_price')`,
      [keepParentId]
    );
    await connection.execute(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_price', ?)`,
      [keepParentId, minPrice.toString()]
    );

    // Update parent stock management
    await connection.execute(
      `DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = '_manage_stock'`,
      [keepParentId]
    );
    await connection.execute(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_manage_stock', 'no')`,
      [keepParentId]
    );

    // Update WooCommerce lookup
    await connection.execute(
      `UPDATE wp_wc_product_meta_lookup
       SET min_price = ?, max_price = ?, stock_status = 'instock'
       WHERE product_id = ?`,
      [minPrice, maxPrice, keepParentId]
    );

    // Step 8: Copy images from merged parents if needed
    const keepParent = group.products.find(p => p.id === keepParentId)!;
    if (!keepParent.thumbnailId) {
      // Find a product with an image
      for (const other of otherProducts) {
        if (other.thumbnailId) {
          await connection.execute(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_thumbnail_id', ?)
             ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
            [keepParentId, other.thumbnailId.toString()]
          );
          break;
        }
      }
    }

    await connection.commit();
    return { success: true };

  } catch (error) {
    await connection.rollback();
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ==================== REPORTING ====================

function printFixReport(fixes: FixAction[]): void {
  // Group by parent
  const byParent = new Map<number, FixAction[]>();
  for (const fix of fixes) {
    if (!byParent.has(fix.parentId)) {
      byParent.set(fix.parentId, []);
    }
    byParent.get(fix.parentId)!.push(fix);
  }

  console.log(`\n=== COMPOUND ATTRIBUTE FIX REPORT ===\n`);
  console.log(`Total variations to fix: ${fixes.length}`);
  console.log(`Across ${byParent.size} parent products\n`);

  for (const [parentId, parentFixes] of byParent) {
    console.log(`--- Parent ${parentId}: "${parentFixes[0].parentTitle}" ---`);
    for (const fix of parentFixes) {
      const colorLabel = fix.newColor ? normalizeColor(fix.newColor) : '(none)';
      const sizeLabel = fix.newSize ? normalizeSize(fix.newSize) : '(none)';
      console.log(`  Variation ${fix.variationId}: ${fix.oldAttrKey}="${fix.oldAttrValue}" -> color="${colorLabel}", size="${sizeLabel}"`);
    }
    console.log('');
  }
}

function printMergeReport(groups: MergeGroup[]): void {
  const totalProducts = groups.reduce((sum, g) => sum + g.products.length, 0);
  const totalVariations = groups.reduce((sum, g) => sum + g.totalVariations, 0);

  console.log(`\n=== MERGE CANDIDATES REPORT ===\n`);
  console.log(`Total merge groups: ${groups.length}`);
  console.log(`Total products that would be merged: ${totalProducts}`);
  console.log(`Total existing variations across these products: ${totalVariations}\n`);

  for (const group of groups) {
    console.log(`--- Group ${group.groupId}: "${group.baseName}" ---`);
    console.log(`  Brand: ${group.brandName}`);
    console.log(`  Products (${group.products.length}):`);

    for (const p of group.products) {
      const parentMarker = p.id === group.suggestedParentId ? ' [KEEP]' : '';
      const typeLabel = p.productType === 'variable' ? `var(${p.variationCount})` : 'simple';
      const { color, size } = extractColorAndSize(p.title, group.baseName);
      const colorLabel = color ? normalizeColor(color) : '-';
      const sizeLabel = size ? normalizeSize(size) : '-';
      console.log(`    ID: ${p.id}  "${p.title}"  [${typeLabel}]  $${p.price}  Color: ${colorLabel}  Size: ${sizeLabel}${parentMarker}`);
    }
    console.log('');
  }
}

// ==================== MAIN ====================

async function main(): Promise<void> {
  const options = parseArgs();

  console.log(`\nFix and Merge Variations - Mode: ${options.mode.toUpperCase()}\n`);

  const connection = await getConnection();

  console.log('Connected to Local MySQL database\n');

  try {
    if (options.mode === 'analyze' || options.mode === 'dry-run') {
      // Show both: attribute fixes and merge candidates
      console.log('=== PART 1: Scanning for compound attribute values ===\n');
      const fixes = await findCompoundAttributes(connection, options);
      printFixReport(fixes);

      console.log('=== PART 2: Scanning for merge candidates ===\n');
      const groups = await findMergeGroups(connection, options);
      printMergeReport(groups);

      if (options.output) {
        const report = {
          timestamp: new Date().toISOString(),
          attributeFixes: fixes,
          mergeGroups: groups,
        };
        writeFileSync(options.output, JSON.stringify(report, null, 2));
        console.log(`\nReport written to: ${options.output}`);
      }

    } else if (options.mode === 'fix-attributes') {
      console.log('Scanning for compound attribute values...\n');
      const fixes = await findCompoundAttributes(connection, options);
      printFixReport(fixes);

      if (fixes.length === 0) {
        console.log('No compound attributes found to fix.');
        return;
      }

      console.log(`\n=== APPLYING ${fixes.length} ATTRIBUTE FIXES ===\n`);
      const { success, failed } = await applyAttributeFixes(connection, fixes);
      console.log(`\nDone! Success: ${success}, Failed: ${failed}`);

    } else if (options.mode === 'merge') {
      console.log('Scanning for merge candidates...\n');
      const groups = await findMergeGroups(connection, options);
      printMergeReport(groups);

      if (groups.length === 0) {
        console.log('No merge candidates found.');
        return;
      }

      console.log(`\n=== APPLYING ${groups.length} MERGES ===\n`);
      let successCount = 0;
      let failCount = 0;

      for (const group of groups) {
        console.log(`  Merging group ${group.groupId}: "${group.baseName}" (${group.products.length} products)...`);
        const result = await executeMerge(connection, group);
        if (result.success) {
          console.log(`    Success!`);
          successCount++;
        } else {
          console.log(`    FAILED: ${result.error}`);
          failCount++;
        }
      }

      console.log(`\n=== MERGE SUMMARY ===`);
      console.log(`Successful: ${successCount}`);
      console.log(`Failed: ${failCount}`);
    }

  } finally {
    await connection.end();
  }
}

main().catch(console.error);
