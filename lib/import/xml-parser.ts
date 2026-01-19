import { readFileSync } from 'fs';
import { parseString } from 'xml2js';
import { promisify } from 'util';

const parseXML = promisify(parseString);

export interface XMLProduct {
  sku: string;
  name: string;
  description: string;
  price: string;
  stock_quantity: string;
  active: string;
  on_sale: string;
  discountable: string;

  // Physical attributes
  height: string;
  length: string;
  diameter: string; // Maps to width
  weight: string;

  // Product attributes
  color: string;
  material: string;
  barcode: string; // UPC - will be used as SKU
  release_date: string;

  // Images
  images: string[];

  // Taxonomy
  categories: Array<{
    code: string;
    name: string;
    parent: string;
    video: string;
  }>;
  manufacturer: {
    code: string;
    name: string;
    video: string;
  };
  type: {
    code: string;
    name: string;
    video: string;
  };
}

export interface VariationGroup {
  baseName: string;
  manufacturerCode: string;
  typeCode: string;
  products: XMLProduct[];
  variationAttribute: 'color' | 'flavor' | 'size' | 'style' | null;
}

/**
 * Parse XML products file
 */
export class XMLParser {
  private xmlPath: string;

  constructor(xmlPath: string) {
    this.xmlPath = xmlPath;
  }

