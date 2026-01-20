/**
 * Attribute Extractor
 * Extracts product attributes (dimensions, weight, materials, colors) from text
 * Used by both product-importer and attribute-parser script
 */

import { normalizeMaterial, normalizeColor, parseMaterials, parseColors } from './attribute-normalizer';

// ==================== TYPE DEFINITIONS ====================

export interface ExtractedDimensions {
  length?: number;
  insertableLength?: number;
  width?: number;
  diameter?: number;
  circumference?: number;
  height?: number;
}

export interface ExtractedWeight {
  value: number;
  unit: string;
  valueInOz: number;
  valueInLbs: number;
}

export interface ExtractedAttributes {
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

// ==================== DIMENSION PATTERNS ====================

const DIMENSION_PATTERNS = {
  length: [
    /(?:total\s+)?length[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")\s+(?:long|in\s+length|total\s+length)/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)\s+(?:\w+\s+)?(?:handle\s+)?length/gi,
    /length\s*[:\s]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)/gi,
    /measures\s+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)/gi,
    /(\d+(?:\.\d+)?)\s+(?:big\s+)?inches?\s+(?:of|long)/gi,
    /approximately\s+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)/gi,
    /about\s+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)\s+(?:long|in\s+length)/gi,
  ],
  lengthMetric: [
    /(?:total\s+)?length[:\s]+(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)\s+(?:long|in\s+length)/gi,
    /length\s*[:\s]\s*(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:mm|millimeters?)\s+(?:long|in\s+length)/gi,
    /length[:\s]+(\d+(?:\.\d+)?)\s*(?:mm|millimeters?)/gi,
  ],
  insertableLength: [
    /insertable\s*(?:length)?[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/gi,
    /insertion\s*(?:length)?[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)/gi,
    /insertable[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)\s+(?:\w+\s+)*insertion\s+length/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)\s+insertable/gi,
    /usable\s+length[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)\s+of\s+insertable/gi,
  ],
  width: [
    /width[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")\s+(?:wide|in\s+width)/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)\s+wide(?:\s+\w+)?/gi,
    /max(?:imum)?\s+width[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)/gi,
  ],
  widthMetric: [
    /width[:\s]+(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)\s+(?:wide|in\s+width)/gi,
  ],
  diameter: [
    /diameter[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")\s+(?:diameter|dia\.?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)\s+(?:thick|girth)/gi,
    /max(?:imum)?\s+diameter[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)/gi,
  ],
  diameterMetric: [
    /diameter[:\s]+(\d+(?:\.\d+)?)\s*(?:cm|centimeters?|mm|millimeters?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:cm|centimeters?|mm|millimeters?)\s+(?:diameter|dia\.?)/gi,
  ],
  circumference: [
    /circumference[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/gi,
    /girth[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)\s+around/gi,
  ],
  height: [
    /height[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)\s+(?:in\s+)?height/gi,
    /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)\s+tall/gi,
    /stands\s+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)/gi,
  ],
  heightMetric: [
    /height[:\s]+(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)\s+(?:in\s+)?height/gi,
    /(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)\s+tall/gi,
  ],
};

// ==================== WEIGHT PATTERNS ====================

const WEIGHT_PATTERNS = [
  { pattern: /weight[:\s]+(\d+(?:\.\d+)?)\s*(?:ounces?|oz\.?)\b/gi, unit: 'oz' },
  { pattern: /weighs?\s+(\d+(?:\.\d+)?)\s*(?:ounces?|oz\.?)\b/gi, unit: 'oz' },
  { pattern: /weight[:\s]+(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?\.?)\b/gi, unit: 'lbs' },
  { pattern: /weighs?\s+(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?\.?)\b/gi, unit: 'lbs' },
  { pattern: /(\d+(?:\.\d+)?)\s*(?:ounces?|oz\.?)\s*(?:\.|$|Premium|Body)/gi, unit: 'oz' },
];

// ==================== MATERIAL PATTERNS ====================

