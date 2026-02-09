import { createReadStream } from 'fs';
import { parse } from 'csv-parse';

/**
 * STC Product structure from CSV
 */
export interface STCProduct {
  handle: string;
  upc: string;
  name: string;
  description: string;
  brand: string;
  price: string;
  category1: string;
  category2: string;
  category3: string;
  features: string;
  functions: string;
  warranty: string;
  waterResistance: string;
  size: string;
  power: string;
  material: string;
  color: string;
  images: string[];
  allowMarketplace: boolean;
  discountable: boolean;
  weight: string;
  width: string;
  height: string;
  length: string;
  insertableLength: string;
  innerDiameter: string;
}

/**
 * Variation group for STC products
 */
export interface STCVariationGroup {
  baseName: string;
  brand: string;
  products: STCProduct[];
  variationAttribute: 'color' | 'size' | 'style' | null;
}

/**
 * Parse STC CSV file
 */
export class STCCSVParser {
  private csvPath: string;

  constructor(csvPath: string) {
    this.csvPath = csvPath;
  }

  /**
   * Parse CSV and return products
   */
  async parseProducts(): Promise<STCProduct[]> {
    return new Promise((resolve, reject) => {
      const products: STCProduct[] = [];

      createReadStream(this.csvPath)
        .pipe(
          parse({
            columns: true,
            skip_empty_lines: true,
            trim: true,
          })
        )
        .on('data', (row: Record<string, string>) => {
          try {
            const product = this.parseRow(row);
            if (product) {
              products.push(product);
            }
          } catch (error) {
            console.warn(`Failed to parse row: ${error}`);
          }
        })
        .on('end', () => resolve(products))
        .on('error', reject);
    });
  }

  /**
   * Parse a single CSV row
   */
  private parseRow(row: Record<string, string>): STCProduct | null {
    // Skip rows without UPC
    if (!row['UPC'] || !row['Product Name']) {
      return null;
    }

    // Collect images
    const images: string[] = [];
    if (row['Image 1']) images.push(row['Image 1']);
    if (row['Image 2']) images.push(row['Image 2']);
    if (row['Image 3']) images.push(row['Image 3']);

    return {
      handle: row['Handle'] || '',
      upc: row['UPC'] || '',
      name: row['Product Name'] || '',
      description: row['Description'] || '',
      brand: row['Brand'] || '',
      price: row['Price'] || '0',
      category1: row['Category 1'] || '',
      category2: row['Category 2'] || '',
      category3: row['Category 3'] || '',
      features: row['Features'] || '',
      functions: row['Functions'] || '',
      warranty: row['Warranty'] || '',
      waterResistance: row['Water Resistance'] || '',
      size: row['Size'] || '',
      power: row['Power'] || '',
      material: row['Material'] || '',
      color: row['Color'] || '',
      images,
      allowMarketplace: row['Allow Marketplace']?.toUpperCase() === 'Y',
      discountable: row['Discountable']?.toUpperCase() === 'Y',
      weight: row['Weight'] || '',
      width: row['Width'] || '',
      height: row['Height'] || '',
      length: row['Length'] || '',
      insertableLength: row['Insertable Length'] || '',
      innerDiameter: row['Inner Diameter'] || '',
    };
  }

