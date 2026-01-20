/**
 * Attribute Normalizer
 * Normalizes material, color, and other product attributes to canonical forms
 * Matches the PHP normalization in wpgraphql-materials.php for consistency
 */

/**
 * Material normalization mapping
 * Maps variant names to canonical material names
 */
const MATERIAL_NORMALIZATION_MAP: Record<string, string> = {
  // ABS Plastic variants
  'abs': 'ABS Plastic',
  'abs / latex': 'ABS Plastic',
  'abs / pu': 'ABS Plastic',
  'abs / silver plating': 'ABS Plastic',
  'abs plastic / rubber cote': 'ABS Plastic',
  'abs plastic silver plating': 'ABS Plastic',
  'abs plastic with silver plating': 'ABS Plastic',
  'abs silver plating': 'ABS Plastic',
  'abs with silver plating': 'ABS Plastic',
  'as': 'ABS Plastic',

  // Aluminum variants
  'alumimum': 'Aluminum',
  'aluminium': 'Aluminum',
  'aluminum alloy': 'Aluminum',
  'alloy': 'Aluminum',

  // TPE variants
  'thermoplastic elastomer': 'TPE',
  'thermoplastic elastomer tpe': 'TPE',
  'thermoplastic elastomers': 'TPE',
  'thermoplastic elastomers tpe': 'TPE',
  'fanta flesh tpe': 'TPE',
  'fanta flesh': 'TPE',

  // TPR variants
  'thermoplastic rubber': 'TPR',
  'thermoplastic rubber tpr': 'TPR',
  'thermoplastic rubber tpr abs plastic': 'TPR',
  'thermoplastic rubbertpr': 'TPR',
  'thermoplastic elastomers tpr': 'TPR',
  'flextpr': 'TPR',
  'sensa feel tpr': 'TPR',
  'senso tpr': 'TPR',
  'pure skin tpr': 'TPR',
  'pure skin thermoplastic rubber tpr': 'TPR',
  'pure skin': 'TPR',
  'tpr blend': 'TPR',

  // Silicone variants
  'silicone blend': 'Silicone',
  'silicone silk': 'Silicone',
  'pfblend silicone': 'Silicone',
  'sil-a-gel': 'Silicone',
  'silaskin': 'Silicone',
  'si': 'Silicone',

  // PVC variants
  'pvc plastic': 'PVC',
  'better-than-real pvc': 'PVC',

  // Polyurethane variants
  'polyurethane pu': 'Polyurethane',
  'polyurethane pu rubber cote': 'Polyurethane',
  'polyurethane sprayed over abs': 'Polyurethane',
  'pu': 'Polyurethane',
  'pu coating': 'Polyurethane',
  'pu cote': 'Polyurethane',
  'tpu': 'Polyurethane',

  // Faux Leather variants
  'pu faux leather': 'Faux Leather',
  'pu leather': 'Faux Leather',
  'vegan leather': 'Faux Leather',
  'leatherette': 'Faux Leather',

  // Polypropylene variants
  'pp': 'Polypropylene',
  'polypropylene pp': 'Polypropylene',
  'polyproplyene': 'Polypropylene',
  'polyproylene pp': 'Polypropylene',
  'pp / gold plating': 'Polypropylene',
  'pp fiber': 'Polypropylene',
  'pp. metal': 'Polypropylene',

  // Polyester variants
  'poyester': 'Polyester',
  'polyester blend': 'Polyester',
  'polyester velvet': 'Polyester',
  '95%polyester 5%spandex': 'Polyester',

  // Polycarbonate variants
  'polycarbonate pc': 'Polycarbonate',
  'pc': 'Polycarbonate',

  // Glass variants
  'borosilicate glass': 'Glass',
  'glass fiber': 'Glass',
  'ffiberglass': 'Fiberglass',

  // Steel variants
  'stainless steel': 'Steel',
  'anodized steel': 'Steel',
  'electro plated steel': 'Steel',

  // Feather variants
  'feather': 'Feathers',
  'ostrich feather': 'Feathers',
  'turkey feathers': 'Feathers',

  // Crystal variants
  'crystal': 'Crystals',

  // Elastomer variants
  'elastomers': 'Elastomer',
  'elastan': 'Elastomer',
  'elastane': 'Elastomer',
  'elastine': 'Elastomer',
  'sebs': 'Elastomer',

  // Wax variants
  'microcrystalline wax': 'Wax',
  'paraffin wax': 'Wax',
  'parafin wax': 'Wax',
  'soy wax': 'Wax',
  'synthetic wax': 'Wax',

  // Nickel-free variants
  'nickel': 'Nickel Free Metal',
  'nickel free': 'Nickel Free Metal',
  'nickel free alloy': 'Nickel Free Metal',
  'nickel free alloy metal': 'Nickel Free Metal',

  // Nylon variants
  '62% nylon': 'Nylon',
  'fishnet nylon': 'Nylon',
  'nylon webbing': 'Nylon',
  'nylon/spandex': 'Nylon',

  // Spandex variants
  'spandex (fabric) 13% polyester': 'Spandex',
  'spandex blend': 'Spandex',

  // Fur variants
  'fur': 'Faux Fur',
  'imitation fur': 'Faux Fur',

  // Bioskin variants
  'real skin': 'Bioskin',
  'ultraskyn': 'Bioskin',
  'vixskin': 'Bioskin',

  // Misc
  'alkaline batteries': 'Alkaline',
  'anti-bacterial cleaner': 'Antibacterial',
  'vinyln': 'Vinyl',
  'water-based': 'Water',
  'cardboard': 'Cardboard',
  'faux gem': 'Faux Gems',
};