const MATERIAL_EXTRACTION_PATTERNS = [
  /\bMaterials?[:\s]+([A-Za-z,\s\/\-()]+?)(?:\.|Categories:|Features:|Specifications:|Key\s+features|Product\s+|$)/gi,
  /body\s+safe\s+materials?\s+([A-Za-z,\s\/\-()]+?)(?:\.|!|\?|\n|Categories:|$)/gi,
  /made\s+(?:of|from|with)\s+(?:(?:premium|pure|body\s+safe|high\s+quality|soft|flexible)\s+)*([A-Za-z,\s\/\-]+?)(?:\.|,|\s+and\s+|\s+that\s+|\s+which\s+|\s+for\s+|$)/gi,
  /crafted\s+(?:from|with)\s+(?:(?:premium|pure|soft)\s+)*([A-Za-z,\s\/\-]+?)(?:\.|,|$)/gi,
  /constructed\s+(?:of|from)\s+([A-Za-z,\s\/\-]+?)(?:\.|,|$)/gi,
  /Product\s+materials?[:\s]+([A-Za-z,\s\/\-]+?)(?:\.|Categories:|$)/gi,
  /is\s+made\s+(?:of|from)\s+(?:body\s+safe\s+)?([A-Za-z,\s\/\-]+?)(?:\.|,|$)/gi,
  /features?\s+(?:body\s+safe\s+)?([A-Za-z,\s\/\-]+?)\s+(?:construction|material|design)/gi,
  /([A-Za-z]+)\s+(?:construction|body|exterior|casing)/gi,
  /(?:100%|pure)\s+([A-Za-z]+)/gi,
  /premium\s+([A-Za-z]+)\s+(?:that|which|for|with)/gi,
  /this\s+([A-Za-z]+)\s+(?:toy|plug|vibe|vibrator|massager|dildo|ring|sleeve)/gi,
  /coated\s+(?:in|with)\s+([A-Za-z,\s\/\-]+?)(?:\.|,|$)/gi,
  /covered\s+(?:in|with)\s+([A-Za-z,\s\/\-]+?)(?:\.|,|$)/gi,
  /consists?\s+of\s+([A-Za-z,\s\/\-]+?)(?:\.|,|$)/gi,
  /composed\s+of\s+([A-Za-z,\s\/\-]+?)(?:\.|,|$)/gi,
];

const KNOWN_MATERIALS = [
  'abs plastic', 'abs', 'polycarbonate', 'polypropylene', 'polyurethane', 'acrylic',
  'silicone', 'medical grade silicone', 'platinum silicone', 'liquid silicone',
  'sil-a-gel', 'silaskin', 'pure silicone',
  'tpe', 'tpr', 'thermoplastic elastomer', 'thermoplastic rubber',
  'fanta flesh', 'sensafirm', 'superskin',
  'pvc', 'vinyl', 'jelly', 'enhanced pvc',
  'latex', 'rubber', 'elastomer', 'sebs',
  'metal', 'steel', 'stainless steel', 'aluminum', 'alloy', 'zinc alloy',
  'chrome', 'nickel free', 'titanium', 'brass', 'copper',
  'glass', 'borosilicate glass', 'pyrex', 'tempered glass',
  'leather', 'faux leather', 'pu leather', 'vegan leather', 'leatherette',
  'genuine leather', 'patent leather',
  'nylon', 'spandex', 'polyester', 'cotton', 'lace', 'mesh',
  'satin', 'silk', 'velvet', 'microfiber', 'lycra', 'elastane',
  'neoprene', 'fishnet',
  'cyberskin', 'bioskin', 'ultraskyn', 'vixskin', 'real feel', 'pure skin',
  'wood', 'bamboo', 'ceramic', 'stone',
  'feathers', 'feather', 'fur', 'faux fur',
  'crystals', 'crystal', 'resin', 'foam', 'memory foam', 'gel', 'wax',
];

// ==================== COLOR PATTERNS ====================

