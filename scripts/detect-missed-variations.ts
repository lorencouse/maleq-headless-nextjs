#!/usr/bin/env bun

/**
 * Detect Missed Variations Script
 *
 * Scans the database for simple products that should be grouped as variations
 * of a parent variable product. Detects products with similar names and
 * identical/similar prices from the same brand.
 *
 * Usage:
 *   bun scripts/detect-missed-variations.ts [mode] [options]
 *
 * Modes:
 *   --analyze         Analyze and report potential variation groups (default)
 *   --dry-run         Show exactly what changes would be made
 *   --apply           Apply conversions to the database
 *
 * Options:
 *   --min-group-size <n>   Minimum products to form group (default: 2)
 *   --max-group-size <n>   Maximum products per group (default: 10)
 *   --brand <code>         Only check specific brand/manufacturer code
 *   --output <file>        Write JSON report to file
 *   --input <file>         Read approved groups from JSON (for --apply)
 *   --exclude-ids <ids>    Comma-separated product IDs to exclude
 *   --price-tolerance <n>  Price tolerance percentage (default: 0 = exact)
 *   --limit <n>            Limit number of groups to process
 *   --help, -h             Show help
 */

import mysql from 'mysql2/promise';
import { writeFileSync, readFileSync } from 'fs';

// ==================== DATABASE CONFIG ====================

const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

// ==================== TYPES ====================

interface SimpleProduct {
  id: number;
  title: string;
  slug: string;
  status: string;
  description: string;
  shortDescription: string;
  sku: string;
  barcode: string;
  regularPrice: string;
  salePrice: string;
  price: string;
  stockQty: number;
  stockStatus: string;
  color: string;
  material: string;
  manufacturerCode: string;
  brandName: string;
  thumbnailId: number | null;
  galleryIds: string;
}

interface DetectedGroup {
  groupId: number;
  baseName: string;
  brandCode: string;
  brandName: string;
  products: SimpleProduct[];
  variationAttribute: 'color' | 'flavor' | 'size' | 'style' | null;
  suggestedParentId: number;
  confidence: 'high' | 'medium' | 'low';
}

interface AnalysisReport {
  timestamp: string;
  totalSimpleProducts: number;
  totalGroupsFound: number;
  totalProductsInGroups: number;
  groups: DetectedGroup[];
}

interface ConversionResult {
  groupId: number;
  baseName: string;
  parentId: number;
  variationIds: number[];
  success: boolean;
  error?: string;
}

interface ScriptOptions {
  mode: 'analyze' | 'dry-run' | 'apply';
  minGroupSize: number;
  maxGroupSize: number;
  brand?: string;
  output?: string;
  input?: string;
  excludeIds: Set<number>;
  priceTolerance: number;
  limit?: number;
  minConfidence?: 'high' | 'medium' | 'low';
}