/**
 * Non-material terms to exclude
 * These are not actual materials and should be skipped
 */
const EXCLUDED_MATERIALS: string[] = [
  'catalog',
  'adult games',
  'cuffs',
  'luv cuffs',
  'sexual enhancers',
  'sensual enhancement',
  'shave cream',
  'coochy shave cream',
  'see ingredients in description',
  'testers',
  'get lucky',
  'earthly body - edible oil gift set',
  'furry holiday bagathers',
  'intramed',
  'kirite',
  'kraft cheese',
  'bath bomb',
  'bath salts',
  'cleaner',
  'confetti',
  'massage oil',
  'scented diffusers',
  'synthetic urine',
  'metallic dice',
  'lidocaine',
  'cbd',
  'herbs',
  'mixed berry flavor',
  'mint',
  'honey',
  'cocoa butter',
  'royal jelly',
  'shea butter',
  'vitamin e',
  'aloe vera',
  'aloe vera  - organic',
  'natural',
  'paperback book',
  'card stock paper',
  'paper',
  'sign',
  'tape',
  'paper plates',
];

/**
 * Color normalization mapping
 * Maps variant color names to canonical forms
 */
const COLOR_NORMALIZATION_MAP: Record<string, string> = {
  // Black variants
  'blk': 'Black',
  'blck': 'Black',
  'jet black': 'Black',
  'midnight black': 'Black',
  'onyx': 'Black',

  // White variants
  'wht': 'White',
  'off white': 'Off-White',
  'ivory': 'Ivory',
  'cream': 'Cream',
  'pearl': 'Pearl',

  // Pink variants
  'pnk': 'Pink',
  'hot pink': 'Hot Pink',
  'light pink': 'Light Pink',
  'baby pink': 'Baby Pink',
  'blush': 'Blush',
  'rose': 'Rose',
  'fuchsia': 'Fuchsia',
  'magenta': 'Magenta',

  // Purple variants
  'prpl': 'Purple',
  'violet': 'Violet',
  'lavender': 'Lavender',
  'plum': 'Plum',
  'grape': 'Purple',

  // Blue variants
  'blu': 'Blue',
  'navy': 'Navy',
  'navy blue': 'Navy',
  'royal blue': 'Royal Blue',
  'light blue': 'Light Blue',
  'sky blue': 'Sky Blue',
  'teal': 'Teal',
  'turquoise': 'Turquoise',
  'aqua': 'Aqua',
  'cobalt': 'Cobalt',

  // Green variants
  'grn': 'Green',
  'lime': 'Lime',
  'lime green': 'Lime',
  'olive': 'Olive',
  'forest green': 'Forest Green',
  'mint': 'Mint',
  'mint green': 'Mint',
  'emerald': 'Emerald',

  // Red variants
  'rd': 'Red',
  'crimson': 'Crimson',
  'scarlet': 'Scarlet',
  'burgundy': 'Burgundy',
  'maroon': 'Maroon',
  'wine': 'Wine',
  'cherry': 'Cherry',

  // Orange variants
  'org': 'Orange',
  'tangerine': 'Orange',
  'peach': 'Peach',
  'coral': 'Coral',
  'salmon': 'Salmon',

  // Yellow variants
  'ylw': 'Yellow',
  'gold': 'Gold',
  'golden': 'Gold',
  'lemon': 'Yellow',
  'mustard': 'Mustard',

  // Brown variants
  'brn': 'Brown',
  'tan': 'Tan',
  'beige': 'Beige',
  'caramel': 'Caramel',
  'chocolate': 'Chocolate',
  'mocha': 'Mocha',
  'coffee': 'Coffee',
  'bronze': 'Bronze',

  // Gray variants
  'gry': 'Gray',
  'grey': 'Gray',
  'silver': 'Silver',
  'charcoal': 'Charcoal',
  'slate': 'Slate',

  // Multi-color variants
  'multi': 'Multi-Color',
  'multicolor': 'Multi-Color',
  'multi-colored': 'Multi-Color',
  'rainbow': 'Rainbow',
  'assorted': 'Assorted',

  // Clear/Transparent
  'clr': 'Clear',
  'transparent': 'Clear',
  'see-through': 'Clear',

  // Skin tone variants
  'flesh': 'Flesh',
  'nude': 'Nude',
  'skin': 'Flesh',
  'light flesh': 'Light Flesh',
  'dark flesh': 'Dark Flesh',
  'vanilla': 'Vanilla',
  'caramel flesh': 'Caramel',
  'chocolate flesh': 'Chocolate',

  // Metallic colors
  'rose gold': 'Rose Gold',
  'chrome': 'Chrome',
  'copper': 'Copper',
  'brass': 'Brass',
};