  /**
   * Parse XML file and extract products
   */
  async parseProducts(): Promise<XMLProduct[]> {
    const xmlContent = readFileSync(this.xmlPath, 'utf-8');
    const result = await parseXML(xmlContent);

    const products: XMLProduct[] = [];

    if (!result.products || !result.products.product) {
      throw new Error('Invalid XML structure: missing products.product');
    }

    const rawProducts = Array.isArray(result.products.product)
      ? result.products.product
      : [result.products.product];

    for (const raw of rawProducts) {
      try {
        // Extract images
        const images: string[] = [];
        if (raw.images?.[0]?.image) {
          const imageArray = Array.isArray(raw.images[0].image)
            ? raw.images[0].image
            : [raw.images[0].image];
          images.push(...imageArray);
        }

        // Extract categories
        const categories: XMLProduct['categories'] = [];
        if (raw.categories?.[0]?.category) {
          const categoryArray = Array.isArray(raw.categories[0].category)
            ? raw.categories[0].category
            : [raw.categories[0].category];

          for (const cat of categoryArray) {
            const catText = typeof cat === 'string' ? cat : cat._;
            const catAttrs = typeof cat === 'object' ? cat.$ : {};

            categories.push({
              code: catAttrs?.code || '',
              name: catText || '',
              parent: catAttrs?.parent || '0',
              video: catAttrs?.video || '0',
            });
          }
        }

        // Extract manufacturer
        const manufacturerRaw = raw.manufacturer?.[0];
        const manufacturer = {
          code: manufacturerRaw?.$?.code || '',
          name: typeof manufacturerRaw === 'string' ? manufacturerRaw : (manufacturerRaw?._ || ''),
          video: manufacturerRaw?.$?.video || '0',
        };

        // Extract type
        const typeRaw = raw.type?.[0];
        const type = {
          code: typeRaw?.$?.code || '',
          name: typeof typeRaw === 'string' ? typeRaw : (typeRaw?._ || ''),
          video: typeRaw?.$?.video || '0',
        };

        const product: XMLProduct = {
          sku: raw.sku?.[0] || '',
          name: raw.name?.[0] || '',
          description: raw.description?.[0] || '',
          price: raw.price?.[0] || '0',
          stock_quantity: raw.stock_quantity?.[0] || '0',
          active: raw.$?.active || '1',
          on_sale: raw.$?.on_sale || '0',
          discountable: raw.$?.discountable || '1',
          height: raw.height?.[0] || '0',
          length: raw.length?.[0] || '0',
          diameter: raw.diameter?.[0] || '0',
          weight: raw.weight?.[0] || '0',
          color: raw.color?.[0] || '',
          material: raw.material?.[0] || '',
          barcode: raw.barcode?.[0] || '',
          release_date: raw.release_date?.[0] || '',
          images,
          categories,
          manufacturer,
          type,
        };

        products.push(product);
      } catch (error) {
        console.warn(`Failed to parse product: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return products;
  }

  /**
   * Check if a product is a bulk/display product that shouldn't be grouped as a variation
   */
  private isBulkDisplayProduct(name: string): boolean {
    // Note: We want to be very conservative here - only skip products that are truly
    // generic display items with no variant (like "COUNTER DISPLAY" alone).
    // Products like "COOCHY SHAVE CREAM FROSTED CAKE FOIL 15 ML 24PC DISPLAY" should
    // NOT be skipped because they have a scent variant (FROSTED CAKE) that can be grouped.
    // Similarly, "BOOTY CALL FISHBOWL 65 PILLOW PACKS CHERRY" has a flavor variant.

    // Only skip if it's JUST a display/counter item with no other distinguishing features
    const bulkIndicators = [
      /^COUNTER\s*DISPLAY$/i,
      /^SAMPLE\s*PACKET$/i,
      /^DISPLAY\s*STAND$/i,
    ];

    return bulkIndicators.some(pattern => pattern.test(name.trim()));
  }

  /**
   * Detect potential variations by analyzing product names, prices, and attributes
   * Uses a two-pass approach:
   * 1. First pass: detect size variations (products with same base name, different sizes)
   * 2. Second pass: for products without size variations, group by type/style (COOL, HOT, etc.)
   */
  detectVariations(products: XMLProduct[]): VariationGroup[] {
    const groups = new Map<string, VariationGroup>();

    for (const product of products) {
      // Skip bulk/display products - these are not variations
      if (this.isBulkDisplayProduct(product.name)) {
        continue;
      }

      // Extract base name (remove size, flavor, color indicators)
      const baseName = this.extractBaseName(product.name);
      // Include price in the key - products with same base name AND same price are likely variations
      const priceKey = parseFloat(product.price).toFixed(2);
      const key = `${baseName}|${product.manufacturer.code}|${product.type.code}|${priceKey}`;

      if (!groups.has(key)) {
        groups.set(key, {
          baseName,
          manufacturerCode: product.manufacturer.code,
          typeCode: product.type.code,
          products: [],
          variationAttribute: null,
        });
      }

      groups.get(key)!.products.push(product);
    }

    // Now merge groups that have similar base names but different prices
    // This handles size variations where larger sizes cost more
    const mergedGroups = this.mergeRelatedGroups(Array.from(groups.values()));

    // FIRST PASS: Filter groups to only include those with 2+ products (size/color variations)
    const variationGroups: VariationGroup[] = [];
    const singleProductGroups: VariationGroup[] = [];

    for (const group of mergedGroups) {
      if (group.products.length > 1) {
        // Determine variation attribute
        group.variationAttribute = this.determineVariationAttribute(group.products);
        variationGroups.push(group);
      } else {
        // Single product - may be grouped by type/style in second pass
        singleProductGroups.push(group);
      }
    }

    // SECOND PASS: Try to group single products by type/style variations
    // Products like "ELBOW GREASE COOL CREAM" and "ELBOW GREASE HOT CREAM"
    // (each with only 1 product, no size variations) should be grouped as style variations
    const typeStyleGroups = this.groupByTypeStyle(singleProductGroups);
    variationGroups.push(...typeStyleGroups);

    // Collect products not used in type/style grouping
    const usedSkusInTypeStyle = new Set(typeStyleGroups.flatMap(g => g.products.map(p => p.sku)));
    const remainingSingleGroups = singleProductGroups.filter(g =>
      !usedSkusInTypeStyle.has(g.products[0]?.sku)
    );

    // THIRD PASS: Group products by model name variations
    // Products like "Tenga Spinner Tetra", "Tenga Spinner Hexa", etc.
    // Same manufacturer, same price, same base product line - different model names
    const modelVariationGroups = this.groupByModelName(remainingSingleGroups);
    variationGroups.push(...modelVariationGroups);

    // Collect products not used in model name grouping
    const usedSkusInModelName = new Set(modelVariationGroups.flatMap(g => g.products.map(p => p.sku)));
    const remainingAfterModelName = remainingSingleGroups.filter(g =>
      !usedSkusInModelName.has(g.products[0]?.sku)
    );

    // FOURTH PASS: Merge size variations across different prices
    // Products like "Tom of Finland Anal Plug Medium" ($59.64) and "Extra Large" ($107.28)
    const usedInSizeMerge = new Set<number>();
    const sizeVariationGroups = this.mergeSizeVariationsAcrossPrices(remainingAfterModelName, usedInSizeMerge);
    variationGroups.push(...sizeVariationGroups);

    // FIFTH PASS: Merge product line variations (like Zodiac signs)
    // These have unique pattern words that define the product variant
    const mergedVariationGroups = this.mergeProductLineVariations(variationGroups);

    return mergedVariationGroups;
  }

  /**
   * Merge variation groups that belong to the same product line
   * For example, "Zodiac Aries Mini Vibe Pink" and "Zodiac Taurus Mini Vibe Orange"
   * might be in different color groups, but should all be merged into one Zodiac Mini Vibe product
   */
  private mergeProductLineVariations(existingGroups: VariationGroup[]): VariationGroup[] {
    const result: VariationGroup[] = [];
    const groupsToRemove = new Set<number>();

    // Product line patterns to look for
    // These are patterns where multiple groups should be merged
    const productLinePatterns = [
      // Zodiac Mini Vibe - grouped by color (duplicate colors are OK, images differentiate)
      {
        pattern: /\bZODIAC\b/i,
        baseNamePattern: /ZODIAC\s+\w+\s+MINI\s+VIBE/i,
        targetBaseName: 'Zodiac Mini Vibe',
        variationAttribute: 'color' as const,
      },
      // Lord of the Cock Rings - character names as variants
      {
        pattern: /\bLORD\s+OF\s+THE\s+COCK\s+RINGS?\b/i,
        baseNamePattern: /LORD\s+OF\s+THE\s+COCK\s+RINGS?\s+\w+/i,
        targetBaseName: 'Lord of the Cock Rings',
      },
      // Orange Is the New Black product line
      {
        pattern: /\bORANGE\s+IS\s+THE\s+NEW\s+BLACK\b/i,
        baseNamePattern: /ORANGE\s+IS\s+THE\s+NEW\s+BLACK\s+\w+/i,
        targetBaseName: 'Orange Is the New Black',
      },
      // Nipple Nibblers Sour Pleasure Balm - flavor variants
      {
        pattern: /\bNIPPLE\s+NIBBLERS\s+SOUR\s+PLEASURE\s+BALM\b/i,
        baseNamePattern: /NIPPLE\s+NIBBLERS\s+SOUR\s+PLEASURE\s+BALM\s+[\w\s']+\s+3G/i,
        targetBaseName: 'Nipple Nibblers Sour Pleasure Balm 3g',
      },
      // Nipple Nibblers Cool Tingle Balm - flavor variants
      {
        pattern: /\bNIPPLE\s+NIBBLERS\s+COOL\s+TINGLE\s+BALM\b/i,
        baseNamePattern: /NIPPLE\s+NIBBLERS\s+COOL\s+TINGLE\s+BALM\s+[\w\s]+\s+3G/i,
        targetBaseName: 'Nipple Nibblers Cool Tingle Balm 3g',
      },
      // Hemp Seed 3-in-1 Massage Candle - scent variants
      {
        pattern: /\bHEMP\s+SEED\s+3-IN-1\b/i,
        baseNamePattern: /HEMP\s+SEED\s+3-IN-1\s+(MASSAGE\s+)?CANDL?E?\s+[\w\s]+\s+6OZ/i,
        targetBaseName: 'Hemp Seed 3-in-1 Massage Candle 6oz',
      },
      // Addiction Cocktails Silicone Dong - cocktail name variants
      {
        pattern: /\bADDICTION\s+COCKTAILS\b/i,
        baseNamePattern: /ADDICTION\s+COCKTAILS\s+[\d.]+\s+SILICONE\s+DONG\s+[\w\s]+/i,
        targetBaseName: 'Addiction Cocktails 5.5 Silicone Dong',
      },
      // Goodhead Juicy Head Cocktails Spray - cocktail name variants
      {
        pattern: /\bGOODHEAD\s+JUICY\s+HEAD\s+COCKTAILS\b/i,
        baseNamePattern: /GOODHEAD\s+JUICY\s+HEAD\s+COCKTAILS\s+SPRAY\s+[\w\s&]+\s+2OZ/i,
        targetBaseName: 'Goodhead Juicy Head Cocktails Spray 2oz',
      },
      // Coochy Shave Cream Foil Display - scent variants
      {
        pattern: /\bCOOCHY\s+SHAVE\s+CREAM\b/i,
        baseNamePattern: /COOCHY\s+SHAVE\s+CREAM\s+[\w\s]+\s+FOIL\s+15\s*ML\s+24PC\s+DISPLAY/i,
        targetBaseName: 'Coochy Shave Cream Foil 15ml 24pc Display',
      },
      // Booty Call Fishbowl Pillow Packs - flavor variants
      {
        pattern: /\bBOOTY\s+CALL\s+FISHBOWL\b/i,
        baseNamePattern: /BOOTY\s+CALL\s+FISHBOWL\s+65\s+PILLOW\s+PACKS\s+\w+/i,
        targetBaseName: 'Booty Call Fishbowl 65 Pillow Packs',
      },
      // The 9's Booty Call Silicone Butt Plug - color/phrase variants
      {
        pattern: /\bTHE\s+9'?S\s+BOOTY\s+CALL\b/i,
        baseNamePattern: /THE\s+9'?S\s+BOOTY\s+CALL\s+(SILICONE\s+)?BUTT\s+PLUG\s+\w+/i,
        targetBaseName: "The 9's Booty Call Silicone Butt Plug",
      },
    ];

    for (const linePattern of productLinePatterns) {
      // Find all groups that match this product line
      const matchingIndices: number[] = [];

      for (let i = 0; i < existingGroups.length; i++) {
        if (groupsToRemove.has(i)) continue;

        const group = existingGroups[i];
        // Check if any product in this group matches the pattern
        const hasMatch = group.products.some(p =>
          linePattern.baseNamePattern.test(p.name.toUpperCase())
        );

        if (hasMatch) {
          matchingIndices.push(i);
        }
      }

      // If we found multiple groups that match, merge them
      if (matchingIndices.length >= 2) {
        // Merge all products from matching groups
        const mergedProducts: XMLProduct[] = [];
        let manufacturerCode = '';
        let typeCode = '';

        for (const idx of matchingIndices) {
          const group = existingGroups[idx];
          mergedProducts.push(...group.products);
          manufacturerCode = manufacturerCode || group.manufacturerCode;
          typeCode = typeCode || group.typeCode;
          groupsToRemove.add(idx);
        }

        result.push({
          baseName: linePattern.targetBaseName,
          manufacturerCode,
          typeCode,
          products: mergedProducts,
          variationAttribute: (linePattern as any).variationAttribute || 'style',
        });
      }
    }

    // Return groups that weren't merged, plus the new merged groups
    for (let i = 0; i < existingGroups.length; i++) {
      if (!groupsToRemove.has(i)) {
        result.push(existingGroups[i]);
      }
    }

    return result;
  }

  /**
   * Group single products by type/style variations
   * This handles cases where products differ only by type word (COOL, HOT, ORIGINAL, etc.)
   */
  private groupByTypeStyle(singleProductGroups: VariationGroup[]): VariationGroup[] {
    const result: VariationGroup[] = [];
    const used = new Set<number>();

    // Type/style words that can differentiate product variations
    const typeStyleWords = [
      'COOL', 'HOT', 'WARM', 'COLD', 'ICE', 'FIRE', 'HEAT',
      'ORIGINAL', 'CLASSIC', 'LIGHT', 'LITE', 'REGULAR',
      'WARMING', 'COOLING', 'TINGLING',
      'NATURAL', 'ORGANIC', 'PURE',
      'WATER', 'SILICONE', 'HYBRID', 'OIL',
      'GEL', 'LIQUID', 'CREAM', 'LOTION',
    ];

    for (let i = 0; i < singleProductGroups.length; i++) {
      if (used.has(i)) continue;

      const group = singleProductGroups[i];
      const baseNameUpper = group.baseName.toUpperCase();

      // Check if this base name contains a type/style word
      const typeWord = typeStyleWords.find(tw => baseNameUpper.includes(` ${tw}`) || baseNameUpper.endsWith(` ${tw}`));
      if (!typeWord) continue;

      // Extract the "core" base name by removing the type word
      const coreBaseName = baseNameUpper.replace(new RegExp(`\\s+${typeWord}\\b`, 'gi'), '').trim();
      if (!coreBaseName || coreBaseName === baseNameUpper) continue;

      // Find other groups with the same core base name but different type words
      const matchingGroups: VariationGroup[] = [group];
      used.add(i);

      for (let j = i + 1; j < singleProductGroups.length; j++) {
        if (used.has(j)) continue;

        const other = singleProductGroups[j];

        // Must be same manufacturer and product type
        if (other.manufacturerCode !== group.manufacturerCode || other.typeCode !== group.typeCode) {
          continue;
        }

        const otherBaseNameUpper = other.baseName.toUpperCase();
        const otherTypeWord = typeStyleWords.find(tw => otherBaseNameUpper.includes(` ${tw}`) || otherBaseNameUpper.endsWith(` ${tw}`));
        if (!otherTypeWord) continue;

        const otherCoreBaseName = otherBaseNameUpper.replace(new RegExp(`\\s+${otherTypeWord}\\b`, 'gi'), '').trim();

        // Check if core base names match
        if (otherCoreBaseName === coreBaseName) {
          matchingGroups.push(other);
          used.add(j);
        }
      }

      // Only create a variation group if we found 2+ matching products
      if (matchingGroups.length >= 2) {
        const mergedProducts = matchingGroups.flatMap(g => g.products);
        result.push({
          baseName: coreBaseName.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
          manufacturerCode: group.manufacturerCode,
          typeCode: group.typeCode,
          products: mergedProducts,
          variationAttribute: 'style',
        });
      }
    }

    return result;
  }

  /**
   * Group products by model name variations
   * This handles product lines like "Tenga Spinner Tetra", "Tenga Spinner Hexa", etc.
   * where the last word is a model name and products share the same price
   *
   * Also handles:
   * - "Goodhead 4 Oz Mint", "Goodhead 4 Oz Cherry" -> grouped by flavor at end
   * - "Zodiac Aries Mini Vibe Pink", "Zodiac Taurus Mini Vibe Orange" -> grouped by pattern with variant words
   * - "Tom of Finland Anal Plug Medium", "Tom of Finland Anal Plug Extra Large" -> grouped by size in name
   */
  private groupByModelName(singleProductGroups: VariationGroup[]): VariationGroup[] {
    const result: VariationGroup[] = [];
    const used = new Set<number>();

    // Group candidates by manufacturer + price
    const candidatesByMfgPrice = new Map<string, number[]>();

    for (let i = 0; i < singleProductGroups.length; i++) {
      const group = singleProductGroups[i];
      const product = group.products[0];
      if (!product) continue;

      // Key by manufacturer code and price (rounded to 2 decimals)
      const priceKey = parseFloat(product.price).toFixed(2);
      const key = `${group.manufacturerCode}|${priceKey}`;

      if (!candidatesByMfgPrice.has(key)) {
        candidatesByMfgPrice.set(key, []);
      }
      candidatesByMfgPrice.get(key)!.push(i);
    }

    // For each group of same-price products from same manufacturer,
    // try to find model name patterns
    for (const [, indices] of candidatesByMfgPrice.entries()) {
      if (indices.length < 2) continue;

      // Try multiple pattern extraction strategies
      const groupedByStrategy = this.tryMultiplePatternStrategies(singleProductGroups, indices, used);
      result.push(...groupedByStrategy);
    }

    return result;
  }

  /**
   * Try multiple strategies to find variation patterns
   */
  private tryMultiplePatternStrategies(
    singleProductGroups: VariationGroup[],
    indices: number[],
    used: Set<number>
  ): VariationGroup[] {
    const result: VariationGroup[] = [];

    // Strategy 1: Remove last word as variant (original strategy)
    const strategy1Results = this.groupByLastWordPattern(singleProductGroups, indices, used);
    result.push(...strategy1Results);

    // Strategy 2: Remove last TWO words as variant (handles "Extra Large", "Light Blue", etc.)
    const strategy2Results = this.groupByLastTwoWordsPattern(singleProductGroups, indices, used);
    result.push(...strategy2Results);

    // Strategy 3: Find common prefix pattern (handles Zodiac signs, flavor names anywhere)
    const strategy3Results = this.groupByCommonPrefixPattern(singleProductGroups, indices, used);
    result.push(...strategy3Results);

    // Strategy 4: Find products with same words but different order/variant words in middle
    const strategy4Results = this.groupByKeywordPattern(singleProductGroups, indices, used);
    result.push(...strategy4Results);

    // Strategy 5: Find numbered series (handles #1, #2, #3, etc.)
    const strategy5Results = this.groupByNumberedSeriesPattern(singleProductGroups, indices, used);
    result.push(...strategy5Results);

    return result;
  }

  /**
   * Strategy 5: Group by numbered series pattern
   * Handles: "Dr Skin Cock Vibe #1", "Dr Skin Cock Vibe #3", etc.
   * Also handles: "B Yours Cockvibe #1", "Xact Fit Silicone Rings #14 #15 #16"
   */
  private groupByNumberedSeriesPattern(
    singleProductGroups: VariationGroup[],
    indices: number[],
    used: Set<number>
  ): VariationGroup[] {
    const result: VariationGroup[] = [];

    // Extract product names and their base patterns (removing #N patterns)
    const patterns = indices.map(i => {
      if (used.has(i)) return null;
      const group = singleProductGroups[i];
      const name = group.products[0]?.name.toUpperCase().trim() || '';

      // Check if this product has a numbered pattern
      const hasNumber = /#\d+/.test(name);
      if (!hasNumber) return null;

      // Remove the numbered parts to get base pattern
      // Handles both single (#1) and multiple (#14 #15 #16) number patterns
      const basePattern = name
        .replace(/#\d+/g, '') // Remove #N patterns
        .replace(/\s+/g, ' ') // Clean up multiple spaces
        .trim();

      // Extract the series numbers for grouping verification
      const seriesNumbers = name.match(/#(\d+)/g)?.map(m => m) || [];

      return { index: i, basePattern, seriesNumbers, fullName: name };
    }).filter(p => p !== null) as Array<{ index: number; basePattern: string; seriesNumbers: string[]; fullName: string }>;

    // Group by base pattern
    const byPattern = new Map<string, typeof patterns>();
    for (const p of patterns) {
      if (!byPattern.has(p.basePattern)) {
        byPattern.set(p.basePattern, []);
      }
      byPattern.get(p.basePattern)!.push(p);
    }

    // Create variation groups for patterns with 2+ products
    for (const [basePattern, matches] of byPattern.entries()) {
      if (matches.length < 2) continue;

      // Check that none of these products are already used
      if (matches.some(m => used.has(m.index))) continue;

      // Mark as used
      matches.forEach(m => used.add(m.index));

      // Get all products
      const products = matches.flatMap(m => singleProductGroups[m.index].products);
      const firstGroup = singleProductGroups[matches[0].index];

      result.push({
        baseName: basePattern.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
        manufacturerCode: firstGroup.manufacturerCode,
        typeCode: firstGroup.typeCode,
        products,
        variationAttribute: 'style', // Use style for numbered series
      });
    }

    return result;
  }

  /**
   * Strategy 1: Group by removing last word as variant
   */
  private groupByLastWordPattern(
    singleProductGroups: VariationGroup[],
    indices: number[],
    used: Set<number>
  ): VariationGroup[] {
    const result: VariationGroup[] = [];

    // Extract product names and their base patterns (all words except last)
    const patterns = indices.map(i => {
      if (used.has(i)) return null;
      const group = singleProductGroups[i];
      const name = group.products[0]?.name.toUpperCase().trim() || '';
      // Remove common suffixes like "(NET)" and trailing quote marks before splitting
      const cleanName = name
        .replace(/\s*\(NET\)\s*$/i, '')
        .replace(/\s*["″"]\s*$/g, '')
        .trim();
      const words = cleanName.split(/\s+/);

      // Need at least 2 words to have a pattern + model name
      if (words.length < 2) return null;

      const modelName = words[words.length - 1];
      const basePattern = words.slice(0, -1).join(' ');

      return { index: i, basePattern, modelName, fullName: cleanName };
    }).filter(p => p !== null) as Array<{ index: number; basePattern: string; modelName: string; fullName: string }>;

    // Group by base pattern
    const byPattern = new Map<string, typeof patterns>();
    for (const p of patterns) {
      if (!byPattern.has(p.basePattern)) {
        byPattern.set(p.basePattern, []);
      }
      byPattern.get(p.basePattern)!.push(p);
    }

    // Create variation groups for patterns with 2+ products
    for (const [basePattern, matches] of byPattern.entries()) {
      if (matches.length < 2) continue;

      // Check that none of these products are already used
      if (matches.some(m => used.has(m.index))) continue;

      // Mark as used
      matches.forEach(m => used.add(m.index));

      // Get all products
      const products = matches.flatMap(m => singleProductGroups[m.index].products);
      const firstGroup = singleProductGroups[matches[0].index];

      result.push({
        baseName: basePattern.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
        manufacturerCode: firstGroup.manufacturerCode,
        typeCode: firstGroup.typeCode,
        products,
        variationAttribute: this.determineVariationAttribute(products),
      });
    }

    return result;
  }

  /**
   * Strategy 2: Group by removing last TWO words as variant
   * Handles: "Tom of Finland Anal Plug Medium Silicone" vs "Tom of Finland Anal Plug Extra Large Silicone"
   */
  private groupByLastTwoWordsPattern(
    singleProductGroups: VariationGroup[],
    indices: number[],
    used: Set<number>
  ): VariationGroup[] {
    const result: VariationGroup[] = [];

    const patterns = indices.map(i => {
      if (used.has(i)) return null;
      const group = singleProductGroups[i];
      const name = group.products[0]?.name.toUpperCase().trim() || '';
      const cleanName = name
        .replace(/\s*\(NET\)\s*$/i, '')
        .replace(/\s*["″"]\s*$/g, '')
        .trim();
      const words = cleanName.split(/\s+/);

      // Need at least 3 words for this pattern
      if (words.length < 3) return null;

      const variantWords = words.slice(-2).join(' ');
      const basePattern = words.slice(0, -2).join(' ');

      return { index: i, basePattern, variantWords, fullName: cleanName };
    }).filter(p => p !== null) as Array<{ index: number; basePattern: string; variantWords: string; fullName: string }>;

    // Group by base pattern
    const byPattern = new Map<string, typeof patterns>();
    for (const p of patterns) {
      if (!byPattern.has(p.basePattern)) {
        byPattern.set(p.basePattern, []);
      }
      byPattern.get(p.basePattern)!.push(p);
    }

    for (const [basePattern, matches] of byPattern.entries()) {
      if (matches.length < 2) continue;
      if (matches.some(m => used.has(m.index))) continue;

      matches.forEach(m => used.add(m.index));

      const products = matches.flatMap(m => singleProductGroups[m.index].products);
      const firstGroup = singleProductGroups[matches[0].index];

      result.push({
        baseName: basePattern.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
        manufacturerCode: firstGroup.manufacturerCode,
        typeCode: firstGroup.typeCode,
        products,
        variationAttribute: this.determineVariationAttribute(products),
      });
    }

    return result;
  }

  /**
   * Strategy 3: Find common prefix pattern
   * Handles: "Zodiac Aries Mini Vibe Pink" vs "Zodiac Taurus Mini Vibe Orange"
   * The common part is "Zodiac ... Mini Vibe ..."
   */
  private groupByCommonPrefixPattern(
    singleProductGroups: VariationGroup[],
    indices: number[],
    used: Set<number>
  ): VariationGroup[] {
    const result: VariationGroup[] = [];

    // Get all product names
    const products = indices
      .filter(i => !used.has(i))
      .map(i => ({
        index: i,
        name: singleProductGroups[i].products[0]?.name.toUpperCase().trim() || '',
        words: (singleProductGroups[i].products[0]?.name.toUpperCase().trim() || '').split(/\s+/),
      }));

    if (products.length < 2) return result;

    // Find products that share the same first word and last word(s)
    const byFirstAndLastWord = new Map<string, typeof products>();
    for (const p of products) {
      if (p.words.length < 3) continue;

      // Key: first word + last word (handles "Zodiac X Mini Vibe Y" pattern)
      const key = `${p.words[0]}|${p.words[p.words.length - 2]}|${p.words[p.words.length - 1]}`;

      if (!byFirstAndLastWord.has(key)) {
        byFirstAndLastWord.set(key, []);
      }
      byFirstAndLastWord.get(key)!.push(p);
    }

    for (const [, matches] of byFirstAndLastWord.entries()) {
      if (matches.length < 2) continue;
      if (matches.some(m => used.has(m.index))) continue;

      // Find common words (first N words that match across all products)
      const commonPrefix = this.findCommonPrefix(matches.map(m => m.words));
      if (commonPrefix.length < 1) continue;

      matches.forEach(m => used.add(m.index));

      const groupProducts = matches.flatMap(m => singleProductGroups[m.index].products);
      const firstGroup = singleProductGroups[matches[0].index];

      result.push({
        baseName: commonPrefix.map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
        manufacturerCode: firstGroup.manufacturerCode,
        typeCode: firstGroup.typeCode,
        products: groupProducts,
        variationAttribute: this.determineVariationAttribute(groupProducts),
      });
    }

    return result;
  }

  /**
   * Strategy 4: Group by keyword pattern
   * Finds products with key identifying words in common
   * Handles: "Goodhead 4 Oz Mint Bx", "Goodhead 4 Oz Cherry Bx"
   */
  private groupByKeywordPattern(
    singleProductGroups: VariationGroup[],
    indices: number[],
    used: Set<number>
  ): VariationGroup[] {
    const result: VariationGroup[] = [];

    // Variant words to ignore when building the key
    const variantWords = new Set([
      // Basic flavors
      'MINT', 'CHERRY', 'STRAWBERRY', 'VANILLA', 'CHOCOLATE', 'MANGO', 'GRAPE',
      'LEMON', 'LIME', 'BANANA', 'RASPBERRY', 'BLUEBERRY', 'PEACH', 'APPLE',
      'WATERMELON', 'COCONUT', 'LAVENDER', 'PEPPERMINT', 'SPEARMINT', 'CINNAMON',
      'HONEY', 'GINGER', 'CARAMEL', 'MOCHA', 'COFFEE', 'MELON', 'BERRY',
      'TROPICAL', 'CITRUS', 'FLORAL', 'EUCALYPTUS', 'JASMINE',
      // Multi-word flavor components (second word)
      'COLADA', 'MADNESS', 'SENSATION', 'RAVE', 'BLAST', 'PIZAZZ', 'PUCKER',
      'TWIST', 'DROP', 'MOJITO', 'MARTINI', 'BELLINI', 'COSMO', 'CHAMPAGNE',
      // Scent names (for candles)
      'DREAMSICLE', 'GUAVALAVA', 'SUNSATIONAL', 'MISCHIEF', 'TEASE', 'BEGGING',
      'STOCKING', 'MUSK', 'ROSE', 'KASHMIR', 'ZEN', 'PARADISE', 'HAZE', 'NECTAR',
      'CAKE', 'KEEN', 'SQUEEZED', 'FLING',
      // Cocktail names
      'LAGOON', 'SANGRIA',
      'BX', // Box suffix (like "Goodhead 4 Oz Mint Bx")
      // Colors
      'RED', 'BLUE', 'GREEN', 'PINK', 'PURPLE', 'BLACK', 'WHITE', 'CLEAR',
      'SILVER', 'GOLD', 'ORANGE', 'YELLOW', 'TEAL', 'NAVY', 'NUDE', 'TAN',
      'BEIGE', 'IVORY', 'CREAM', 'BROWN', 'GRAY', 'GREY', 'BRONZE', 'COPPER',
      'LIGHT', 'DARK', 'MIDNIGHT', 'PEARL', 'MATTE', 'NATURAL',
      // Sizes
      'SMALL', 'MEDIUM', 'LARGE', 'MINI', 'EXTRA', 'XL', 'XXL', 'XXXL',
      'PETITE', 'REGULAR', 'JUMBO', 'GIANT', 'KING', 'QUEEN',
      'SM', 'MED', 'LG', 'XS', '2XL', '3XL', '4XL',
      // Zodiac signs
      'ARIES', 'TAURUS', 'GEMINI', 'CANCER', 'LEO', 'VIRGO',
      'LIBRA', 'SCORPIO', 'SAGITTARIUS', 'CAPRICORN', 'AQUARIUS', 'PISCES',
      // LOTR character names (for Lord of the Cock Rings)
      'BILBO', 'FRODO', 'GANDALF', 'LURTZ', 'ELENDIL', 'ELROND', 'SMAUG', 'SAURON',
      'HOBBIT', 'FELLOWSHIP', 'TOWERS', 'RETURN',
      // Body parts / phrases on products
      'STOP', 'GIRL', 'HARD', 'YEAH', 'FUCK', 'BAD', 'HIT',
      // Unflavored indicator
      'UNFLAVORED', 'UNSCENTED', 'ORIGINAL',
      // Cooling/warming indicators (often variations)
      'COOLING', 'WARMING', 'COOL', 'WARM', 'HOT', 'COLD', 'ICE', 'FIRE',
    ]);

    const products = indices
      .filter(i => !used.has(i))
      .map(i => {
        const name = singleProductGroups[i].products[0]?.name.toUpperCase().trim() || '';
        const words = name.split(/\s+/);
        // Build key from non-variant words
        const keyWords = words.filter(w => !variantWords.has(w));
        return {
          index: i,
          name,
          keyWords,
          key: keyWords.join('|'),
        };
      });

    // Group by key
    const byKey = new Map<string, typeof products>();
    for (const p of products) {
      if (p.keyWords.length < 2) continue; // Need at least 2 key words
      if (!byKey.has(p.key)) {
        byKey.set(p.key, []);
      }
      byKey.get(p.key)!.push(p);
    }

    for (const [key, matches] of byKey.entries()) {
      if (matches.length < 2) continue;
      if (matches.some(m => used.has(m.index))) continue;

      matches.forEach(m => used.add(m.index));

      const groupProducts = matches.flatMap(m => singleProductGroups[m.index].products);
      const firstGroup = singleProductGroups[matches[0].index];

      // Use key words as base name
      const baseName = key.split('|').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');

      result.push({
        baseName,
        manufacturerCode: firstGroup.manufacturerCode,
        typeCode: firstGroup.typeCode,
        products: groupProducts,
        variationAttribute: this.determineVariationAttribute(groupProducts),
      });
    }

    return result;
  }

  /**
   * Find common prefix words across multiple word arrays
   */
  private findCommonPrefix(wordArrays: string[][]): string[] {
    if (wordArrays.length === 0) return [];
    if (wordArrays.length === 1) return wordArrays[0];

    const result: string[] = [];
    const first = wordArrays[0];

    for (let i = 0; i < first.length; i++) {
      const word = first[i];
      if (wordArrays.every(arr => arr[i] === word)) {
        result.push(word);
      } else {
        break;
      }
    }

    return result;
  }

  /**
   * Additional pass to merge size variations with different prices
   * Products like "Tom of Finland Anal Plug Medium" and "Tom of Finland Anal Plug Extra Large"
   * may have different prices but should still be grouped
   */
  private mergeSizeVariationsAcrossPrices(
    singleProductGroups: VariationGroup[],
    used: Set<number>
  ): VariationGroup[] {
    const result: VariationGroup[] = [];

    // Size words that indicate size variations
    const sizeIndicators = [
      'SMALL', 'MEDIUM', 'LARGE', 'MINI', 'EXTRA', 'XL', 'XXL', 'XXXL',
      'PETITE', 'REGULAR', 'JUMBO', 'GIANT', 'KING', 'QUEEN',
      'SM', 'MED', 'LG', 'XS', '2XL', '3XL', '4XL',
    ];

    // Group products by manufacturer and base name (with size words removed)
    const byBaseNameNoSize = new Map<string, number[]>();

    for (let i = 0; i < singleProductGroups.length; i++) {
      if (used.has(i)) continue;

      const group = singleProductGroups[i];
      const product = group.products[0];
      if (!product) continue;

      const name = product.name.toUpperCase().trim();
      const words = name.split(/\s+/);

      // Check if this product has a size indicator
      const hasSizeIndicator = words.some(w => sizeIndicators.includes(w));
      if (!hasSizeIndicator) continue;

      // Build base name without size words
      const baseWords = words.filter(w => !sizeIndicators.includes(w));
      const baseName = baseWords.join(' ');

      const key = `${group.manufacturerCode}|${baseName}`;

      if (!byBaseNameNoSize.has(key)) {
        byBaseNameNoSize.set(key, []);
      }
      byBaseNameNoSize.get(key)!.push(i);
    }

    // Create variation groups for products that match (same base name, different sizes)
    for (const [, indices] of byBaseNameNoSize.entries()) {
      if (indices.length < 2) continue;
      if (indices.some(i => used.has(i))) continue;

      // Verify these products have DIFFERENT sizes
      const sizes = indices.map(i => {
        const name = singleProductGroups[i].products[0]?.name.toUpperCase() || '';
        const words = name.split(/\s+/);
        return words.filter(w => sizeIndicators.includes(w)).join(' ');
      });

      const uniqueSizes = new Set(sizes);
      if (uniqueSizes.size < 2) continue; // All same size, not size variations

      // Mark as used
      indices.forEach(i => used.add(i));

      const products = indices.flatMap(i => singleProductGroups[i].products);
      const firstGroup = singleProductGroups[indices[0]];

      // Build base name from first product, removing size words
      const firstName = firstGroup.products[0]?.name || '';
      const baseNameWords = firstName.split(/\s+/).filter(w => !sizeIndicators.includes(w.toUpperCase()));
      const baseName = baseNameWords.join(' ');

      result.push({
        baseName: XMLParser.applyTitleCase(baseName),
        manufacturerCode: firstGroup.manufacturerCode,
        typeCode: firstGroup.typeCode,
        products,
        variationAttribute: 'size',
      });
    }

    return result;
  }

  /**
   * Merge groups that have similar base names (for size variations with different prices)
   */
  private mergeRelatedGroups(groups: VariationGroup[]): VariationGroup[] {
    const merged: VariationGroup[] = [];
    const used = new Set<number>();

    for (let i = 0; i < groups.length; i++) {
      if (used.has(i)) continue;

      const group = groups[i];
      const mergedGroup: VariationGroup = {
        ...group,
        products: [...group.products],
      };

      // Find other groups with similar base names from same manufacturer/type
      for (let j = i + 1; j < groups.length; j++) {
        if (used.has(j)) continue;

        const other = groups[j];

        // Must be same manufacturer and type
        if (other.manufacturerCode !== group.manufacturerCode || other.typeCode !== group.typeCode) {
          continue;
        }

        // Check if base names are similar enough to merge
        if (this.areSimilarBaseNames(group.baseName, other.baseName)) {
          // Merge the groups - use the shorter base name
          mergedGroup.baseName = group.baseName.length <= other.baseName.length ? group.baseName : other.baseName;
          mergedGroup.products.push(...other.products);
          used.add(j);
        }
      }

      merged.push(mergedGroup);
      used.add(i);
    }

    return merged;
  }

  /**
   * Check if two base names are similar enough to be variations
   * This should be conservative to avoid grouping different product models together
   */
  private areSimilarBaseNames(name1: string, name2: string): boolean {
    // Normalize names
    const n1 = name1.toUpperCase().trim();
    const n2 = name2.toUpperCase().trim();

    // Exact match
    if (n1 === n2) return true;

    // Also match if one is empty (common when base name extraction removes all variation parts)
    // This handles cases like product names that ARE the variation indicator
    if (!n1 || !n2) return false;

    // Don't merge if names differ significantly - model names like "SYN V", "TRIDENT", etc. are distinct products
    // Only consider them similar if one is a strict subset at word boundaries

    const words1 = n1.split(/\s+/);
    const words2 = n2.split(/\s+/);

    // If one name is a subset of the other (all words match), they could be variations
    // e.g., "Product X" and "Product X Large" could be variations
    const smaller = words1.length < words2.length ? words1 : words2;
    const larger = words1.length < words2.length ? words2 : words1;

    // Check if all words in smaller are contained in larger (in order)
    let matchCount = 0;
    let largerIdx = 0;

    for (const word of smaller) {
      while (largerIdx < larger.length) {
        if (larger[largerIdx] === word) {
          matchCount++;
          largerIdx++;
          break;
        }
        largerIdx++;
      }
    }

    // Only consider similar if all words from smaller match AND
    // the difference is just 1-2 words (variation indicator)
    if (matchCount === smaller.length && larger.length - smaller.length <= 2) {
      // But don't merge if the extra words look like model identifiers
      const modelIdentifiers = ['TRIDENT', 'SYN', 'CLASSIC', 'PRO', 'PLUS', 'ULTRA', 'MAX', 'MINI', 'V', 'V2', 'II', 'III'];
      const extraWords = larger.filter(w => !smaller.includes(w));

      // If extra words are model identifiers, these are different products, not variations
      const hasModelIdentifier = extraWords.some(w => modelIdentifiers.includes(w));
      if (hasModelIdentifier) {
        return false;
      }

      return true;
    }

    return false;
  }

  /**
   * Extract base name from product name
   * Remove size indicators, length/volume, flavor/color names
   * KEEP model names like Helix, Eupho, etc. as they identify different products
   */
  private extractBaseName(name: string): string {
    let baseName = name;

    // Clean up trailing quote marks (often used to indicate inches)
    baseName = baseName.replace(/\s*["″"]\s*$/g, '').trim();

    // Remove volume/size patterns with units (anywhere in string)
    // Matches: 2.5 oz, 2.5oz, 2.5 ounces, 8ml, 16 fl oz, 1 O, 4 O (missing z), .5 oz, etc.
    // Also handles ".5 oz" pattern (decimal without leading zero)
    // Also handles "100ML/ 3.4 OZ" patterns with / separator
    baseName = baseName.replace(/\s*\.?\d+(\.\d+)?\s*(FL\.?\s*)?(OZ|OUNCES?|ML|MILLILITERS?|L|LITERS?|G|GRAMS?|MG|LB|LBS|POUNDS?|O)\.?\s*(\/\s*\.?\d+(\.\d+)?\s*(FL\.?\s*)?(OZ|OUNCES?|ML|MILLILITERS?|L|LITERS?|G|GRAMS?|MG|LB|LBS|POUNDS?|O)\.?)?\b/gi, '');

    // Remove length/dimension patterns
    // Matches: 9 inches, 9in, 9", 5.5 inch, 10mm, 15cm, etc.
    baseName = baseName.replace(/\s*\d+(\.\d+)?\s*(INCHES?|IN|"|″|MM|MILLIMETERS?|CM|CENTIMETERS?|FT|FEET|FOOT)\b/gi, '');

    // Remove pack/count patterns: 12pk, 6 pack, 3ct, 10 count, 40pc bowl, etc.
    baseName = baseName.replace(/\s*\d+\s*(PK|PACK|PC|PCS|PIECES?|CT|COUNT)\s*(BOWL|BOX|BAG|DISPLAY|JAR)?\b/gi, '');

    // Remove standalone decimal numbers at end like "2.5" or "5."
    baseName = baseName.replace(/\s+\d+\.?\d*\s*$/gi, '');

    // Remove common flavor/scent/color indicators in brackets or parentheses
    baseName = baseName.replace(/\s*\[.*?\]/g, '');
    baseName = baseName.replace(/\s*\(net\)/gi, '');
    baseName = baseName.replace(/\s*\(.*?\)/g, '');

    // Remove size abbreviations: S, M, L, XL, XXL, S/M, L/XL, O/S, Queen, Q/S, OS Queen, etc.
    // Match anywhere (not just at end) since they may appear before style names
    // Be careful not to remove single letters that are part of words
    baseName = baseName.replace(/\s+(XS|XXL|XXXL|2XL|3XL|4XL|S\/M|M\/L|L\/XL|XL\/XXL|O\/S|OS|ONE\s*SIZE|QUEEN|Q\/S|OS\s*QUEEN)\b/gi, '');
    // Also handle single-letter sizes only at end of string to avoid false positives
    baseName = baseName.replace(/\s+[SML]\s*$/gi, '');

    // Remove multi-word variants that indicate variations (NOT model names)
    const multiWordVariants = [
      // Nipple Nibblers Sour flavors
      'GIDDY GRAPE', 'PEACH PIZAZZ', 'PINEAPPLE PUCKER', "ROCKIN' RASPBERRY", 'ROCKIN RASPBERRY',
      'SPUN SUGAR', 'WICKED WATERMELON', 'BERRY BLAST', 'WACKY WATERMELON', 'SASSY STRAWBERRY',
      // Nipple Nibblers Cool Tingle flavors
      'RASPBERRY RAVE', 'MELON MADNESS', 'STRAWBERRY SENSATION', 'STRAWBERRY TWIST', 'PINK LEMONADE',
      // Goodhead Juicy Head Cocktails
      'LEMON DROP', 'SEX ON THE BEACH', 'STRAWB & CHAMPAGNE', 'DRY MARTINI',
      // Addiction Cocktails colors
      'BLUE LAGOON', 'PURPLE HAZE', 'PEACH BELLINI', 'PURPLE COSMO', 'MINT MOJITO',
      // Coochy Shave Cream scents
      'FLORAL HAZE', 'FROSTED CAKE', 'ISLAND PARADISE', 'PEACHY KEEN', 'SWEET NECTAR',
      // Hemp Seed 3-in-1 scents
      'KASHMIR MUSK', 'ZEN BERRY ROSE', 'MISTLETOE MISCHIEF', 'TINSEL TEASE',
      'YULE BE BEGGING', 'OH OH OH', 'STUFF MY STOCKING', 'DREAMSICLE', 'GUAVALAVA',
      'HIGH TIDE', 'SKINNY DIP', 'SUNSATIONAL', 'SUMMER FLING', 'FRESH SQUEEZED',
      'BABY ITS COLD OUTSIDE',
      // Lord of the Cock Rings characters
      'FRODO SINGLE', 'GANDALF BLACK', 'ELENDIL 3 PACK', 'ELROND COCK GATE',
      // The 9's Booty Call phrases
      "DON'T STOP", 'DONT STOP', 'BAD GIRL', 'HIT IT HARD', 'FUCK YEAH',
      // Orange Is the New Black products
      'L CUFFS ANKLE', 'LOVE CUFFS WRIST', 'RIDING CROP & TICKLER', 'TIE ME UPS',
      // Standard flavors
      'PINA COLADA', 'MANGO PASSION', 'CHERRY LEMONADE', 'BUTTER RUM', 'BANANA CREAM',
      'KEY LIME', 'ORANGE CREAM', 'TAHITIAN VANILLA', 'NATURAL ALOE',
      'CREME BRULEE', 'MINT CHOCOLATE', 'COOKIES AND CREAM', 'STRAWBERRY BANANA',
      'PASSION FRUIT', 'BLUE RASPBERRY', 'GREEN APPLE', 'COTTON CANDY',
      'BUBBLE GUM', 'ROOT BEER', 'CHERRY VANILLA', 'CHOCOLATE MINT', 'FRENCH LAVENDER',
      'WARM VANILLA', 'COOL MINT', 'FRESH STRAWBERRY', 'WILD CHERRY',
      // Colors/Finishes
      'BLACK ICE', 'CLASSIC WHITE', 'PROSTATE MASSAGER WHITE', 'PROSTATE MASSAGER BLACK',
      'MIDNIGHT BLACK', 'PEARL WHITE', 'ROSE GOLD', 'MATTE BLACK',
      // Product types/styles that are variations
      'GP FREE', 'WATER LIQUID', 'WATER GEL', 'SILICONE GEL', 'GEL TUBE',
      'DOUBLE CLEAR', 'DOUBLE RUBBER', 'DOUBLE METAL',
      // Packaging/container types
      'FOIL PACKETS', 'FOIL PACK', 'TRAVEL SIZE', 'SAMPLE SIZE', 'SAMPLE PACK',
      // Booty Call Fishbowl variations - remove packs indicator so flavors can be detected
      '65 PILLOW PACKS',
      // Display product variations - remove display indicators so scent/flavor can be detected
      'FOIL 15 ML 24PC DISPLAY', 'FOIL 15ML 24PC DISPLAY', '15 ML 24PC DISPLAY', '15ML 24PC DISPLAY',
      '24PC DISPLAY', '24 PC DISPLAY', '24PCS DISPLAY', '24 PCS DISPLAY',
      '12PC DISPLAY', '12 PC DISPLAY', '48PC DISPLAY', '48 PC DISPLAY',
      // Sizes as words
      'EXTRA LARGE', 'EXTRA SMALL', 'EXTRA LONG', 'SUPER LARGE',
      'OS QUEEN', 'ONE SIZE',
    ];

    for (const variant of multiWordVariants) {
      const regex = new RegExp(`\\s+${variant}\\s*$`, 'i');
      baseName = baseName.replace(regex, '');
    }

    // Remove size words (Small/Medium/Large) when they appear BEFORE common product suffixes
    // This handles cases like "Booty Sparks Light Up Large Anal Plug" -> "Booty Sparks Light Up Anal Plug"
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

    // Remove color words when they appear BEFORE common product suffixes
    // This handles cases like "Dark Heart Chrome Heart Pink Choker" -> "Dark Heart Chrome Heart Choker"
    const colorWords = ['RED', 'BLUE', 'GREEN', 'PINK', 'PURPLE', 'BLACK', 'WHITE', 'CLEAR',
      'SILVER', 'GOLD', 'BRONZE', 'COPPER', 'GREY', 'GRAY', 'BROWN',
      'YELLOW', 'TEAL', 'NAVY', 'NUDE', 'TAN', 'BEIGE', 'IVORY'];
    for (const color of colorWords) {
      for (const suffix of productSuffixes) {
        const regex = new RegExp(`\\s+${color}\\s+${suffix}`, 'gi');
        baseName = baseName.replace(regex, ` ${suffix}`);
      }
    }

    // Remove single-word variants that indicate variations (colors, flavors, sizes, styles)
    // DO NOT remove model identifiers like HELIX, EUPHO, etc.
    // DO NOT remove style/type words (COOL, HOT, ORIGINAL, etc.) as they define product lines
    const singleWordVariants = [
      // Flavors/Scents - only remove when clearly just flavor modifiers
      'MANGO', 'CHERRY', 'STRAWBERRY', 'VANILLA', 'ALOE',
      'CHOCOLATE', 'MINT', 'GRAPE', 'LEMON', 'LIME', 'BANANA',
      'RASPBERRY', 'BLUEBERRY', 'PEACH', 'APPLE', 'WATERMELON', 'COCONUT',
      'LAVENDER', 'PEPPERMINT', 'SPEARMINT', 'EUCALYPTUS', 'JASMINE',
      'CINNAMON', 'GINGER', 'HONEY', 'CARAMEL', 'MOCHA', 'COFFEE',
      'MELON', 'BERRY', 'TROPICAL', 'CITRUS', 'FLORAL',
      'UNFLAVORED', 'UNSCENTED', 'COOLING', 'WARMING',
      // Lord of the Cock Rings character names (single words)
      'BILBO', 'FRODO', 'GANDALF', 'LURTZ', 'ELENDIL', 'ELROND', 'SMAUG', 'SAURON',
      // Colors (at end only)
      'RED', 'BLUE', 'GREEN', 'PINK', 'PURPLE', 'BLACK', 'WHITE', 'CLEAR',
      'SILVER', 'GOLD', 'BRONZE', 'COPPER', 'GREY', 'GRAY', 'BROWN',
      'YELLOW', 'TEAL', 'NAVY', 'NUDE', 'TAN', 'BEIGE', 'IVORY', 'ORANGE',
      // Sizes as words (at end only)
      'SMALL', 'MEDIUM', 'LARGE', 'XLARGE', 'SM', 'MED', 'LG',
      'MINI', 'PETITE', 'REGULAR', 'JUMBO', 'GIANT', 'KING',
      'QUEEN', // Plus size
      // Container/packaging types only (not product type)
      'TUBE', 'BOTTLE', 'PUMP', 'SACHET', 'SAMPLE',
      'JAR', 'BOWL', 'BOX', 'BAG', 'QUICKIE',
      // Size modifiers
      'JR', 'JUNIOR', 'SENIOR',
      // Material variants
      'RUBBER', 'METAL', 'GLASS', 'PLASTIC', 'LEATHER', 'LATEX', 'VINYL',
      'THIN', 'THICK',
    ];

    // Apply multiple times to strip multiple suffixes like "Trident Black Large" -> "Trident"
    for (let pass = 0; pass < 3; pass++) {
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
   * Determine what attribute varies between products
   */
  private determineVariationAttribute(products: XMLProduct[]): 'color' | 'flavor' | 'size' | 'style' | null {
    // Extract variation values from each product name
    const extractedValues = products.map(p => this.extractVariationValue(p.name));

    // Check if colors differ (from XML color field or extracted from name)
    const colors = new Set(products.map(p => p.color.toLowerCase()).filter(c => c));
    if (colors.size > 1) {
      return 'color';
    }

    // Check for color variations in names
    const extractedColors = extractedValues.map(v => v.color).filter(c => c);
    if (new Set(extractedColors).size > 1) {
      return 'color';
    }

    // Check for size variations (volume, length, or size words) - check before style/flavor
    // because size is the most common variation type
    const extractedSizes = extractedValues.map(v => v.size).filter(s => s);
    if (new Set(extractedSizes).size > 1) {
      return 'size';
    }

    // Check for style variations (warming, cooling, gel, liquid, etc.)
    const extractedStyles = extractedValues.map(v => v.style).filter(s => s);
    if (new Set(extractedStyles).size > 1) {
      return 'style';
    }

    // Check for flavor variations in names
    const extractedFlavors = extractedValues.map(v => v.flavor).filter(f => f);
    if (new Set(extractedFlavors).size > 1) {
      return 'flavor';
    }

    // Fallback: check if name lengths differ significantly (different suffixes)
    return null;
  }

  /**
   * Extract variation values from a product name
   * Returns detected size, color, flavor, or style from the name
   */
  private extractVariationValue(name: string): {
    size: string | null;
    color: string | null;
    flavor: string | null;
    style: string | null;
  } {
    const result = { size: null as string | null, color: null as string | null, flavor: null as string | null, style: null as string | null };
    const lowerName = name.toLowerCase();

    // Size patterns - volume
    // Handle formats like: 2.5 oz, 2.5oz, 5.OZ (note the dot before unit), 2.5 ounces, 1 O, 4 O
    const volumeMatch = name.match(/(\d+(?:\.\d+)?)\s*\.?\s*(fl\.?\s*)?(oz|ounces?|ml|milliliters?|l|liters?|g|grams?|mg|lb|lbs|pounds?|o)\b/i);
    if (volumeMatch) {
      result.size = volumeMatch[0].toLowerCase().replace(/\s+/g, '');
      // Normalize "1o" to "1 oz"
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

    // Size patterns - clothing combo sizes like S/M, L/XL, O/S, Queen, Q/S
    if (!result.size) {
      const comboSizeMatch = name.match(/\b(s\/m|m\/l|l\/xl|xl\/xxl|o\/s|one\s*size|queen|q\/s|os\s*queen)\b/i);
      if (comboSizeMatch) {
        result.size = comboSizeMatch[1].toUpperCase().replace(/\s+/g, '');
      }
    }

    // Size patterns - pack counts like 3pk, 12ct, 40pc bowl
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
      const sizeWordMatch = name.match(/\b(xs|x-?small|small|sm|s|medium|med|m|large|lg|l|x-?large|xl|xxl|xxxl|2xl|3xl|4xl|mini|petite|regular|plus|jumbo|giant|king)\b/i);
      if (sizeWordMatch) {
        result.size = this.normalizeSize(sizeWordMatch[1]);
      }
    }

    // Color patterns
    const colorWords = [
      'red', 'blue', 'green', 'pink', 'purple', 'black', 'white', 'clear',
      'silver', 'gold', 'bronze', 'copper', 'grey', 'gray', 'brown',
      'yellow', 'orange', 'teal', 'navy', 'nude', 'tan', 'beige', 'ivory',
      'midnight', 'pearl', 'matte', 'rose'
    ];
    for (const color of colorWords) {
      if (lowerName.includes(color)) {
        // Make sure it's a word boundary match
        const colorRegex = new RegExp(`\\b${color}\\b`, 'i');
        if (colorRegex.test(name)) {
          result.color = color;
          break;
        }
      }
    }

    // Flavor patterns - check multi-word flavors FIRST (longer matches take priority)
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

    // Only check single-word flavors if no multi-word flavor was found
    if (!result.flavor) {
      const singleWordFlavors = [
        'mango', 'cherry', 'strawberry', 'vanilla',
        'chocolate', 'mint', 'grape', 'lemon', 'lime', 'banana',
        'raspberry', 'blueberry', 'peach', 'apple', 'watermelon', 'coconut',
        'lavender', 'peppermint', 'spearmint', 'eucalyptus', 'jasmine',
        'cinnamon', 'ginger', 'honey', 'caramel', 'mocha', 'coffee',
        'melon', 'berry', 'tropical', 'citrus', 'floral', 'fresh',
        // 'natural' and 'aloe' removed as they're too generic when alone
      ];
      for (const flavor of singleWordFlavors) {
        if (lowerName.includes(flavor)) {
          result.flavor = flavor;
          break;
        }
      }
    }

    // Style patterns (warming, cooling, etc.) - for lubricants and similar products
    // Note: "silicone" only counts as a style when it refers to lube base type,
    // not when describing a toy's material (e.g., "silicone plug" vs "silicone lube")
    const styleWords = [
      'cooling', 'warming', 'tingling', 'sensitizing', 'desensitizing',
      'ice', 'fire', 'heat', 'cool', 'warm', 'hot', 'cold',
      'water', 'hybrid', 'oil', 'organic',
      'gel', 'liquid', 'cream', 'lotion', 'spray', 'foam',
      'quickie', 'jar', 'tube', 'bottle', 'pump' // Container/format styles
    ];

    // Check for multi-word styles first (higher priority)
    const multiStyleMatch = name.match(/\b(foil\s*packets?|travel\s*size|sample\s*pack)\b/i);
    if (multiStyleMatch) {
      result.style = multiStyleMatch[1].toLowerCase().replace(/\s+/g, ' ');
    }

    // Check single-word styles only if no multi-word style found
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

    // Special handling for "silicone" - only consider it a style (lube type) if
    // it's followed by lube-related words, not material descriptions
    if (!result.style && lowerName.includes('silicone')) {
      const siliconeAsLubePattern = /\bsilicone\s*(lube|lubricant|gel|based|liquid)\b/i;
      // Also match standalone "silicone" at end of name (like "ASTROGLIDE SILICONE 2.5 OZ")
      // but NOT when followed by toy words
      const siliconeAsToyPattern = /\bsilicone\s*(plug|dong|dildo|vibe|vibrator|massager|sleeve|ring|toy|stroker|packer|anal|vaginal)\b/i;

      if (siliconeAsLubePattern.test(name) ||
          (!siliconeAsToyPattern.test(name) && /\bsilicone\s*\d/i.test(name))) {
        result.style = 'silicone';
      }
    }

    return result;
  }

  /**
   * Normalize size values to consistent format
   */
  private normalizeSize(size: string): string {
    const lower = size.toLowerCase().replace(/-/g, '');

    // Map variations to standard sizes
    const sizeMap: Record<string, string> = {
      'xs': 'X-Small',
      'xsmall': 'X-Small',
      's': 'Small',
      'sm': 'Small',
      'small': 'Small',
      'm': 'Medium',
      'med': 'Medium',
      'medium': 'Medium',
      'l': 'Large',
      'lg': 'Large',
      'large': 'Large',
      'xl': 'X-Large',
      'xlarge': 'X-Large',
      'xxl': 'XX-Large',
      'xxxl': 'XXX-Large',
      '2xl': 'XX-Large',
      '3xl': 'XXX-Large',
      '4xl': 'XXXX-Large',
      // Combo sizes
      's/m': 'S/M',
      'm/l': 'M/L',
      'l/xl': 'L/XL',
      'xl/xxl': 'XL/XXL',
      'o/s': 'One Size',
      'onesize': 'One Size',
      'one size': 'One Size',
      // Queen/Plus sizes
      'queen': 'Queen',
      'q/s': 'Queen',
      'osqueen': 'Queen',
      'os queen': 'Queen',
      'mini': 'Mini',
      'petite': 'Petite',
      'regular': 'Regular',
      'plus': 'Plus',
      'jumbo': 'Jumbo',
      'giant': 'Giant',
      'king': 'King',
    };

    return sizeMap[lower] || size;
  }

  /**
   * Normalize size/volume/length values to consistent format
   * Examples:
   *   "2.5oz" -> "2.5 oz"
   *   "2.5 ounces" -> "2.5 oz"
   *   "8ml" -> "8 ml"
   *   "9inches" -> "9 in"
   *   "9"" -> "9 in"
   *   "300mg" -> "300 mg"
   */
  private normalizeSizeValue(size: string): string {
    // If it's already a normalized word size (Small, Medium, etc.), return as-is
    if (/^[A-Z]/.test(size)) {
      return size;
    }

    let normalized = size.toLowerCase().trim();

    // Clean up common artifacts like "5.oz" -> "5oz"
    normalized = normalized.replace(/(\d)\.([a-z])/i, '$1$2');

    // Extract the number and unit
    const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(.*)/);
    if (!match) {
      return size; // Can't parse, return original
    }

    const number = match[1];
    let unit = match[2].trim().replace(/^\./, ''); // Remove leading dot if present

    // Normalize unit names
    const unitMap: Record<string, string> = {
      // Volume
      'oz': 'oz',
      'ounce': 'oz',
      'ounces': 'oz',
      'floz': 'fl oz',
      'fl oz': 'fl oz',
      'fl.oz': 'fl oz',
      'fluid oz': 'fl oz',
      'fluid ounce': 'fl oz',
      'fluid ounces': 'fl oz',
      'ml': 'ml',
      'milliliter': 'ml',
      'milliliters': 'ml',
      'millilitre': 'ml',
      'millilitres': 'ml',
      'l': 'L',
      'liter': 'L',
      'liters': 'L',
      'litre': 'L',
      'litres': 'L',
      // Weight
      'g': 'g',
      'gram': 'g',
      'grams': 'g',
      'mg': 'mg',
      'milligram': 'mg',
      'milligrams': 'mg',
      'lb': 'lb',
      'lbs': 'lb',
      'pound': 'lb',
      'pounds': 'lb',
      // Length
      'in': 'in',
      'inch': 'in',
      'inches': 'in',
      '"': 'in',
      '″': 'in',
      'mm': 'mm',
      'millimeter': 'mm',
      'millimeters': 'mm',
      'millimetre': 'mm',
      'millimetres': 'mm',
      'cm': 'cm',
      'centimeter': 'cm',
      'centimeters': 'cm',
      'centimetre': 'cm',
      'centimetres': 'cm',
      'ft': 'ft',
      'foot': 'ft',
      'feet': 'ft',
      // Count
      'pk': 'pk',
      'pack': 'pk',
      'packs': 'pk',
      'pc': 'pc',
      'pcs': 'pc',
      'piece': 'pc',
      'pieces': 'pc',
      'ct': 'ct',
      'count': 'ct',
    };

    // Normalize the unit
    const normalizedUnit = unitMap[unit] || unit;

    // Format with space between number and unit
    return `${number} ${normalizedUnit}`;
  }

  /**
   * Normalize color names to consistent format
   * Examples:
   *   "blk" -> "Black"
   *   "wht" -> "White"
   *   "clr" -> "Clear"
   */
  private normalizeColor(color: string): string {
    const colorMap: Record<string, string> = {
      // Common abbreviations
      'blk': 'Black',
      'wht': 'White',
      'clr': 'Clear',
      'slv': 'Silver',
      'gld': 'Gold',
      'pnk': 'Pink',
      'prp': 'Purple',
      'blu': 'Blue',
      'grn': 'Green',
      'red': 'Red',
      'ylw': 'Yellow',
      'org': 'Orange',
      'brn': 'Brown',
      'gry': 'Gray',
      'grey': 'Gray',
      // Full names (ensure title case)
      'black': 'Black',
      'white': 'White',
      'clear': 'Clear',
      'silver': 'Silver',
      'gold': 'Gold',
      'pink': 'Pink',
      'purple': 'Purple',
      'blue': 'Blue',
      'green': 'Green',
      'yellow': 'Yellow',
      'orange': 'Orange',
      'brown': 'Brown',
      'gray': 'Gray',
      'nude': 'Nude',
      'tan': 'Tan',
      'beige': 'Beige',
      'ivory': 'Ivory',
      'teal': 'Teal',
      'navy': 'Navy',
      'bronze': 'Bronze',
      'copper': 'Copper',
      'rose': 'Rose',
      'pearl': 'Pearl',
      'midnight': 'Midnight',
      'matte': 'Matte',
      // Compound colors
      'rose gold': 'Rose Gold',
      'matte black': 'Matte Black',
      'pearl white': 'Pearl White',
      'midnight black': 'Midnight Black',
    };

    const lower = color.toLowerCase().trim();
    return colorMap[lower] || XMLParser.applyTitleCase(color);
  }

  /**
   * Normalize flavor/scent names to consistent format
   * Examples:
   *   "straw" -> "Strawberry"
   *   "choc" -> "Chocolate"
   *   "van" -> "Vanilla"
   */
  private normalizeFlavor(flavor: string): string {
    const flavorMap: Record<string, string> = {
      // Common abbreviations
      'straw': 'Strawberry',
      'choc': 'Chocolate',
      'van': 'Vanilla',
      'mint': 'Mint',
      'cher': 'Cherry',
      'mang': 'Mango',
      'pepp': 'Peppermint',
      'lav': 'Lavender',
      'coco': 'Coconut',
      'lem': 'Lemon',
      'nat': 'Natural',
      // Full names (ensure consistent title case)
      'strawberry': 'Strawberry',
      'chocolate': 'Chocolate',
      'vanilla': 'Vanilla',
      'cherry': 'Cherry',
      'mango': 'Mango',
      'peppermint': 'Peppermint',
      'spearmint': 'Spearmint',
      'lavender': 'Lavender',
      'coconut': 'Coconut',
      'lemon': 'Lemon',
      'lime': 'Lime',
      'banana': 'Banana',
      'grape': 'Grape',
      'raspberry': 'Raspberry',
      'blueberry': 'Blueberry',
      'peach': 'Peach',
      'apple': 'Apple',
      'watermelon': 'Watermelon',
      'eucalyptus': 'Eucalyptus',
      'jasmine': 'Jasmine',
      'cinnamon': 'Cinnamon',
      'ginger': 'Ginger',
      'honey': 'Honey',
      'caramel': 'Caramel',
      'mocha': 'Mocha',
      'coffee': 'Coffee',
      'natural': 'Natural',
      'aloe': 'Aloe',
      // Multi-word flavors
      'pina colada': 'Piña Colada',
      'piña colada': 'Piña Colada',
      'passion fruit': 'Passion Fruit',
      'key lime': 'Key Lime',
      'butter rum': 'Butter Rum',
      'creme brulee': 'Crème Brûlée',
      'crème brûlée': 'Crème Brûlée',
      'mango passion': 'Mango Passion',
      'cherry lemonade': 'Cherry Lemonade',
      'orange cream': 'Orange Cream',
      'banana cream': 'Banana Cream',
      'tahitian vanilla': 'Tahitian Vanilla',
      'natural aloe': 'Natural Aloe',
      'french lavender': 'French Lavender',
      'strawberry banana': 'Strawberry Banana',
      'blue raspberry': 'Blue Raspberry',
      'green apple': 'Green Apple',
      'cotton candy': 'Cotton Candy',
      'bubble gum': 'Bubble Gum',
      'root beer': 'Root Beer',
      'cherry vanilla': 'Cherry Vanilla',
      'chocolate mint': 'Chocolate Mint',
    };

    const lower = flavor.toLowerCase().trim();
    return flavorMap[lower] || XMLParser.applyTitleCase(flavor);
  }

  /**
   * Normalize style names to consistent format
   */
  private normalizeStyle(style: string): string {
    const styleMap: Record<string, string> = {
      'warming': 'Warming',
      'cooling': 'Cooling',
      'tingling': 'Tingling',
      'sensitizing': 'Sensitizing',
      'desensitizing': 'Desensitizing',
      'water': 'Water-Based',
      'silicone': 'Silicone-Based',
      'hybrid': 'Hybrid',
      'oil': 'Oil-Based',
      'organic': 'Organic',
      'gel': 'Gel',
      'liquid': 'Liquid',
      'cream': 'Cream',
      'lotion': 'Lotion',
      'spray': 'Spray',
      'foam': 'Foam',
      'ice': 'Ice',
      'fire': 'Fire',
      'heat': 'Heat',
      'cool': 'Cool',
      'warm': 'Warm',
      'hot': 'Hot',
      'cold': 'Cold',
    };

    const lower = style.toLowerCase().trim();
    return styleMap[lower] || XMLParser.applyTitleCase(style);
  }

  /**
   * Get variation option value for a product based on the variation type
   * This is used to determine the specific variation value for each product in a group
   */
  getVariationOption(product: XMLProduct, variationType: 'color' | 'flavor' | 'size' | 'style' | null): string {
    if (!variationType) {
      return this.cleanVariationName(product.name);
    }

    const extracted = this.extractVariationValue(product.name);

    switch (variationType) {
      case 'color':
        // First try the XML color field
        if (product.color && product.color.trim()) {
          return this.normalizeColor(product.color.trim());
        }
        // Then try extracted from name
        if (extracted.color) {
          return this.normalizeColor(extracted.color);
        }
        break;

      case 'flavor':
        if (extracted.flavor) {
          return this.normalizeFlavor(extracted.flavor);
        }
        // Check for style as fallback for flavor type
        if (extracted.style) {
          return this.normalizeStyle(extracted.style);
        }
        break;

      case 'style':
        if (extracted.style) {
          return this.normalizeStyle(extracted.style);
        }
        break;

      case 'size':
        if (extracted.size) {
          return this.normalizeSizeValue(extracted.size);
        }
        break;
    }

    // Fallback: try to extract the differing part from the product name
    // by comparing to the base name
    const baseName = this.extractBaseName(product.name);
    if (product.name.length > baseName.length) {
      let suffix = product.name.substring(baseName.length).trim();
      suffix = this.cleanVariationName(suffix);
      if (suffix && suffix.length > 0) {
        return XMLParser.applyTitleCase(suffix);
      }
    }

    // Final fallback: just use a cleaned version of the full name
    return this.cleanVariationName(product.name);
  }

  /**
   * Clean up a variation name by removing common artifacts
   */
  private cleanVariationName(name: string): string {
    let cleaned = name
      // Remove (net) and similar suffixes
      .replace(/\s*\(net\)\s*/gi, '')
      // Remove trailing/leading punctuation
      .replace(/^[\s\-\.]+|[\s\-\.]+$/g, '')
      // Clean up multiple spaces
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned || name;
  }

  /**
   * Get all unique categories from products
   */
  getAllCategories(products: XMLProduct[]): Array<{ code: string; name: string; parent: string }> {
    const categoryMap = new Map<string, { code: string; name: string; parent: string }>();

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
   * Apply title case to product name
   */
  static applyTitleCase(text: string): string {
    const lowercaseWords = new Set([
      'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from',
      'in', 'into', 'near', 'nor', 'of', 'on', 'onto', 'or',
      'the', 'to', 'with'
    ]);

    return text
      .toLowerCase()
      .split(' ')
      .map((word, index) => {
        // Always capitalize first word
        if (index === 0) {
          return word.charAt(0).toUpperCase() + word.slice(1);
        }

        // Don't capitalize lowercase words unless they're first
        if (lowercaseWords.has(word)) {
          return word;
        }

        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ')
      .trim();
  }

  /**
   * Clean product description
   */
  static cleanDescription(description: string): string {
    // Remove year markers at end
    let cleaned = description.replace(/\s*20\d{2}\s*\.?\s*$/g, '');

    // Remove "Restricted, Amazon Restricted" and similar
    cleaned = cleaned.replace(/\s*Restricted[^.]*\.\s*$/gi, '');

    // Remove excessive whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
  }

  /**
   * Generate short description from full description
   */
  static generateShortDescription(description: string, maxLength = 160): string {
    // Get first 2-3 sentences
    const sentences = description.match(/[^.!?]+[.!?]+/g) || [];

    let shortDesc = '';
    for (const sentence of sentences.slice(0, 2)) {
      if (shortDesc.length + sentence.length <= maxLength) {
        shortDesc += sentence;
      } else {
        break;
      }
    }

    // If nothing found, take first N characters
    if (!shortDesc) {
      shortDesc = description.substring(0, maxLength);
      // Cut at last complete word
      const lastSpace = shortDesc.lastIndexOf(' ');
      if (lastSpace > 0) {
        shortDesc = shortDesc.substring(0, lastSpace) + '...';
      }
    }

    return shortDesc.trim();
  }
}