  /**
   * Apply title case to product name
   */
  static applyTitleCase(text: string): string {
    const lowercaseWords = new Set([
      'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from',
      'in', 'into', 'near', 'nor', 'of', 'on', 'onto', 'or',
      'the', 'to', 'with',
    ]);

    return text
      .toLowerCase()
      .split(' ')
      .map((word, index) => {
        if (index === 0) {
          return word.charAt(0).toUpperCase() + word.slice(1);
        }
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
    let cleaned = description
      .replace(/\s*20\d{2}\s*\.?\s*$/g, '')
      .replace(/\s*Restricted[^.]*\.\s*$/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned;
  }

  /**
   * Generate short description
   */
  static generateShortDescription(description: string, maxLength = 160): string {
    const sentences = description.match(/[^.!?]+[.!?]+/g) || [];

    let shortDesc = '';
    for (const sentence of sentences.slice(0, 2)) {
      if (shortDesc.length + sentence.length <= maxLength) {
        shortDesc += sentence;
      } else {
        break;
      }
    }

    if (!shortDesc) {
      shortDesc = description.substring(0, maxLength);
      const lastSpace = shortDesc.lastIndexOf(' ');
      if (lastSpace > 0) {
        shortDesc = shortDesc.substring(0, lastSpace) + '...';
      }
    }

    return shortDesc.trim();
  }

  /**
   * Generate URL-friendly slug
   */
  static generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 200);
  }

  /**
   * Extract base name for variation detection
   */
  private extractBaseName(name: string): string {
    let baseName = name;

    // Remove size/volume patterns
    baseName = baseName.replace(/\s*\.?\d+(\.\d+)?\s*(FL\.?\s*)?(OZ|OUNCES?|ML|L|G|MG|LB|LBS)\b/gi, '');

    // Remove length patterns
    baseName = baseName.replace(/\s*\d+(\.\d+)?\s*(INCHES?|IN|"|MM|CM)\b/gi, '');

    // Remove color words at end
    const colorWords = [
      'RED', 'BLUE', 'GREEN', 'PINK', 'PURPLE', 'BLACK', 'WHITE', 'CLEAR',
      'SILVER', 'GOLD', 'ORANGE', 'YELLOW', 'TEAL', 'NUDE', 'TAN', 'BROWN',
    ];
    for (const color of colorWords) {
      baseName = baseName.replace(new RegExp(`\\s+${color}\\s*$`, 'i'), '');
    }

    // Remove size words at end
    const sizeWords = ['SMALL', 'MEDIUM', 'LARGE', 'XL', 'XXL', 'SM', 'MED', 'LG', 'S', 'M', 'L'];
    for (const size of sizeWords) {
      baseName = baseName.replace(new RegExp(`\\s+${size}\\s*$`, 'i'), '');
    }

    return baseName.replace(/\s+/g, ' ').trim();
  }

  /**
   * Detect product variations
   */
  detectVariations(products: STCProduct[]): STCVariationGroup[] {
    const groups = new Map<string, STCVariationGroup>();

    for (const product of products) {
      const baseName = this.extractBaseName(product.name);
      const priceKey = parseFloat(product.price).toFixed(2);
      const key = `${baseName}|${product.brand}|${priceKey}`;

      if (!groups.has(key)) {
        groups.set(key, {
          baseName,
          brand: product.brand,
          products: [],
          variationAttribute: null,
        });
      }

      groups.get(key)!.products.push(product);
    }

    // Filter to groups with 2+ products and determine variation attribute
    const variationGroups: STCVariationGroup[] = [];

    for (const group of groups.values()) {
      if (group.products.length > 1) {
        group.variationAttribute = this.determineVariationAttribute(group.products);
        variationGroups.push(group);
      }
    }

    return variationGroups;
  }

  /**
   * Determine what attribute varies between products
   */
  private determineVariationAttribute(products: STCProduct[]): 'color' | 'size' | 'style' | null {
    // Check colors
    const colors = new Set(products.map(p => p.color.toLowerCase()).filter(c => c));
    if (colors.size > 1) {
      return 'color';
    }

    // Check sizes
    const sizes = new Set(products.map(p => p.size.toLowerCase()).filter(s => s));
    if (sizes.size > 1) {
      return 'size';
    }

    // Check for size in name
    const sizePatterns = products.map(p => {
      const match = p.name.match(/\d+(\.\d+)?\s*(OZ|ML|IN|INCHES?)/i);
      return match ? match[0] : '';
    }).filter(s => s);

    if (new Set(sizePatterns).size > 1) {
      return 'size';
    }

    return 'style';
  }

  /**
   * Get variation option value for a product
   */
  getVariationOption(product: STCProduct, variationType: 'color' | 'size' | 'style' | null): string {
    if (!variationType) {
      return product.name;
    }

    switch (variationType) {
      case 'color':
        if (product.color) {
          return STCCSVParser.applyTitleCase(product.color);
        }
        // Extract from name
        const colorWords = [
          'red', 'blue', 'green', 'pink', 'purple', 'black', 'white', 'clear',
          'silver', 'gold', 'orange', 'yellow', 'teal', 'nude', 'tan', 'brown',
        ];
        for (const color of colorWords) {
          if (product.name.toLowerCase().includes(color)) {
            return color.charAt(0).toUpperCase() + color.slice(1);
          }
        }
        break;

      case 'size':
        if (product.size) {
          return product.size;
        }
        // Extract from name
        const sizeMatch = product.name.match(/(\d+(?:\.\d+)?)\s*(OZ|ML|IN|INCHES?|")/i);
        if (sizeMatch) {
          return sizeMatch[0];
        }
        const sizeWords = ['Small', 'Medium', 'Large', 'XL', 'XXL'];
        for (const size of sizeWords) {
          if (product.name.toLowerCase().includes(size.toLowerCase())) {
            return size;
          }
        }
        break;

      case 'style':
        // Extract differing part from name
        const baseName = this.extractBaseName(product.name);
        const suffix = product.name.replace(baseName, '').trim();
        if (suffix) {
          return STCCSVParser.applyTitleCase(suffix);
        }
        break;
    }

    return STCCSVParser.applyTitleCase(product.name);
  }

  /**
   * Parse features string into array
   */
  static parseFeatures(features: string): string[] {
    if (!features) return [];
    return features
      .split(',')
      .map(f => f.trim())
      .filter(f => f.length > 0);
  }

  /**
   * Get categories from product
   */
  static getCategories(product: STCProduct): string[] {
    const categories: string[] = [];
    if (product.category1) categories.push(product.category1);
    if (product.category2) categories.push(product.category2);
    if (product.category3) categories.push(product.category3);
    return categories;
  }
}