const COLOR_NAMES = [
  'black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple',
  'pink', 'brown', 'gray', 'grey', 'clear', 'transparent',
  'flesh', 'nude', 'vanilla', 'caramel', 'chocolate', 'mocha', 'coffee',
  'light flesh', 'dark flesh', 'tan', 'beige', 'ivory', 'cream',
  'cocoa', 'honey', 'cinnamon', 'latte',
  'gold', 'silver', 'bronze', 'copper', 'rose gold', 'chrome',
  'gunmetal', 'platinum', 'brass', 'metallic',
  'hot pink', 'light pink', 'baby pink', 'blush', 'rose', 'fuchsia', 'magenta',
  'coral', 'salmon', 'peach', 'dusty pink', 'fairy pink', 'neon pink',
  'violet', 'lavender', 'plum', 'lilac', 'indigo', 'grape', 'eggplant',
  'amethyst', 'orchid', 'mauve',
  'navy', 'royal blue', 'light blue', 'sky blue', 'teal', 'turquoise', 'aqua',
  'cobalt', 'midnight blue', 'electric blue', 'powder blue', 'ocean',
  'lime', 'mint', 'emerald', 'olive', 'forest green', 'sage', 'seafoam',
  'jade', 'hunter green', 'neon green',
  'crimson', 'scarlet', 'burgundy', 'maroon', 'wine', 'cherry',
  'ruby', 'brick', 'blood red',
  'tangerine', 'rust', 'amber', 'apricot', 'burnt orange',
  'lemon', 'mustard', 'canary', 'buttercup', 'neon yellow',
  'charcoal', 'slate', 'taupe', 'khaki', 'sand', 'oatmeal',
  'espresso', 'chestnut', 'mahogany', 'walnut',
  'rainbow', 'multi', 'multicolor', 'assorted', 'tie dye', 'ombre', 'gradient',
  'glow', 'neon', 'glitter', 'sparkle', 'holographic', 'iridescent',
];

const COLOR_EXTRACTION_PATTERNS = [
  /\bColors?[:\s]+([A-Za-z,\s\/\-]+?)(?:\.|Categories:|Material|Features:|Specifications:|$)/gi,
  /available\s+in\s+([A-Za-z,\s\/\-]+?)(?:\.|!|\?|$)/gi,
  /comes\s+in\s+([A-Za-z,\s\/\-]+?)(?:\.|!|\?|$)/gi,
  /offered\s+in\s+([A-Za-z,\s\/\-]+?)(?:\.|!|\?|$)/gi,
];

const COLOR_FALSE_POSITIVES = [
  'may vary', 'vary', 'of each', 'star sign', 'block with',
  'classic', 'skin tone', 'light skin', 'dark skin',
  'over time', 'and blue', 'and pink', 'and black', 'and white',
  'and red', 'and purple', 'package', 'and sizes', 'sizes',
  'ice pink', 'ice blue', 'ice', 'cerise', 'berry',
  'pump bottle', 'handy pump', 'a handy', 'bottle',
  'silicone', 'plastic', 'latex', 'rubber', 'metal',
  'the in', 'dark the', 'glow in', 'in the dark',
];

const COLOR_CONTEXT_EXCLUDES: Record<string, string[]> = {
  'cream': ['hot cream', 'shave cream', 'body cream', 'massage cream', 'hand cream'],
  'rose': ['rose scent', 'rose oil', 'rose petal'],
  'cherry': ['cherry flavor', 'cherry scent'],
  'vanilla': ['vanilla flavor', 'vanilla scent'],
  'peach': ['peach flavor', 'peach scent'],
  'mint': ['mint flavor', 'peppermint'],
  'honey': ['honey flavor'],
  'chocolate': ['chocolate flavor'],
  'coffee': ['coffee flavor'],
};

// ==================== UTILITY FUNCTIONS ====================

function convertToInches(value: number, unit: 'cm' | 'mm'): number {
  if (unit === 'cm') return value / 2.54;
  if (unit === 'mm') return value / 25.4;
  return value;
}

function extractDimension(text: string, patterns: RegExp[], isMetric: boolean = false): number | undefined {
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(text);
    if (match && match[1]) {
      let value = parseFloat(match[1]);
      if (!isNaN(value) && value > 0) {
        if (isMetric) {
          const matchStr = match[0].toLowerCase();
          if (matchStr.includes('mm') || matchStr.includes('millimeter')) {
            value = convertToInches(value, 'mm');
          } else if (matchStr.includes('cm') || matchStr.includes('centimeter')) {
            value = convertToInches(value, 'cm');
          }
        }
        if (value > 0 && value < 100) {
          return Math.round(value * 100) / 100;
        }
      }
    }
  }
  return undefined;
}