// ==================== ARGUMENT PARSING ====================

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const options: ScriptOptions = {
    mode: 'analyze',
    minGroupSize: 2,
    maxGroupSize: 10,
    excludeIds: new Set(),
    priceTolerance: 0,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--analyze') {
      options.mode = 'analyze';
    } else if (arg === '--dry-run') {
      options.mode = 'dry-run';
    } else if (arg === '--apply') {
      options.mode = 'apply';
    } else if (arg === '--min-group-size' && i + 1 < args.length) {
      options.minGroupSize = parseInt(args[++i], 10);
    } else if (arg === '--max-group-size' && i + 1 < args.length) {
      options.maxGroupSize = parseInt(args[++i], 10);
    } else if (arg === '--brand' && i + 1 < args.length) {
      options.brand = args[++i];
    } else if (arg === '--output' && i + 1 < args.length) {
      options.output = args[++i];
    } else if (arg === '--input' && i + 1 < args.length) {
      options.input = args[++i];
    } else if (arg === '--exclude-ids' && i + 1 < args.length) {
      const ids = args[++i].split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
      options.excludeIds = new Set(ids);
    } else if (arg === '--price-tolerance' && i + 1 < args.length) {
      options.priceTolerance = parseFloat(args[++i]);
    } else if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[++i], 10);
    } else if (arg === '--min-confidence' && i + 1 < args.length) {
      const val = args[++i].toLowerCase();
      if (val === 'high' || val === 'medium' || val === 'low') {
        options.minConfidence = val;
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Detect Missed Variations Script

Scans for simple products that should be grouped as variations.

Usage:
  bun scripts/detect-missed-variations.ts [mode] [options]

Modes:
  --analyze         Analyze and report potential variation groups (default)
  --dry-run         Show exactly what changes would be made
  --apply           Apply conversions to the database

Options:
  --min-group-size <n>   Minimum products to form group (default: 2)
  --max-group-size <n>   Maximum products per group (default: 10)
  --brand <code>         Only check specific brand/manufacturer code
  --output <file>        Write JSON report to file
  --input <file>         Read approved groups from JSON (for --apply)
  --exclude-ids <ids>    Comma-separated product IDs to exclude
  --price-tolerance <n>  Price tolerance percentage (default: 0 = exact match)
  --limit <n>            Limit number of groups to process
  --help, -h             Show help

Examples:
  bun scripts/detect-missed-variations.ts --analyze
  bun scripts/detect-missed-variations.ts --analyze --brand DOC --output data/variation-report.json
  bun scripts/detect-missed-variations.ts --dry-run --limit 5
  bun scripts/detect-missed-variations.ts --apply --input data/variation-report.json
      `);
      process.exit(0);
    }
  }

  return options;
}

// ==================== NAME EXTRACTION (ported from xml-parser.ts) ====================

/**
 * Extract base name from product title by stripping variation indicators
 * (colors, sizes, flavors, styles, volumes, dimensions, etc.)
 * Ported from XMLParser.extractBaseName()
 */
function extractBaseName(name: string): string {
  let baseName = name;

  // Clean up trailing quote marks (often used to indicate inches)
  baseName = baseName.replace(/\s*["″"]\s*$/g, '').trim();

  // Normalize packaging suffixes early so color/size stripping can reach the end
  for (let i = 0; i < 2; i++) {
    baseName = baseName.replace(/\s+HANGING\s*$/gi, '');
    baseName = baseName.replace(/\s+HANGI?\s*$/gi, '');
    baseName = baseName.replace(/\s+BOXED\s*$/gi, '');
    baseName = baseName.replace(/\s+CARDED\s*$/gi, '');
    baseName = baseName.replace(/\s+DISPLAY\s*$/gi, '');
  }

  // Protect size combos from hyphen-to-space conversion
  baseName = baseName.replace(/\bx-large\b/gi, 'XLARGE');
  baseName = baseName.replace(/\bxx-large\b/gi, 'XXLARGE');
  baseName = baseName.replace(/\bxxx-large\b/gi, 'XXXLARGE');
  baseName = baseName.replace(/\bx-small\b/gi, 'XSMALL');
  // Convert hyphens before color words to spaces
  baseName = baseName.replace(/-(?=black|white|red|blue|green|pink|purple|navy|wine|grey|gray|nude|beige|orange|yellow|silver|gold|clear|brown|teal|ivory|coral|turquoise|burgundy|neon|hot|light|dark|royal|baby|small|medium|large|mini|petite)\b/gi, ' ');

  // Remove volume/size patterns with units
  baseName = baseName.replace(/\s*\.?\d+(\.\d+)?\s*(FL\.?\s*)?(OZ|OUNCES?|ML|MILLILITERS?|L|LITERS?|G|GRAMS?|MG|LB|LBS|POUNDS?|O)\.?\s*(\/\s*\.?\d+(\.\d+)?\s*(FL\.?\s*)?(OZ|OUNCES?|ML|MILLILITERS?|L|LITERS?|G|GRAMS?|MG|LB|LBS|POUNDS?|O)\.?)?\b/gi, '');

  // Remove length/dimension patterns
  baseName = baseName.replace(/\s*\d+(\.\d+)?\s*(INCHES?|IN|"|″|MM|MILLIMETERS?|CM|CENTIMETERS?|FT|FEET|FOOT)\b/gi, '');

  // Remove pack/count patterns
  baseName = baseName.replace(/\s*\d+\s*(PK|PACK|PC|PCS|PIECES?|CT|COUNT)\s*(BOWL|BOX|BAG|DISPLAY|JAR)?\b/gi, '');

  // Remove standalone decimal numbers at end
  baseName = baseName.replace(/\s+\d+\.?\d*\s*$/gi, '');

  // Remove bracketed/parenthesized content
  baseName = baseName.replace(/\s*\[.*?\]/g, '');
  baseName = baseName.replace(/\s*\(net\)/gi, '');
  baseName = baseName.replace(/\s*\(.*?\)/g, '');

  // Remove size abbreviations
  baseName = baseName.replace(/\s+(XS|X-?SMALL|X-?LARGE|XX-?LARGE|XXX-?LARGE|XXL|XXXL|2XL|3XL|4XL|S\/M|M\/L|L\/XL|XL\/XXL|O\/S|OS|ONE\s*SIZE|QUEEN|Q\/S|OS\s*QUEEN|OSQ|1X|2X|3X|4X|1X\/2X|3X\/4X|1XL|2XL|3XL)\b/gi, '');
  baseName = baseName.replace(/\s+[SML]\s*$/gi, '');

  // Remove multi-word variants (order matters: longer phrases first)
  const multiWordVariants = [
    // Multi-word colors (must come before single-word color stripping)
    'NEON GREEN', 'NEON PINK', 'NEON BLUE', 'NEON YELLOW', 'NEON ORANGE', 'NEON LIME',
    'NEON PURPLE', 'NEON RED',
    'HOT PINK', 'HOT PNK', 'HOT RED',
    'LIGHT BLUE', 'LIGHT PINK', 'LIGHT PURPLE', 'LIGHT GREEN',
    'DARK BLUE', 'DARK GREEN', 'DARK PURPLE', 'DARK RED', 'DARK BROWN',
    'ROYAL BLUE', 'BABY BLUE', 'SKY BLUE', 'BABY PINK', 'DUSTY ROSE', 'DUSTY PINK',
    'WINE RED', 'BURGUNDY RED', 'DEEP PURPLE', 'FOREST GREEN', 'LIME GREEN',
    'MIDNIGHT BLUE', 'MIDNIGHT BLACK', 'PEARL WHITE', 'ROSE GOLD', 'MATTE BLACK',
    'BLACK ICE', 'CLASSIC WHITE',
    // Flavors
    'GIDDY GRAPE', 'PEACH PIZAZZ', 'PINEAPPLE PUCKER', "ROCKIN' RASPBERRY", 'ROCKIN RASPBERRY',
    'SPUN SUGAR', 'WICKED WATERMELON', 'BERRY BLAST', 'WACKY WATERMELON', 'SASSY STRAWBERRY',
    'RASPBERRY RAVE', 'MELON MADNESS', 'STRAWBERRY SENSATION', 'STRAWBERRY TWIST', 'PINK LEMONADE',
    'LEMON DROP', 'SEX ON THE BEACH', 'STRAWB & CHAMPAGNE', 'DRY MARTINI',
    'BLUE LAGOON', 'PURPLE HAZE', 'PEACH BELLINI', 'PURPLE COSMO', 'MINT MOJITO',
    'FLORAL HAZE', 'FROSTED CAKE', 'ISLAND PARADISE', 'PEACHY KEEN', 'SWEET NECTAR',
    'KASHMIR MUSK', 'ZEN BERRY ROSE', 'MISTLETOE MISCHIEF', 'TINSEL TEASE',
    'YULE BE BEGGING', 'OH OH OH', 'STUFF MY STOCKING', 'DREAMSICLE', 'GUAVALAVA',
    'HIGH TIDE', 'SKINNY DIP', 'SUNSATIONAL', 'SUMMER FLING', 'FRESH SQUEEZED',
    'BABY ITS COLD OUTSIDE',
    'FRODO SINGLE', 'GANDALF BLACK', 'ELENDIL 3 PACK', 'ELROND COCK GATE',
    "DON'T STOP", 'DONT STOP', 'BAD GIRL', 'HIT IT HARD', 'FUCK YEAH',
    'L CUFFS ANKLE', 'LOVE CUFFS WRIST', 'RIDING CROP & TICKLER', 'TIE ME UPS',
    'PINA COLADA', 'MANGO PASSION', 'CHERRY LEMONADE', 'BUTTER RUM', 'BANANA CREAM',
    'KEY LIME', 'ORANGE CREAM', 'TAHITIAN VANILLA', 'NATURAL ALOE',
    'CREME BRULEE', 'MINT CHOCOLATE', 'COOKIES AND CREAM', 'STRAWBERRY BANANA',
    'PASSION FRUIT', 'BLUE RASPBERRY', 'GREEN APPLE', 'COTTON CANDY',
    'BUBBLE GUM', 'ROOT BEER', 'CHERRY VANILLA', 'CHOCOLATE MINT', 'FRENCH LAVENDER',
    'WARM VANILLA', 'COOL MINT', 'FRESH STRAWBERRY', 'WILD CHERRY',
    'PROSTATE MASSAGER WHITE', 'PROSTATE MASSAGER BLACK',
    'GP FREE', 'WATER LIQUID', 'WATER GEL', 'SILICONE GEL', 'GEL TUBE',
    'DOUBLE CLEAR', 'DOUBLE RUBBER', 'DOUBLE METAL',
    'FOIL PACKETS', 'FOIL PACK', 'TRAVEL SIZE', 'SAMPLE SIZE', 'SAMPLE PACK',
    '65 PILLOW PACKS',
    'FOIL 15 ML 24PC DISPLAY', 'FOIL 15ML 24PC DISPLAY', '15 ML 24PC DISPLAY', '15ML 24PC DISPLAY',
    '24PC DISPLAY', '24 PC DISPLAY', '24PCS DISPLAY', '24 PCS DISPLAY',
    '12PC DISPLAY', '12 PC DISPLAY', '48PC DISPLAY', '48 PC DISPLAY',
    'EXTRA LARGE', 'EXTRA SMALL', 'EXTRA LONG', 'SUPER LARGE',
    'OS QUEEN', 'ONE SIZE',
  ];

  for (const variant of multiWordVariants) {
    const regex = new RegExp(`\\s+${variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    baseName = baseName.replace(regex, '');
  }

  // Remove size words before common product suffixes
  const sizeWords = ['SMALL', 'MEDIUM', 'LARGE', 'SM', 'MED', 'LG', 'MINI', 'PETITE', 'JUMBO', 'GIANT'];
  const productSuffixes = [
    'ANAL PLUG', 'BUTT PLUG', 'PLUG', 'DILDO', 'DONG', 'VIBE', 'VIBRATOR',
    'CUP', 'SLEEVE', 'STROKER', 'RING', 'COCK RING', 'CUFF', 'CUFFS',
    'CHOKER', 'COLLAR', 'GARTER', 'PANTY', 'THONG', 'BRA',
    'BALL', 'BALLS', 'BEADS', 'CLAMP', 'CLAMPS', 'NIPPLE',
  ];
  for (const size of sizeWords) {
    for (const suffix of productSuffixes) {
      const regex = new RegExp(`\\s+${size}\\s+${suffix}`, 'gi');
      baseName = baseName.replace(regex, ` ${suffix}`);
    }
  }

  // Remove color words before common product suffixes
  const colorWordsForSuffix = ['RED', 'BLUE', 'GREEN', 'PINK', 'PURPLE', 'BLACK', 'WHITE', 'CLEAR',
    'SILVER', 'GOLD', 'BRONZE', 'COPPER', 'GREY', 'GRAY', 'BROWN',
    'YELLOW', 'TEAL', 'NAVY', 'NUDE', 'TAN', 'BEIGE', 'IVORY',
    'WINE', 'BURGUNDY', 'CHARCOAL', 'CORAL', 'FUCHSIA', 'INDIGO',
    'MAGENTA', 'MAROON', 'OLIVE', 'PLUM', 'SALMON', 'TURQUOISE', 'VIOLET',
    // Common abbreviations
    'BLK', 'WHT', 'PNK', 'PRP', 'BLU', 'GRN', 'GLD', 'SLV', 'BRN', 'YLW'];
  for (const color of colorWordsForSuffix) {
    for (const suffix of productSuffixes) {
      const regex = new RegExp(`\\s+${color}\\s+${suffix}`, 'gi');
      baseName = baseName.replace(regex, ` ${suffix}`);
    }
  }

  // Remove single-word variants at end (colors, flavors, sizes, etc.)
  const singleWordVariants = [
    'MANGO', 'CHERRY', 'STRAWBERRY', 'VANILLA', 'ALOE',
    'CHOCOLATE', 'MINT', 'GRAPE', 'LEMON', 'LIME', 'BANANA',
    'RASPBERRY', 'BLUEBERRY', 'PEACH', 'APPLE', 'WATERMELON', 'COCONUT',
    'LAVENDER', 'PEPPERMINT', 'SPEARMINT', 'EUCALYPTUS', 'JASMINE',
    'CINNAMON', 'GINGER', 'HONEY', 'CARAMEL', 'MOCHA', 'COFFEE',
    'MELON', 'BERRY', 'TROPICAL', 'CITRUS', 'FLORAL',
    'UNFLAVORED', 'UNSCENTED', 'COOLING', 'WARMING',
    'BILBO', 'FRODO', 'GANDALF', 'LURTZ', 'ELENDIL', 'ELROND', 'SMAUG', 'SAURON',
    'RED', 'BLUE', 'GREEN', 'PINK', 'PURPLE', 'BLACK', 'WHITE', 'CLEAR',
    'SILVER', 'GOLD', 'BRONZE', 'COPPER', 'GREY', 'GRAY', 'BROWN',
    'YELLOW', 'TEAL', 'NAVY', 'NUDE', 'TAN', 'BEIGE', 'IVORY', 'ORANGE',
    'WINE', 'BURGUNDY', 'CHARCOAL', 'CORAL', 'FUCHSIA', 'INDIGO',
    'MAGENTA', 'MAROON', 'OLIVE', 'PLUM', 'SALMON', 'TURQUOISE', 'VIOLET',
    'NEON', 'MIDNIGHT', 'PEARL', 'MATTE', 'ROSE',
    // Color abbreviations
    'BLK', 'WHT', 'PNK', 'PRP', 'BLU', 'GRN', 'GLD', 'SLV', 'BRN', 'YLW',
    'SMALL', 'MEDIUM', 'LARGE', 'XLARGE', 'XXLARGE', 'XXXLARGE', 'XSMALL',
    'XL', 'XXL', 'XXXL', 'XS', 'SM', 'MED', 'LG',
    'MINI', 'PETITE', 'REGULAR', 'JUMBO', 'GIANT', 'KING', 'QUEEN', 'EXTRA',
    'TUBE', 'BOTTLE', 'PUMP', 'SACHET', 'SAMPLE', 'JAR', 'BOWL', 'BOX', 'BAG', 'QUICKIE',
    'JR', 'JUNIOR', 'SENIOR',
    'RUBBER', 'METAL', 'GLASS', 'PLASTIC', 'LEATHER', 'LATEX', 'VINYL',
    'THIN', 'THICK',
  ];

  // Apply multiple times to strip multiple suffixes
  for (let pass = 0; pass < 4; pass++) {
    for (const variant of singleWordVariants) {
      const regex = new RegExp(`\\s+${variant}\\s*$`, 'i');
      baseName = baseName.replace(regex, '');
    }
  }

  // Clean up multiple spaces, trim, and remove trailing punctuation
  baseName = baseName.replace(/\s+/g, ' ').trim();
  baseName = baseName.replace(/[\s\.\-,\/]+$/, '').trim();

  return baseName;
}

/**
 * Extract variation values from a product name
 */
function extractVariationValue(name: string): {
  size: string | null;
  color: string | null;
  flavor: string | null;
  style: string | null;
} {
  const result = { size: null as string | null, color: null as string | null, flavor: null as string | null, style: null as string | null };
  const lowerName = name.toLowerCase();

  // Size patterns - volume
  const volumeMatch = name.match(/(\d+(?:\.\d+)?)\s*\.?\s*(fl\.?\s*)?(oz|ounces?|ml|milliliters?|l|liters?|g|grams?|mg|lb|lbs|pounds?|o)\b/i);
  if (volumeMatch) {
    result.size = volumeMatch[0].toLowerCase().replace(/\s+/g, '');
    if (result.size.match(/^\d+o$/)) {
      result.size = result.size.replace(/o$/, ' oz');
    }
  }

  // Size patterns - length/dimension
  if (!result.size) {
    const lengthMatch = name.match(/(\d+(?:\.\d+)?)\s*(inches?|in|"|″|mm|millimeters?|cm|centimeters?|ft|feet|foot)\b/i);
    if (lengthMatch) {
      result.size = lengthMatch[0].toLowerCase().replace(/\s+/g, '');
    }
  }

  // Size patterns - clothing combo sizes
  if (!result.size) {
    const comboSizeMatch = name.match(/\b(s\/m|m\/l|l\/xl|xl\/xxl|o\/s|one\s*size|queen|q\/s|os\s*queen|1x\/2x|3x\/4x)\b/i);
    if (comboSizeMatch) {
      result.size = comboSizeMatch[1].toUpperCase().replace(/\s+/g, '');
    }
  }

  // Size patterns - pack counts
  if (!result.size) {
    const packCountMatch = name.match(/\b(\d+)\s*(pk|pack|pc|pcs|ct|count)\s*(bowl|box|bag|display|jar)?\b/i);
    if (packCountMatch) {
      const count = packCountMatch[1];
      const container = packCountMatch[3] ? ` ${packCountMatch[3].toLowerCase()}` : 'pk';
      result.size = `${count}${container === 'pk' ? 'pk' : container}`;
    }
  }

  // Size patterns - clothing/general sizes
  if (!result.size) {
    const sizeWordMatch = name.match(/\b(xs|x-?small|small|sm|s|medium|med|m|large|lg|l|x-?large|xl|xxl|xx-?large|xxxl|xxx-?large|2xl|3xl|4xl|1x|2x|3x|4x|1xl|2xl|3xl|mini|petite|regular|plus|jumbo|giant|king)\b/i);
    if (sizeWordMatch) {
      result.size = normalizeSize(sizeWordMatch[1]);
    }
  }

  // Color patterns - multi-word colors FIRST (order matters)
  const multiWordColors = [
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
  for (const color of multiWordColors) {
    if (lowerName.includes(color)) {
      result.color = color;
      break;
    }
  }

  // Single-word colors (only if no multi-word color found)
  if (!result.color) {
    const colorWords = [
      'red', 'blue', 'green', 'pink', 'purple', 'black', 'white', 'clear',
      'silver', 'gold', 'bronze', 'copper', 'grey', 'gray', 'brown',
      'yellow', 'orange', 'teal', 'navy', 'nude', 'tan', 'beige', 'ivory',
      'midnight', 'pearl', 'matte', 'rose', 'wine', 'burgundy', 'charcoal',
      'coral', 'fuchsia', 'indigo', 'lavender', 'magenta', 'maroon',
      'olive', 'plum', 'salmon', 'turquoise', 'violet',
      // Common abbreviations
      'blk', 'wht', 'pnk', 'prp', 'blu', 'grn', 'gld', 'slv', 'brn', 'ylw',
    ];
    for (const color of colorWords) {
      if (lowerName.includes(color)) {
        const colorRegex = new RegExp(`\\b${color}\\b`, 'i');
        if (colorRegex.test(name)) {
          result.color = color;
          break;
        }
      }
    }
  }

  // Flavor patterns - multi-word first
  const multiWordFlavors = [
    'pina colada', 'passion fruit', 'key lime', 'butter rum', 'creme brulee',
    'mango passion', 'cherry lemonade', 'orange cream', 'banana cream',
    'tahitian vanilla', 'natural aloe', 'french lavender', 'strawberry banana',
    'blue raspberry', 'green apple', 'cotton candy', 'bubble gum', 'root beer',
    'cherry vanilla', 'chocolate mint', 'warm vanilla', 'cool mint',
    'fresh strawberry', 'wild cherry'
  ];
  for (const flavor of multiWordFlavors) {
    if (lowerName.includes(flavor)) {
      result.flavor = flavor;
      break;
    }
  }

  // Single-word flavors
  if (!result.flavor) {
    const singleWordFlavors = [
      'mango', 'cherry', 'strawberry', 'vanilla',
      'chocolate', 'mint', 'grape', 'lemon', 'lime', 'banana',
      'raspberry', 'blueberry', 'peach', 'apple', 'watermelon', 'coconut',
      'lavender', 'peppermint', 'spearmint', 'eucalyptus', 'jasmine',
      'cinnamon', 'ginger', 'honey', 'caramel', 'mocha', 'coffee',
      'melon', 'berry', 'tropical', 'citrus', 'floral', 'fresh',
    ];
    for (const flavor of singleWordFlavors) {
      if (lowerName.includes(flavor)) {
        result.flavor = flavor;
        break;
      }
    }
  }

  // Style patterns
  const styleWords = [
    'cooling', 'warming', 'tingling', 'sensitizing', 'desensitizing',
    'ice', 'fire', 'heat', 'cool', 'warm', 'hot', 'cold',
    'water', 'hybrid', 'oil', 'organic',
    'gel', 'liquid', 'cream', 'lotion', 'spray', 'foam',
    'quickie', 'jar', 'tube', 'bottle', 'pump'
  ];

  const multiStyleMatch = name.match(/\b(foil\s*packets?|travel\s*size|sample\s*pack)\b/i);
  if (multiStyleMatch) {
    result.style = multiStyleMatch[1].toLowerCase().replace(/\s+/g, ' ');
  }

  if (!result.style) {
    for (const style of styleWords) {
      if (lowerName.includes(style)) {
        const styleRegex = new RegExp(`\\b${style}\\b`, 'i');
        if (styleRegex.test(name)) {
          result.style = style;
          break;
        }
      }
    }
  }

  return result;
}

/**
 * Determine what attribute varies between products in a group
 */
function determineVariationAttribute(products: SimpleProduct[]): 'color' | 'flavor' | 'size' | 'style' | null {
  const extractedValues = products.map(p => extractVariationValue(p.title));

  // Check if _wt_color values differ
  const colors = new Set(products.map(p => (p.color || '').toLowerCase()).filter(c => c));
  if (colors.size > 1) return 'color';

  // Check for color variations in names
  const extractedColors = extractedValues.map(v => v.color).filter(c => c);
  if (new Set(extractedColors).size > 1) return 'color';

  // Check for size variations
  const extractedSizes = extractedValues.map(v => v.size).filter(s => s);
  if (new Set(extractedSizes).size > 1) return 'size';

  // Check for style variations
  const extractedStyles = extractedValues.map(v => v.style).filter(s => s);
  if (new Set(extractedStyles).size > 1) return 'style';

  // Check for flavor variations
  const extractedFlavors = extractedValues.map(v => v.flavor).filter(f => f);
  if (new Set(extractedFlavors).size > 1) return 'flavor';

  // Default to style for groups where we can't detect the specific attribute
  return 'style';
}

// ==================== NORMALIZATION FUNCTIONS ====================

function normalizeSize(size: string): string {
  const lower = size.toLowerCase().replace(/-/g, '');
  const sizeMap: Record<string, string> = {
    'xs': 'X-Small', 'xsmall': 'X-Small',
    's': 'Small', 'sm': 'Small', 'small': 'Small',
    'm': 'Medium', 'med': 'Medium', 'medium': 'Medium',
    'l': 'Large', 'lg': 'Large', 'large': 'Large',
    'xl': 'X-Large', 'xlarge': 'X-Large',
    'xxl': 'XX-Large', 'xxlarge': 'XX-Large',
    'xxxl': 'XXX-Large', 'xxxlarge': 'XXX-Large',
    '2xl': 'XX-Large', '3xl': 'XXX-Large', '4xl': 'XXXX-Large',
    // Plus sizes
    '1x': '1X', '2x': '2X', '3x': '3X', '4x': '4X',
    '1xl': '1XL', '1x/2x': '1X/2X', '3x/4x': '3X/4X',
    // Combo sizes
    's/m': 'S/M', 'm/l': 'M/L', 'l/xl': 'L/XL', 'xl/xxl': 'XL/XXL',
    'o/s': 'One Size', 'onesize': 'One Size',
    'queen': 'Queen', 'q/s': 'Queen', 'osqueen': 'Queen',
    'mini': 'Mini', 'petite': 'Petite', 'regular': 'Regular',
    'plus': 'Plus', 'jumbo': 'Jumbo', 'giant': 'Giant', 'king': 'King',
  };
  return sizeMap[lower] || size;
}

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
    // Multi-word colors
    'neon green': 'Neon Green', 'neon pink': 'Neon Pink', 'neon blue': 'Neon Blue',
    'neon yellow': 'Neon Yellow', 'neon orange': 'Neon Orange', 'neon lime': 'Neon Lime',
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
  const lower = color.toLowerCase().trim();
  return colorMap[lower] || applyTitleCase(color);
}

function normalizeFlavor(flavor: string): string {
  const flavorMap: Record<string, string> = {
    'strawberry': 'Strawberry', 'chocolate': 'Chocolate', 'vanilla': 'Vanilla',
    'cherry': 'Cherry', 'mango': 'Mango', 'peppermint': 'Peppermint',
    'spearmint': 'Spearmint', 'lavender': 'Lavender', 'coconut': 'Coconut',
    'lemon': 'Lemon', 'lime': 'Lime', 'banana': 'Banana', 'grape': 'Grape',
    'raspberry': 'Raspberry', 'blueberry': 'Blueberry', 'peach': 'Peach',
    'apple': 'Apple', 'watermelon': 'Watermelon', 'mint': 'Mint',
    'cinnamon': 'Cinnamon', 'ginger': 'Ginger', 'honey': 'Honey',
    'caramel': 'Caramel', 'mocha': 'Mocha', 'coffee': 'Coffee',
    'pina colada': 'Pina Colada', 'passion fruit': 'Passion Fruit',
    'key lime': 'Key Lime', 'blue raspberry': 'Blue Raspberry',
    'green apple': 'Green Apple', 'cotton candy': 'Cotton Candy',
  };
  const lower = flavor.toLowerCase().trim();
  return flavorMap[lower] || applyTitleCase(flavor);
}

function normalizeStyle(style: string): string {
  const styleMap: Record<string, string> = {
    'warming': 'Warming', 'cooling': 'Cooling', 'tingling': 'Tingling',
    'water': 'Water-Based', 'silicone': 'Silicone-Based', 'hybrid': 'Hybrid',
    'oil': 'Oil-Based', 'organic': 'Organic', 'gel': 'Gel', 'liquid': 'Liquid',
    'cream': 'Cream', 'lotion': 'Lotion', 'spray': 'Spray', 'foam': 'Foam',
    'ice': 'Ice', 'fire': 'Fire', 'heat': 'Heat', 'cool': 'Cool',
    'warm': 'Warm', 'hot': 'Hot', 'cold': 'Cold',
  };
  const lower = style.toLowerCase().trim();
  return styleMap[lower] || applyTitleCase(style);
}

function applyTitleCase(text: string): string {
  const lowercaseWords = new Set([
    'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from',
    'in', 'into', 'near', 'nor', 'of', 'on', 'onto', 'or',
    'the', 'to', 'with'
  ]);

  return text
    .toLowerCase()
    .split(' ')
    .map((word, index) => {
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      if (lowercaseWords.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ')
    .trim();
}

/**
 * Get variation option value for a product based on detected attribute type
 */
function getVariationOption(product: SimpleProduct, variationType: 'color' | 'flavor' | 'size' | 'style' | null): string {
  if (!variationType) {
    return cleanVariationName(product.title);
  }

  const extracted = extractVariationValue(product.title);

  switch (variationType) {
    case 'color':
      if (product.color && product.color.trim()) return normalizeColor(product.color.trim());
      if (extracted.color) return normalizeColor(extracted.color);
      break;
    case 'flavor':
      if (extracted.flavor) return normalizeFlavor(extracted.flavor);
      if (extracted.style) return normalizeStyle(extracted.style);
      break;
    case 'style':
      if (extracted.style) return normalizeStyle(extracted.style);
      break;
    case 'size':
      if (extracted.size) return normalizeSizeValue(extracted.size);
      break;
  }

  // Fallback: extract the differing part from the product name
  const baseName = extractBaseName(product.title);
  if (product.title.length > baseName.length) {
    let suffix = product.title.substring(baseName.length).trim();
    suffix = cleanVariationName(suffix);
    if (suffix && suffix.length > 0) {
      return applyTitleCase(suffix);
    }
  }

  return cleanVariationName(product.title);
}

function cleanVariationName(name: string): string {
  return name
    .replace(/\s*\(net\)\s*/gi, '')
    .replace(/^[\s\-\.]+|[\s\-\.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim() || name;
}

function normalizeSizeValue(size: string): string {
  if (/^[A-Z]/.test(size)) return size;

  let normalized = size.toLowerCase().trim();
  normalized = normalized.replace(/(\d)\.([a-z])/i, '$1$2');

  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(.*)/);
  if (!match) return size;

  const number = match[1];
  let unit = match[2].trim().replace(/^\./, '');

  const unitMap: Record<string, string> = {
    'oz': 'oz', 'ounce': 'oz', 'ounces': 'oz',
    'ml': 'ml', 'milliliter': 'ml', 'milliliters': 'ml',
    'g': 'g', 'gram': 'g', 'grams': 'g', 'mg': 'mg',
    'in': 'in', 'inch': 'in', 'inches': 'in',
    'mm': 'mm', 'cm': 'cm',
    'pk': 'pk', 'pack': 'pk', 'pc': 'pc', 'pcs': 'pc',
    'ct': 'ct', 'count': 'ct',
  };

  const normalizedUnit = unitMap[unit] || unit;
  return `${number} ${normalizedUnit}`;
}

// ==================== DATABASE QUERIES ====================

async function fetchAllSimpleProducts(connection: mysql.Connection, options: ScriptOptions): Promise<SimpleProduct[]> {
  let brandFilter = '';
  const params: any[] = [];

  if (options.brand) {
    brandFilter = `AND (
      EXISTS (SELECT 1 FROM wp_postmeta mfg WHERE mfg.post_id = p.ID AND mfg.meta_key = '_wt_manufacturer_code' AND mfg.meta_value = ?)
      OR EXISTS (SELECT 1 FROM wp_term_relationships tr_b JOIN wp_term_taxonomy tt_b ON tr_b.term_taxonomy_id = tt_b.term_taxonomy_id AND tt_b.taxonomy = 'product_brand' JOIN wp_terms t_b ON tt_b.term_id = t_b.term_id AND t_b.slug = ? WHERE tr_b.object_id = p.ID)
    )`;
    params.push(options.brand, options.brand.toLowerCase());
  }

  const query = `
    SELECT
      p.ID as id,
      p.post_title as title,
      p.post_name as slug,
      p.post_status as status,
      p.post_content as description,
      p.post_excerpt as shortDescription,
      MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) as sku,
      MAX(CASE WHEN pm.meta_key = '_wt_barcode' THEN pm.meta_value END) as barcode,
      MAX(CASE WHEN pm.meta_key = '_regular_price' THEN pm.meta_value END) as regularPrice,
      MAX(CASE WHEN pm.meta_key = '_sale_price' THEN pm.meta_value END) as salePrice,
      MAX(CASE WHEN pm.meta_key = '_price' THEN pm.meta_value END) as price,
      MAX(CASE WHEN pm.meta_key = '_stock' THEN pm.meta_value END) as stockQty,
      MAX(CASE WHEN pm.meta_key = '_stock_status' THEN pm.meta_value END) as stockStatus,
      MAX(CASE WHEN pm.meta_key = '_wt_color' THEN pm.meta_value END) as color,
      MAX(CASE WHEN pm.meta_key = '_wt_material' THEN pm.meta_value END) as material,
      MAX(CASE WHEN pm.meta_key = '_wt_manufacturer_code' THEN pm.meta_value END) as manufacturerCode,
      MAX(CASE WHEN pm.meta_key = '_thumbnail_id' THEN pm.meta_value END) as thumbnailId,
      MAX(CASE WHEN pm.meta_key = '_product_image_gallery' THEN pm.meta_value END) as galleryIds,
      (SELECT t.name FROM wp_term_relationships tr2
       JOIN wp_term_taxonomy tt2 ON tr2.term_taxonomy_id = tt2.term_taxonomy_id AND tt2.taxonomy = 'product_brand'
       JOIN wp_terms t ON tt2.term_id = t.term_id
       WHERE tr2.object_id = p.ID LIMIT 1) as brandName
    FROM wp_posts p
    LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
      AND pm.meta_key IN (
        '_sku', '_wt_barcode', '_regular_price', '_sale_price', '_price',
        '_stock', '_stock_status', '_wt_color', '_wt_material',
        '_wt_manufacturer_code', '_thumbnail_id', '_product_image_gallery'
      )
    INNER JOIN wp_term_relationships tr_type ON p.ID = tr_type.object_id
    INNER JOIN wp_term_taxonomy tt_type ON tr_type.term_taxonomy_id = tt_type.term_taxonomy_id
      AND tt_type.taxonomy = 'product_type'
    INNER JOIN wp_terms t_type ON tt_type.term_id = t_type.term_id
      AND t_type.slug = 'simple'
    WHERE p.post_type = 'product'
      AND p.post_status IN ('publish', 'draft')
      ${brandFilter}
    GROUP BY p.ID, p.post_title, p.post_name, p.post_status, p.post_content, p.post_excerpt
    ORDER BY p.post_title
  `;

  const [rows] = await connection.execute(query, params);
  const products = (rows as any[]).map(row => ({
    id: row.id,
    title: row.title || '',
    slug: row.slug || '',
    status: row.status || 'publish',
    description: row.description || '',
    shortDescription: row.shortDescription || '',
    sku: row.sku || '',
    barcode: row.barcode || '',
    regularPrice: row.regularPrice || '0',
    salePrice: row.salePrice || '0',
    price: row.price || '0',
    stockQty: parseInt(row.stockQty) || 0,
    stockStatus: row.stockStatus || 'outofstock',
    color: row.color || '',
    material: row.material || '',
    manufacturerCode: row.manufacturerCode || '',
    brandName: row.brandName || 'Unknown',
    thumbnailId: row.thumbnailId ? parseInt(row.thumbnailId) : null,
    galleryIds: row.galleryIds || '',
  }));

  // Filter out excluded IDs and deduplicate by ID
  const seen = new Set<number>();
  return products.filter(p => {
    if (options.excludeIds.has(p.id)) return false;
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// ==================== GROUPING ALGORITHM ====================

function groupProducts(products: SimpleProduct[], options: ScriptOptions): DetectedGroup[] {
  // Pass 1: Group by brand + baseName + price
  console.log('  Pass 1: Grouping by brand + baseName + price...');
  const groups = new Map<string, SimpleProduct[]>();

  for (const product of products) {
    const baseName = extractBaseName(product.title);
    if (!baseName || baseName.length < 3) continue;

    const priceKey = parseFloat(product.price).toFixed(2);
    const brandKey = product.manufacturerCode || product.brandName || 'UNKNOWN';
    const key = `${brandKey}|${baseName.toUpperCase()}|${priceKey}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(product);
  }

  // Pass 2: Merge groups with same brand+baseName but different prices (size variations)
  console.log('  Pass 2: Merging related groups...');
  const mergedGroups = mergeRelatedGroups(Array.from(groups.entries()), options.priceTolerance);

  // Pass 3: For single-product groups, try type/style grouping
  const multiGroups: { key: string; products: SimpleProduct[] }[] = [];
  const singleGroups: { key: string; products: SimpleProduct[] }[] = [];

  for (const [key, prods] of mergedGroups) {
    if (prods.length > 1) {
      multiGroups.push({ key, products: prods });
    } else {
      singleGroups.push({ key, products: prods });
    }
  }

  console.log(`  Pass 1-2 result: ${multiGroups.length} multi-product groups, ${singleGroups.length} singletons`);

  // Type/style grouping for singletons
  console.log('  Pass 3: Type/style grouping for singletons...');
  const typeStyleGroups = groupByTypeStyle(singleGroups);
  multiGroups.push(...typeStyleGroups);
  console.log(`    Found ${typeStyleGroups.length} style groups`);

  // Collect remaining singletons not used in type/style grouping
  const usedIds = new Set(typeStyleGroups.flatMap(g => g.products.map(p => p.id)));
  const remainingSingles = singleGroups.filter(g => !usedIds.has(g.products[0]?.id));

  // Pass 4: Model name grouping (last-word pattern)
  console.log('  Pass 4: Model name grouping...');
  const modelGroups = groupByModelName(remainingSingles);
  multiGroups.push(...modelGroups);
  console.log(`    Found ${modelGroups.length} model groups`);

  // Collect remaining after model name grouping
  const usedByModel = new Set(modelGroups.flatMap(g => g.products.map(p => p.id)));
  const remainingAfterModel = remainingSingles.filter(g => !usedByModel.has(g.products[0]?.id));

  // Pass 5: Size variation merge across prices
  console.log('  Pass 5: Size variation merge across prices...');
  const sizeGroups = groupBySizeAcrossPrices(remainingAfterModel);
  multiGroups.push(...sizeGroups);
  console.log(`    Found ${sizeGroups.length} size groups`);

  // Convert to DetectedGroup format and filter by group size
  let groupId = 0;
  const detectedGroups: DetectedGroup[] = [];

  for (const group of multiGroups) {
    if (group.products.length < options.minGroupSize) continue;
    if (group.products.length > options.maxGroupSize) continue;

    // Ensure all products in group are from the same brand
    const brands = new Set(group.products.map(p => p.manufacturerCode || p.brandName));
    if (brands.size > 1) continue;

    groupId++;
    const baseName = extractBaseName(group.products[0].title);
    const variationAttribute = determineVariationAttribute(group.products);
    const suggestedParent = selectParentProduct(group.products);
    const confidence = calculateConfidence(group.products, baseName);

    detectedGroups.push({
      groupId,
      baseName: applyTitleCase(baseName),
      brandCode: group.products[0].manufacturerCode,
      brandName: group.products[0].brandName,
      products: group.products,
      variationAttribute,
      suggestedParentId: suggestedParent.id,
      confidence,
    });
  }

  // Sort by confidence (high first), then by group size (larger first)
  detectedGroups.sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 };
    if (confOrder[a.confidence] !== confOrder[b.confidence]) {
      return confOrder[a.confidence] - confOrder[b.confidence];
    }
    return b.products.length - a.products.length;
  });

  // Re-number after sorting
  detectedGroups.forEach((g, i) => g.groupId = i + 1);

  // Apply confidence filter
  let filtered = detectedGroups;
  if (options.minConfidence) {
    const confLevels = { high: 3, medium: 2, low: 1 };
    const minLevel = confLevels[options.minConfidence];
    filtered = filtered.filter(g => confLevels[g.confidence] >= minLevel);
    filtered.forEach((g, i) => g.groupId = i + 1);
  }

  // Apply limit if set
  if (options.limit) {
    return filtered.slice(0, options.limit);
  }

  return filtered;
}

function mergeRelatedGroups(entries: [string, SimpleProduct[]][], priceTolerance: number): Map<string, SimpleProduct[]> {
  const result = new Map<string, SimpleProduct[]>();

  // Group entries by brand+baseName (without price)
  const byBrandBase = new Map<string, { key: string; products: SimpleProduct[]; price: number }[]>();

  for (const [key, products] of entries) {
    const parts = key.split('|');
    const brandBase = `${parts[0]}|${parts[1]}`;
    const price = parseFloat(parts[2]) || 0;

    if (!byBrandBase.has(brandBase)) {
      byBrandBase.set(brandBase, []);
    }
    byBrandBase.get(brandBase)!.push({ key, products, price });
  }

  for (const [brandBase, priceGroups] of byBrandBase) {
    if (priceGroups.length <= 1 || priceTolerance === 0) {
      // No merging needed - different prices and no tolerance
      for (const pg of priceGroups) {
        result.set(pg.key, pg.products);
      }
      continue;
    }

    // Check if prices are within tolerance
    const prices = priceGroups.map(pg => pg.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    if (minPrice > 0 && ((maxPrice - minPrice) / minPrice * 100) <= priceTolerance) {
      // Merge all price groups
      const merged = priceGroups.flatMap(pg => pg.products);
      result.set(priceGroups[0].key, merged);
    } else {
      // Keep separate
      for (const pg of priceGroups) {
        result.set(pg.key, pg.products);
      }
    }
  }

  return result;
}

function groupByTypeStyle(singleGroups: { key: string; products: SimpleProduct[] }[]): { key: string; products: SimpleProduct[] }[] {
  const result: { key: string; products: SimpleProduct[] }[] = [];

  const typeStyleWords = [
    'COOL', 'HOT', 'WARM', 'COLD', 'ICE', 'FIRE', 'HEAT',
    'ORIGINAL', 'CLASSIC', 'LIGHT', 'LITE', 'REGULAR',
    'WARMING', 'COOLING', 'TINGLING',
    'NATURAL', 'ORGANIC', 'PURE',
    'WATER', 'SILICONE', 'HYBRID', 'OIL',
    'GEL', 'LIQUID', 'CREAM', 'LOTION',
  ];

  // Map-based O(n) approach: group by brand + coreBaseName
  const coreNameMap = new Map<string, { products: SimpleProduct[]; indices: number[] }>();

  for (let i = 0; i < singleGroups.length; i++) {
    const product = singleGroups[i].products[0];
    if (!product) continue;

    const baseName = extractBaseName(product.title).toUpperCase();
    const typeWord = typeStyleWords.find(tw =>
      baseName.includes(` ${tw}`) || baseName.endsWith(` ${tw}`)
    );
    if (!typeWord) continue;

    const coreBaseName = baseName.replace(new RegExp(`\\s+${typeWord}\\b`, 'gi'), '').trim();
    if (!coreBaseName || coreBaseName === baseName) continue;

    const brandKey = product.manufacturerCode || product.brandName;
    const mapKey = `${brandKey}|${coreBaseName}`;

    if (!coreNameMap.has(mapKey)) {
      coreNameMap.set(mapKey, { products: [], indices: [] });
    }
    coreNameMap.get(mapKey)!.products.push(product);
    coreNameMap.get(mapKey)!.indices.push(i);
  }

  for (const [mapKey, group] of coreNameMap) {
    if (group.products.length >= 2) {
      const coreBaseName = mapKey.split('|').slice(1).join('|');
      result.push({ key: `STYLE|${coreBaseName}`, products: group.products });
    }
  }

  return result;
}

function groupByModelName(singleGroups: { key: string; products: SimpleProduct[] }[]): { key: string; products: SimpleProduct[] }[] {
  const result: { key: string; products: SimpleProduct[] }[] = [];
  const usedIds = new Set<number>();

  // Strategy 1: Remove last word as variant, grouped by brand + price + base pattern
  const lastWordMap = new Map<string, { products: SimpleProduct[]; productIds: number[] }>();

  for (const sg of singleGroups) {
    const product = sg.products[0];
    if (!product) continue;

    const name = product.title.toUpperCase().trim()
      .replace(/\s*\(NET\)\s*$/i, '')
      .replace(/\s*["″"]\s*$/g, '')
      .trim();
    const words = name.split(/\s+/);
    if (words.length < 2) continue;

    const basePattern = words.slice(0, -1).join(' ');
    const priceKey = parseFloat(product.price).toFixed(2);
    const brandKey = product.manufacturerCode || product.brandName;
    const mapKey = `${brandKey}|${priceKey}|${basePattern}`;

    if (!lastWordMap.has(mapKey)) {
      lastWordMap.set(mapKey, { products: [], productIds: [] });
    }
    lastWordMap.get(mapKey)!.products.push(product);
    lastWordMap.get(mapKey)!.productIds.push(product.id);
  }

  for (const [mapKey, group] of lastWordMap) {
    if (group.products.length < 2) continue;
    if (group.productIds.some(id => usedIds.has(id))) continue;

    group.productIds.forEach(id => usedIds.add(id));
    const basePattern = mapKey.split('|').slice(2).join('|');
    result.push({ key: `MODEL|${basePattern}`, products: group.products });
  }

  // Strategy 2: Keyword pattern (remove variant words)
  const variantWords = new Set([
    'MINT', 'CHERRY', 'STRAWBERRY', 'VANILLA', 'CHOCOLATE', 'MANGO', 'GRAPE',
    'LEMON', 'LIME', 'BANANA', 'RASPBERRY', 'BLUEBERRY', 'PEACH', 'APPLE',
    'WATERMELON', 'COCONUT', 'LAVENDER', 'PEPPERMINT', 'SPEARMINT', 'CINNAMON',
    'HONEY', 'GINGER', 'CARAMEL', 'MOCHA', 'COFFEE', 'MELON', 'BERRY',
    'BX', 'RED', 'BLUE', 'GREEN', 'PINK', 'PURPLE', 'BLACK', 'WHITE', 'CLEAR',
    'SILVER', 'GOLD', 'ORANGE', 'YELLOW', 'TEAL', 'NAVY', 'NUDE', 'TAN',
    'BEIGE', 'IVORY', 'CREAM', 'BROWN', 'GRAY', 'GREY', 'BRONZE', 'COPPER',
    'LIGHT', 'DARK', 'MIDNIGHT', 'PEARL', 'MATTE', 'NATURAL',
    'SMALL', 'MEDIUM', 'LARGE', 'MINI', 'EXTRA', 'XL', 'XXL', 'XXXL',
    'SM', 'MED', 'LG', 'XS', '2XL', '3XL', '4XL',
    'UNFLAVORED', 'UNSCENTED', 'ORIGINAL',
    'COOLING', 'WARMING', 'COOL', 'WARM', 'HOT', 'COLD', 'ICE', 'FIRE',
  ]);

  const keywordMap = new Map<string, { products: SimpleProduct[]; productIds: number[] }>();

  for (const sg of singleGroups) {
    const product = sg.products[0];
    if (!product || usedIds.has(product.id)) continue;

    const name = product.title.toUpperCase().trim();
    const words = name.split(/\s+/);
    const keyWords = words.filter(w => !variantWords.has(w));
    if (keyWords.length < 2) continue;

    const priceKey = parseFloat(product.price).toFixed(2);
    const brandKey = product.manufacturerCode || product.brandName;
    const mapKey = `${brandKey}|${priceKey}|${keyWords.join('|')}`;

    if (!keywordMap.has(mapKey)) {
      keywordMap.set(mapKey, { products: [], productIds: [] });
    }
    keywordMap.get(mapKey)!.products.push(product);
    keywordMap.get(mapKey)!.productIds.push(product.id);
  }

  for (const [mapKey, group] of keywordMap) {
    if (group.products.length < 2) continue;
    if (group.productIds.some(id => usedIds.has(id))) continue;

    group.productIds.forEach(id => usedIds.add(id));
    const keyPart = mapKey.split('|').slice(2).join('|');
    result.push({ key: `KEYWORD|${keyPart}`, products: group.products });
  }

  return result;
}

function groupBySizeAcrossPrices(singleGroups: { key: string; products: SimpleProduct[] }[]): { key: string; products: SimpleProduct[] }[] {
  const result: { key: string; products: SimpleProduct[] }[] = [];
  const used = new Set<number>();

  const sizeIndicators = [
    'SMALL', 'MEDIUM', 'LARGE', 'MINI', 'EXTRA', 'XL', 'XXL', 'XXXL',
    'PETITE', 'REGULAR', 'JUMBO', 'GIANT', 'KING', 'QUEEN',
    'SM', 'MED', 'LG', 'XS', '2XL', '3XL', '4XL',
  ];

  // Group by brand + base name (with size words removed)
  const byBaseNameNoSize = new Map<string, number[]>();

  for (let i = 0; i < singleGroups.length; i++) {
    if (used.has(i)) continue;
    const product = singleGroups[i].products[0];
    if (!product) continue;

    const name = product.title.toUpperCase().trim();
    const words = name.split(/\s+/);

    const hasSizeIndicator = words.some(w => sizeIndicators.includes(w));
    if (!hasSizeIndicator) continue;

    const baseWords = words.filter(w => !sizeIndicators.includes(w));
    const baseName = baseWords.join(' ');
    const brandKey = product.manufacturerCode || product.brandName;
    const key = `${brandKey}|${baseName}`;

    if (!byBaseNameNoSize.has(key)) {
      byBaseNameNoSize.set(key, []);
    }
    byBaseNameNoSize.get(key)!.push(i);
  }

  for (const [, indices] of byBaseNameNoSize) {
    if (indices.length < 2) continue;
    if (indices.some(i => used.has(i))) continue;

    // Verify these products have DIFFERENT sizes
    const sizes = indices.map(i => {
      const name = singleGroups[i].products[0]?.title.toUpperCase() || '';
      const words = name.split(/\s+/);
      return words.filter(w => sizeIndicators.includes(w)).join(' ');
    });

    const uniqueSizes = new Set(sizes);
    if (uniqueSizes.size < 2) continue;

    indices.forEach(i => used.add(i));

    const products = indices.map(i => singleGroups[i].products[0]);
    result.push({ key: `SIZE|${products[0].title}`, products });
  }

  return result;
}

// ==================== SCORING & SELECTION ====================

function selectParentProduct(products: SimpleProduct[]): SimpleProduct {
  let bestScore = -1;
  let bestProduct = products[0];

  for (const product of products) {
    let score = 0;
    if (product.thumbnailId) score += 3;
    if (product.galleryIds) score += 2;
    if (product.description && product.description.length > 50) score += 2;
    if (product.stockQty > 0) score += 1;
    if (product.description) score += Math.min(product.description.length / 500, 1);
    if (product.status === 'publish') score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestProduct = product;
    }
  }

  return bestProduct;
}

function calculateConfidence(products: SimpleProduct[], baseName: string): 'high' | 'medium' | 'low' {
  // All same price = higher confidence
  const prices = new Set(products.map(p => parseFloat(p.price).toFixed(2)));
  const allSamePrice = prices.size === 1;

  // All same brand = higher confidence
  const brands = new Set(products.map(p => p.manufacturerCode || p.brandName));
  const allSameBrand = brands.size === 1;

  // Base name is substantial
  const substantialName = baseName.length >= 8;

  // Group size is reasonable
  const reasonableSize = products.length >= 2 && products.length <= 6;

  if (allSamePrice && allSameBrand && substantialName && reasonableSize) {
    return 'high';
  }
  if (allSameBrand && substantialName) {
    return 'medium';
  }
  return 'low';
}

// ==================== PHP SERIALIZATION ====================

function serializeAttributes(attrName: string, taxonomy: string): string {
  const inner = `s:${taxonomy.length}:"${taxonomy}";a:6:{s:4:"name";s:${taxonomy.length}:"${taxonomy}";s:5:"value";s:0:"";s:8:"position";i:0;s:10:"is_visible";i:1;s:12:"is_variation";i:1;s:11:"is_taxonomy";i:1;}`;
  return `a:1:{${inner}}`;
}

function serializeDefaultAttributes(taxonomy: string, termSlug: string): string {
  return `a:1:{s:${taxonomy.length}:"${taxonomy}";s:${termSlug.length}:"${termSlug}";}`;
}

// ==================== CONVERSION LOGIC ====================

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

async function convertGroup(connection: mysql.Connection, group: DetectedGroup): Promise<ConversionResult> {
  const resultBase = {
    groupId: group.groupId,
    baseName: group.baseName,
    parentId: group.suggestedParentId,
    variationIds: group.products.filter(p => p.id !== group.suggestedParentId).map(p => p.id),
    success: false,
  };

  await connection.beginTransaction();

  try {
    // Step 1: Validate all products still exist as simple products
    const productIds = group.products.map(p => p.id);
    const placeholders = productIds.map(() => '?').join(',');

    const [existCheck] = await connection.execute(
      `SELECT p.ID, t_type.slug as product_type
       FROM wp_posts p
       INNER JOIN wp_term_relationships tr ON p.ID = tr.object_id
       INNER JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id AND tt.taxonomy = 'product_type'
       INNER JOIN wp_terms t_type ON tt.term_id = t_type.term_id
       WHERE p.ID IN (${placeholders}) AND p.post_type = 'product'`,
      productIds
    );

    const existingProducts = existCheck as any[];
    if (existingProducts.length !== productIds.length) {
      throw new Error(`Expected ${productIds.length} products, found ${existingProducts.length}. Some products may have been modified.`);
    }

    const nonSimple = existingProducts.filter(p => p.product_type !== 'simple');
    if (nonSimple.length > 0) {
      throw new Error(`Products ${nonSimple.map((p: any) => p.ID).join(', ')} are not simple products.`);
    }

    // Step 2: Get parent and children
    const parentId = group.suggestedParentId;
    const childIds = productIds.filter(id => id !== parentId);

    // Step 3: Rename parent to base name
    const parentSlug = group.baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 200);
    await connection.execute(
      `UPDATE wp_posts SET post_title = ?, post_name = ? WHERE ID = ?`,
      [group.baseName, parentSlug, parentId]
    );

    // Step 4: Switch parent from simple to variable
    // Get taxonomy IDs
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

    if (!simpleTermTaxId || !variableTermTaxId) {
      throw new Error('Could not find simple/variable product_type taxonomy terms');
    }

    // Remove simple type relationship from parent
    await connection.execute(
      `DELETE FROM wp_term_relationships WHERE object_id = ? AND term_taxonomy_id = ?`,
      [parentId, simpleTermTaxId]
    );

    // Add variable type relationship to parent
    await connection.execute(
      `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
      [parentId, variableTermTaxId]
    );

    // Update taxonomy counts
    await connection.execute(
      `UPDATE wp_term_taxonomy SET count = GREATEST(count - 1, 0) WHERE term_taxonomy_id = ?`,
      [simpleTermTaxId]
    );
    await connection.execute(
      `UPDATE wp_term_taxonomy SET count = count + 1 WHERE term_taxonomy_id = ?`,
      [variableTermTaxId]
    );

    // Update _product_type meta
    await connection.execute(
      `UPDATE wp_postmeta SET meta_value = 'variable' WHERE post_id = ? AND meta_key = '_product_type'`,
      [parentId]
    );

    // Step 5: Set up attribute taxonomy
    const attrName = group.variationAttribute === 'flavor' ? 'Flavor' :
                     group.variationAttribute === 'color' ? 'Color' :
                     group.variationAttribute === 'size' ? 'Size' :
                     group.variationAttribute === 'style' ? 'Style' : 'Variant';

    await getOrCreateAttribute(connection, attrName);
    const taxonomy = `pa_${attrName.toLowerCase()}`;

    // Get variation option values for all products
    const allProducts = [
      group.products.find(p => p.id === parentId)!,
      ...group.products.filter(p => p.id !== parentId),
    ];

    const variationOptions = allProducts.map(p =>
      getVariationOption(p, group.variationAttribute)
    );

    // Create terms and link to parent
    const termSlugs: string[] = [];
    for (const option of variationOptions) {
      const { termTaxonomyId, slug } = await getOrCreateTerm(connection, option, taxonomy);
      termSlugs.push(slug);

      await connection.execute(
        `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
        [parentId, termTaxonomyId]
      );
    }

    // Step 6: Set parent _product_attributes
    const serializedAttrs = serializeAttributes(attrName, taxonomy);

    // Delete existing _product_attributes
    await connection.execute(
      `DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_attributes'`,
      [parentId]
    );

    await connection.execute(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_attributes', ?)`,
      [parentId, serializedAttrs]
    );

    // Set default attributes
    const firstTermSlug = termSlugs[0] || '';
    const serializedDefaults = serializeDefaultAttributes(taxonomy, firstTermSlug);

    await connection.execute(
      `DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = '_default_attributes'`,
      [parentId]
    );
    await connection.execute(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_default_attributes', ?)`,
      [parentId, serializedDefaults]
    );

    // Step 7: Convert all products (including parent's original) to variations
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    for (let i = 0; i < allProducts.length; i++) {
      const product = allProducts[i];
      const termSlug = termSlugs[i];

      if (product.id === parentId) {
        // Parent stays as product post_type but we need to create a variation for its original data
        // Create a new variation post for the parent's original data
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
            '', ?, '', ?, 'product_variation',
            '', 0
          )`,
          [now, now, now, now, parentId, i]
        );

        const variationId = (varResult as any).insertId;

        // Update GUID
        await connection.execute(
          `UPDATE wp_posts SET guid = ? WHERE ID = ?`,
          [`http://maleq-local.local/?post_type=product_variation&p=${variationId}`, variationId]
        );

        // Copy meta from parent to this new variation
        const varMeta: [number, string, string][] = [
          [variationId, '_sku', product.sku],
          [variationId, '_regular_price', product.regularPrice],
          [variationId, '_sale_price', product.salePrice],
          [variationId, '_price', product.price],
          [variationId, '_stock', product.stockQty.toString()],
          [variationId, '_stock_status', product.stockStatus],
          [variationId, '_manage_stock', 'yes'],
          [variationId, '_backorders', 'no'],
          [variationId, '_virtual', 'no'],
          [variationId, '_downloadable', 'no'],
          [variationId, `attribute_${taxonomy}`, termSlug],
          [variationId, '_low_stock_amount', '3'],
        ];

        if (product.thumbnailId) {
          varMeta.push([variationId, '_thumbnail_id', product.thumbnailId.toString()]);
        }

        for (const [pid, key, value] of varMeta) {
          await connection.execute(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
            [pid, key, value]
          );
        }

        // Add to WooCommerce lookup table
        await connection.execute(
          `INSERT INTO wp_wc_product_meta_lookup (
            product_id, sku, \`virtual\`, downloadable, min_price, max_price,
            onsale, stock_quantity, stock_status, rating_count, average_rating, total_sales
          ) VALUES (?, ?, 0, 0, ?, ?, 1, ?, ?, 0, 0, 0)`,
          [variationId, product.sku, product.salePrice, product.salePrice, product.stockQty, product.stockStatus]
        );

        resultBase.variationIds.push(variationId);

      } else {
        // Convert child: change post_type to product_variation, set post_parent
        await connection.execute(
          `UPDATE wp_posts SET post_type = 'product_variation', post_parent = ?, post_content = '', post_title = '', post_excerpt = '', menu_order = ? WHERE ID = ?`,
          [parentId, i, product.id]
        );

        // Update GUID
        await connection.execute(
          `UPDATE wp_posts SET guid = ? WHERE ID = ?`,
          [`http://maleq-local.local/?post_type=product_variation&p=${product.id}`, product.id]
        );

        // Add attribute meta
        await connection.execute(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
          [product.id, `attribute_${taxonomy}`, termSlug]
        );

        // Remove product_type taxonomy from child
        await connection.execute(
          `DELETE FROM wp_term_relationships WHERE object_id = ? AND term_taxonomy_id = ?`,
          [product.id, simpleTermTaxId]
        );

        // Update simple type count
        await connection.execute(
          `UPDATE wp_term_taxonomy SET count = GREATEST(count - 1, 0) WHERE term_taxonomy_id = ?`,
          [simpleTermTaxId]
        );

        // Remove product_brand and product_cat from child (variations inherit from parent)
        await connection.execute(
          `DELETE tr FROM wp_term_relationships tr
           INNER JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
           WHERE tr.object_id = ? AND tt.taxonomy IN ('product_brand', 'product_cat')`,
          [product.id]
        );
      }
    }

    // Step 8: Update parent pricing
    const allPrices = allProducts.map(p => parseFloat(p.price) || 0).filter(p => p > 0);
    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);

    // Set parent _price to min
    await connection.execute(
      `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_price'`,
      [minPrice.toString(), parentId]
    );

    // Remove parent _regular_price and _sale_price (variable products use variation prices)
    await connection.execute(
      `DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key IN ('_regular_price', '_sale_price')`,
      [parentId]
    );

    // Set parent stock management to 'no' (variations manage their own)
    await connection.execute(
      `UPDATE wp_postmeta SET meta_value = 'no' WHERE post_id = ? AND meta_key = '_manage_stock'`,
      [parentId]
    );

    // Remove parent _sku (parent gets a generated one)
    const parentSku = `VAR-${group.brandCode}-${group.baseName.substring(0, 30).replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/-$/, '').toUpperCase()}`;
    await connection.execute(
      `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_sku'`,
      [parentSku, parentId]
    );

    // Step 9: Update wp_wc_product_meta_lookup for parent
    await connection.execute(
      `UPDATE wp_wc_product_meta_lookup
       SET sku = ?, min_price = ?, max_price = ?, stock_quantity = 0, stock_status = 'instock', onsale = 1
       WHERE product_id = ?`,
      [parentSku, minPrice, maxPrice, parentId]
    );

    // Step 10: Move reviews from children to parent
    for (const childId of childIds) {
      await connection.execute(
        `UPDATE wp_comments SET comment_post_ID = ? WHERE comment_post_ID = ?`,
        [parentId, childId]
      );
    }

    await connection.commit();

    return { ...resultBase, success: true };

  } catch (error) {
    await connection.rollback();
    return {
      ...resultBase,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ==================== REPORTING ====================

function printAnalysisReport(groups: DetectedGroup[], totalProducts: number): void {
  const totalInGroups = groups.reduce((sum, g) => sum + g.products.length, 0);

  console.log('\n=== VARIATION ANALYSIS REPORT ===\n');
  console.log(`Total simple products queried: ${totalProducts}`);
  console.log(`Total potential variation groups: ${groups.length}`);
  console.log(`Total products that could be grouped: ${totalInGroups}`);
  console.log(`Ungrouped products: ${totalProducts - totalInGroups}`);

  const byConfidence = {
    high: groups.filter(g => g.confidence === 'high').length,
    medium: groups.filter(g => g.confidence === 'medium').length,
    low: groups.filter(g => g.confidence === 'low').length,
  };
  console.log(`\nConfidence breakdown: HIGH=${byConfidence.high}  MEDIUM=${byConfidence.medium}  LOW=${byConfidence.low}\n`);

  for (const group of groups) {
    const confLabel = group.confidence === 'high' ? 'HIGH' :
                      group.confidence === 'medium' ? 'MED' : 'LOW';

    console.log(`--- Group ${group.groupId} (${confLabel} confidence) ---`);
    console.log(`  Base Name: "${group.baseName}"`);
    console.log(`  Brand: ${group.brandName} (${group.brandCode})`);
    console.log(`  Variation Type: ${group.variationAttribute || 'unknown'}`);
    console.log(`  Products (${group.products.length}):`);

    for (const p of group.products) {
      const parentMarker = p.id === group.suggestedParentId ? ' [PARENT]' : '';
      const optionValue = getVariationOption(p, group.variationAttribute);
      console.log(`    ID: ${p.id}  "${p.title}"  SKU: ${p.sku}  Price: $${p.price}  Option: ${optionValue}${parentMarker}`);
    }
    console.log('');
  }
}

function printDryRunReport(groups: DetectedGroup[]): void {
  printAnalysisReport(groups, 0);

  console.log('\n=== CONVERSION PLAN ===\n');

  for (const group of groups) {
    const attrName = group.variationAttribute === 'flavor' ? 'Flavor' :
                     group.variationAttribute === 'color' ? 'Color' :
                     group.variationAttribute === 'size' ? 'Size' :
                     group.variationAttribute === 'style' ? 'Style' : 'Variant';
    const taxonomy = `pa_${attrName.toLowerCase()}`;

    console.log(`Group ${group.groupId}: "${group.baseName}"`);

    const parent = group.products.find(p => p.id === group.suggestedParentId)!;
    console.log(`  1. Parent (ID ${parent.id}) "${parent.title}" -> type changes simple->variable, renamed to "${group.baseName}"`);
    console.log(`     Create new variation for parent's original data (SKU: ${parent.sku})`);

    let step = 2;
    for (const p of group.products.filter(p => p.id !== group.suggestedParentId)) {
      const optionValue = getVariationOption(p, group.variationAttribute);
      console.log(`  ${step}. Convert ID ${p.id} "${p.title}" -> product_variation, post_parent=${group.suggestedParentId}, ${taxonomy}="${optionValue}"`);
      step++;
    }

    const options = group.products.map(p => getVariationOption(p, group.variationAttribute));
    console.log(`  ${step}. Create ${taxonomy} attribute with terms: ${options.join(', ')}`);
    step++;
    console.log(`  ${step}. Set parent _product_attributes (serialized)`);
    step++;
    const prices = group.products.map(p => parseFloat(p.price));
    console.log(`  ${step}. Set parent _price = min($${Math.min(...prices).toFixed(2)}), max($${Math.max(...prices).toFixed(2)})`);
    console.log('');
  }
}

// ==================== MAIN ====================

async function main(): Promise<void> {
  const options = parseArgs();

  console.log(`\nDetect Missed Variations - Mode: ${options.mode.toUpperCase()}\n`);

  // Connect to database
  const connection = await mysql.createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });

  console.log('Connected to Local MySQL database\n');

  try {
    // If --input is provided, load groups from file (for --apply with reviewed data)
    if (options.input && options.mode === 'apply') {
      console.log(`Loading approved groups from: ${options.input}\n`);
      const inputData = JSON.parse(readFileSync(options.input, 'utf-8')) as AnalysisReport;

      console.log(`Found ${inputData.groups.length} approved groups\n`);

      let successCount = 0;
      let errorCount = 0;

      for (const group of inputData.groups) {
        console.log(`Converting group ${group.groupId}: "${group.baseName}" (${group.products.length} products)...`);
        const result = await convertGroup(connection, group);
        if (result.success) {
          console.log(`  Success! Parent: ${result.parentId}, Variations: ${result.variationIds.join(', ')}`);
          successCount++;
        } else {
          console.log(`  FAILED: ${result.error}`);
          errorCount++;
        }
      }

      console.log(`\n=== CONVERSION SUMMARY ===`);
      console.log(`Successful: ${successCount}`);
      console.log(`Failed: ${errorCount}`);
      return;
    }

    // Fetch all simple products
    console.log('Fetching simple products...');
    const products = await fetchAllSimpleProducts(connection, options);
    console.log(`Found ${products.length} simple products\n`);

    if (products.length === 0) {
      console.log('No simple products found. Nothing to analyze.');
      return;
    }

    // Group products
    console.log('Analyzing products for potential variations...');
    const groups = groupProducts(products, options);
    console.log(`Found ${groups.length} potential variation groups\n`);

    if (groups.length === 0) {
      console.log('No potential variation groups detected.');
      return;
    }

    // Output based on mode
    switch (options.mode) {
      case 'analyze':
        printAnalysisReport(groups, products.length);
        break;

      case 'dry-run':
        printDryRunReport(groups);
        break;

      case 'apply': {
        printAnalysisReport(groups, products.length);

        console.log('\n=== APPLYING CONVERSIONS ===\n');

        let successCount = 0;
        let errorCount = 0;

        for (const group of groups) {
          console.log(`Converting group ${group.groupId}: "${group.baseName}" (${group.products.length} products)...`);
          const result = await convertGroup(connection, group);
          if (result.success) {
            console.log(`  Success! Parent: ${result.parentId}, Variations: ${result.variationIds.join(', ')}`);
            successCount++;
          } else {
            console.log(`  FAILED: ${result.error}`);
            errorCount++;
          }
        }

        console.log(`\n=== CONVERSION SUMMARY ===`);
        console.log(`Successful: ${successCount}`);
        console.log(`Failed: ${errorCount}`);
        break;
      }
    }

    // Write JSON report if --output specified
    if (options.output) {
      const report: AnalysisReport = {
        timestamp: new Date().toISOString(),
        totalSimpleProducts: products.length,
        totalGroupsFound: groups.length,
        totalProductsInGroups: groups.reduce((sum, g) => sum + g.products.length, 0),
        groups,
      };

      writeFileSync(options.output, JSON.stringify(report, null, 2));
      console.log(`\nReport written to: ${options.output}`);
    }

  } finally {
    await connection.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