/**
 * Convert string to title case
 */
function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Normalize a material name to its canonical form
 * Returns null if the material should be excluded
 */
export function normalizeMaterial(material: string): string | null {
  const trimmed = material.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  // Check if it's an excluded non-material
  if (EXCLUDED_MATERIALS.includes(lower)) {
    return null;
  }

  // Check normalization map
  if (MATERIAL_NORMALIZATION_MAP[lower]) {
    return MATERIAL_NORMALIZATION_MAP[lower];
  }

  // Default: title case
  return toTitleCase(trimmed);
}

/**
 * Normalize a color name to its canonical form
 */
export function normalizeColor(color: string): string {
  const trimmed = color.trim();
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();

  // Check normalization map
  if (COLOR_NORMALIZATION_MAP[lower]) {
    return COLOR_NORMALIZATION_MAP[lower];
  }

  // Default: title case
  return toTitleCase(trimmed);
}

/**
 * Parse and normalize a comma/slash separated material string
 * Returns an array of unique normalized material names
 */
export function parseMaterials(materialString: string): string[] {
  if (!materialString) return [];

  const materials = materialString
    .split(/[,\/]+/)
    .map(m => normalizeMaterial(m))
    .filter((m): m is string => m !== null);

  // Return unique values
  return [...new Set(materials)];
}

/**
 * Parse and normalize a comma/slash separated color string
 * Returns an array of unique normalized color names
 */
export function parseColors(colorString: string): string[] {
  if (!colorString) return [];

  const colors = colorString
    .split(/[,\/]+/)
    .map(c => normalizeColor(c))
    .filter(c => c.length > 0);

  // Return unique values
  return [...new Set(colors)];
}

/**
 * Get the normalized material string for storage in meta
 * Joins multiple materials with comma
 */
export function getNormalizedMaterialMeta(materialString: string): string {
  const normalized = parseMaterials(materialString);
  return normalized.join(', ');
}

/**
 * Get the normalized color string for storage in meta
 */
export function getNormalizedColorMeta(colorString: string): string {
  const normalized = parseColors(colorString);
  return normalized.join(', ');
}