function parseByDimensions(text: string): { length?: number; width?: number; height?: number } {
  const imperialPattern = /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")?\s*(?:by|x)\s+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")?\s*(?:(?:by|x)\s+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")?)?/gi;
  const match = imperialPattern.exec(text);
  if (match) {
    const dims: { length?: number; width?: number; height?: number } = {};
    if (match[1]) dims.length = parseFloat(match[1]);
    if (match[2]) dims.width = parseFloat(match[2]);
    if (match[3]) dims.height = parseFloat(match[3]);
    if (dims.length && (dims.length <= 0 || dims.length > 100)) delete dims.length;
    if (dims.width && (dims.width <= 0 || dims.width > 100)) delete dims.width;
    if (dims.height && (dims.height <= 0 || dims.height > 100)) delete dims.height;
    if (Object.keys(dims).length > 0) return dims;
  }
  return {};
}

function extractMaterialName(text: string): string | null {
  const lowerText = text.toLowerCase().trim();
  for (const material of KNOWN_MATERIALS) {
    if (lowerText.includes(material)) {
      return normalizeMaterial(material);
    }
  }
  return null;
}

function isValidColor(color: string, fullText: string = ''): boolean {
  const lower = color.toLowerCase().trim();
  const lowerText = fullText.toLowerCase();

  if (lower.length < 2 || lower.length > 25) return false;
  if (COLOR_FALSE_POSITIVES.some(fp => lower.includes(fp))) return false;

  const invalidWords = ['bottle', 'pump', 'tube', 'pack', 'size', 'inch', 'oz', 'ml', 'safe', 'free'];
  if (invalidWords.some(w => lower.includes(w))) return false;

  if (fullText && COLOR_CONTEXT_EXCLUDES[lower]) {
    const excludePhrases = COLOR_CONTEXT_EXCLUDES[lower];
    if (excludePhrases.some(phrase => lowerText.includes(phrase))) {
      return false;
    }
  }

  return true;
}

// ==================== MAIN EXTRACTION FUNCTIONS ====================

/**
 * Extract dimensions from product description text
 */
export function extractDimensions(text: string): ExtractedDimensions {
  const dimensions: ExtractedDimensions = {};

  // First try "X by Y by Z" format
  const byDims = parseByDimensions(text);
  if (byDims.length) dimensions.length = byDims.length;
  if (byDims.width) dimensions.width = byDims.width;
  if (byDims.height) dimensions.height = byDims.height;

  // Try specific patterns (override "by" format if more specific)
  let explicitLength = extractDimension(text, DIMENSION_PATTERNS.length);
  if (!explicitLength) {
    explicitLength = extractDimension(text, DIMENSION_PATTERNS.lengthMetric, true);
  }
  if (explicitLength) dimensions.length = explicitLength;

  dimensions.insertableLength = extractDimension(text, DIMENSION_PATTERNS.insertableLength);

  let explicitWidth = extractDimension(text, DIMENSION_PATTERNS.width);
  if (!explicitWidth) {
    explicitWidth = extractDimension(text, DIMENSION_PATTERNS.widthMetric, true);
  }
  if (explicitWidth) dimensions.width = explicitWidth;

  let diameter = extractDimension(text, DIMENSION_PATTERNS.diameter);
  if (!diameter) {
    diameter = extractDimension(text, DIMENSION_PATTERNS.diameterMetric, true);
  }
  if (diameter) dimensions.diameter = diameter;

  dimensions.circumference = extractDimension(text, DIMENSION_PATTERNS.circumference);

  let explicitHeight = extractDimension(text, DIMENSION_PATTERNS.height);
  if (!explicitHeight) {
    explicitHeight = extractDimension(text, DIMENSION_PATTERNS.heightMetric, true);
  }
  if (explicitHeight) dimensions.height = explicitHeight;

  // Clean up undefined values
  Object.keys(dimensions).forEach(key => {
    if (dimensions[key as keyof ExtractedDimensions] === undefined) {
      delete dimensions[key as keyof ExtractedDimensions];
    }
  });

  return dimensions;
}

/**
 * Extract weight from product description text
 */
