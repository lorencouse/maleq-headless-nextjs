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
  variationAttribute: 'color' | 'flavor' | 'size' | null;
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
   * Detect potential variations by analyzing product names and attributes
   */
  detectVariations(products: XMLProduct[]): VariationGroup[] {
    const groups = new Map<string, VariationGroup>();

    for (const product of products) {
      // Extract base name (remove size, flavor, color indicators)
      const baseName = this.extractBaseName(product.name);
      const key = `${baseName}|${product.manufacturer.code}|${product.type.code}`;

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

    // Filter groups to only include those with 2+ products
    const variationGroups: VariationGroup[] = [];

    for (const group of groups.values()) {
      if (group.products.length > 1) {
        // Determine variation attribute
        group.variationAttribute = this.determineVariationAttribute(group.products);
        variationGroups.push(group);
      }
    }

    return variationGroups;
  }

  /**
   * Extract base name from product name
   * Remove size indicators (2.5 OZ, 8oz, etc.), flavor/color names
   */
  private extractBaseName(name: string): string {
    let baseName = name;

    // Remove common size patterns first
    baseName = baseName.replace(/\s*\d+(\.\d+)?\s*(OZ|ML|G|LB|IN|INCH|INCHES|MM|CM)\b/gi, '');

    // Remove common flavor/scent/color indicators in brackets or at end
    baseName = baseName.replace(/\s*\[.*?\]/g, '');
    baseName = baseName.replace(/\s*\(.*?\)/g, '');

    // Remove multi-word flavor/color variants first (order matters - do compound words before single words)
    const multiWordVariants = [
      'PINA COLADA', 'MANGO PASSION', 'CHERRY LEMONADE', 'BUTTER RUM', 'BANANA CREAM',
      'KEY LIME', 'ORANGE CREAM', 'TAHITIAN VANILLA', 'NATURAL ALOE',
      'CREME BRULEE', 'MINT CHOCOLATE', 'COOKIES AND CREAM', 'STRAWBERRY BANANA',
      'PASSION FRUIT', 'BLUE RASPBERRY', 'GREEN APPLE', 'COTTON CANDY',
      'BUBBLE GUM', 'ROOT BEER', 'CHERRY VANILLA', 'CHOCOLATE MINT',
      'EXTRA LARGE', 'EXTRA SMALL'
    ];

    for (const variant of multiWordVariants) {
      const regex = new RegExp(`\\s+${variant}\\s*$`, 'i');
      baseName = baseName.replace(regex, '');
    }

    // Remove single-word flavor/color variants
    const singleWordVariants = [
      'NATURAL', 'MANGO', 'CHERRY', 'STRAWBERRY', 'VANILLA', 'ALOE',
      'CHOCOLATE', 'MINT', 'GRAPE', 'ORANGE', 'LEMON', 'LIME', 'BANANA',
      'RASPBERRY', 'BLUEBERRY', 'PEACH', 'APPLE', 'WATERMELON', 'COCONUT',
      'RED', 'BLUE', 'GREEN', 'PINK', 'PURPLE', 'BLACK', 'WHITE', 'CLEAR', 'SILVER', 'GOLD',
      'SMALL', 'MEDIUM', 'LARGE', 'XLARGE', 'XL', 'XXL', 'XXXL'
    ];

    for (const variant of singleWordVariants) {
      const regex = new RegExp(`\\s+${variant}\\s*$`, 'i');
      baseName = baseName.replace(regex, '');
    }

    return baseName.trim();
  }

  /**
   * Determine what attribute varies between products
   */
  private determineVariationAttribute(products: XMLProduct[]): 'color' | 'flavor' | 'size' | null {
    // Check if colors differ
    const colors = new Set(products.map(p => p.color.toLowerCase()).filter(c => c));
    if (colors.size > 1) {
      return 'color';
    }

    // Check if flavors differ (by analyzing names)
    const flavorKeywords = ['flavor', 'scent', 'taste', 'natural', 'vanilla', 'chocolate', 'strawberry'];
    const hasFlavorInNames = products.some(p =>
      flavorKeywords.some(kw => p.name.toLowerCase().includes(kw))
    );
    if (hasFlavorInNames) {
      return 'flavor';
    }

    // Check if sizes differ
    const sizes = new Set(
      products.map(p => {
        const match = p.name.match(/\d+(\.\d+)?\s*(OZ|ML|G|LB)/i);
        return match ? match[0].toLowerCase() : '';
      }).filter(s => s)
    );
    if (sizes.size > 1) {
      return 'size';
    }

    return null;
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