export function extractWeight(text: string): ExtractedWeight | undefined {
  for (const { pattern, unit } of WEIGHT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(text);
    if (match && match[1]) {
      const value = parseFloat(match[1]);
      if (!isNaN(value) && value > 0 && value < 100) {
        let valueInOz = value;
        let valueInLbs = value;
        if (unit === 'lbs') {
          valueInOz = value * 16;
          valueInLbs = value;
        } else {
          valueInOz = value;
          valueInLbs = value / 16;
        }
        return { value, unit, valueInOz, valueInLbs };
      }
    }
  }
  return undefined;
}

/**
 * Extract materials from product description text
 */
export function extractMaterialsFromText(text: string): string[] {
  const materials: Set<string> = new Set();

  for (const pattern of MATERIAL_EXTRACTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        const matchText = match[1].trim();
        if (matchText.length > 100) continue;

        const parts = matchText.split(/[,\/]+/);
        for (const part of parts) {
          const trimmedPart = part.trim();
          if (trimmedPart.length === 0) continue;

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
 * Extract colors from product description and title
 */
export function extractColorsFromText(text: string, title: string): string[] {
  const colors: Set<string> = new Set();
  const lowerTitle = title.toLowerCase();
  const combinedText = `${title} ${text}`;

  // Try structured patterns
  for (const pattern of COLOR_EXTRACTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        const colorStr = match[1].trim().toLowerCase();
        if (!isValidColor(colorStr, combinedText)) continue;

        const colorParts = colorStr.split(/[,\/]+/);
        for (const part of colorParts) {
          const trimmed = part.trim();
          if (isValidColor(trimmed, combinedText)) {
            const normalized = normalizeColor(trimmed);
            if (normalized && isValidColor(normalized, combinedText)) {
              colors.add(normalized);
            }
          }
        }
      }
    }
  }

  // Search for color names in title
  for (const colorName of COLOR_NAMES) {
    const colorLower = colorName.toLowerCase();
    const titleWords = lowerTitle.split(/\s+/);
    if (titleWords.includes(colorLower) ||
        lowerTitle.includes(` ${colorLower} `) ||
        lowerTitle.endsWith(` ${colorLower}`) ||
        lowerTitle.startsWith(`${colorLower} `)) {
      const normalized = normalizeColor(colorName);
      if (normalized && isValidColor(normalized, combinedText)) {
        colors.add(normalized);
      }
    }
  }

  return Array.from(colors);
}

/**
 * Merge XML data with extracted text data
 * Prioritizes XML data but supplements with text extraction
 */
export function enhanceProductAttributes(
  xmlData: {
    color?: string;
    material?: string;
    weight?: string;
    length?: string;
    width?: string;
    height?: string;
    diameter?: string;
  },
  description: string,
  title: string
): {
  colors: string[];
  materials: string[];
  weight: string;
  length: string;
  width: string;
  height: string;
} {
  // Get normalized colors from XML
  const xmlColors = xmlData.color ? parseColors(xmlData.color) : [];
  // Extract additional colors from description
  const textColors = extractColorsFromText(description, title);
  // Merge and deduplicate
  const allColors = [...new Set([...xmlColors, ...textColors])];

  // Get normalized materials from XML
  const xmlMaterials = xmlData.material ? parseMaterials(xmlData.material) : [];
  // Extract additional materials from description
  const textMaterials = extractMaterialsFromText(description);
  // Merge and deduplicate
  const allMaterials = [...new Set([...xmlMaterials, ...textMaterials])];

  // Start with XML dimensions
  let weight = xmlData.weight || '';
  let length = xmlData.length || '';
  let width = xmlData.width || xmlData.diameter || '';
  let height = xmlData.height || '';

  // If any dimension is missing, try to extract from description
  if (!weight || !length || !width || !height) {
    const extractedDims = extractDimensions(description);
    const extractedWeight = extractWeight(description);

    if (!length && extractedDims.length) {
      length = extractedDims.length.toString();
    }
    if (!width && (extractedDims.width || extractedDims.diameter)) {
      width = (extractedDims.width || extractedDims.diameter)?.toString() || '';
    }
    if (!height && extractedDims.height) {
      height = extractedDims.height.toString();
    }
    if (!weight && extractedWeight) {
      weight = extractedWeight.valueInLbs.toFixed(2);
    }
  }

  return {
    colors: allColors,
    materials: allMaterials,
    weight,
    length,
    width,
    height,
  };
}
