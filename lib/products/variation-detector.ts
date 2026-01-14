import { prisma } from '@/lib/prisma';

/**
 * Detects if products are variations of the same product based on:
 * 1. Similar names (with size/volume/quantity differences)
 * 2. Similar SKU patterns (e.g., EPG02, EPG04, EPG08)
 * 3. Same manufacturer and product type
 */

interface ProductVariationCandidate {
  id: string;
  sku: string;
  name: string;
  manufacturerId: string | null;
  productTypeId: string | null;
  price: any;
  stockStatus: string;
  stockQuantity: number;
}

interface VariationGroup {
  baseName: string;
  baseSkuPattern: string;
  products: ProductVariationCandidate[];
  detectedAttributes: Map<string, Set<string>>; // e.g., "Size" -> ["2 OZ", "4 OZ", "8 OZ"]
}

/**
 * Common patterns for detecting variation attributes in product names
 */
const VARIATION_PATTERNS = [
  // Volume/Size patterns
  { name: 'Volume', regex: /(\d+(?:\.\d+)?)\s*(OZ|ML|L|LITER|OUNCE|FLUID\s*OUNCE|FL\s*OZ)/gi },
  { name: 'Size', regex: /(\d+(?:\.\d+)?)\s*(OZ|ML|L|G|GRAM|KG|LB|POUND)/gi },
  { name: 'Size', regex: /(X+L|SMALL|MEDIUM|LARGE|XS|S|M|L|XL|XXL|XXXL)\b/gi },

  // Count/Quantity patterns
  { name: 'Count', regex: /(\d+)\s*(PACK|COUNT|CT|PCS|PIECES|UNITS?)/gi },

  // Dimensions
  { name: 'Length', regex: /(\d+(?:\.\d+)?)\s*(INCH|IN|CM|MM|FOOT|FT|METER|M)(?:\s+(?:LONG|LENGTH))?/gi },
  { name: 'Diameter', regex: /(\d+(?:\.\d+)?)\s*(INCH|IN|CM|MM)(?:\s+(?:DIAMETER|DIA|WIDE|WIDTH))?/gi },

  // Color
  { name: 'Color', regex: /\b(BLACK|WHITE|RED|BLUE|GREEN|YELLOW|PINK|PURPLE|ORANGE|GRAY|GREY|SILVER|GOLD|CLEAR|TRANSPARENT)\b/gi },

  // Material
  { name: 'Material', regex: /\b(SILICONE|LATEX|RUBBER|GLASS|METAL|STEEL|PLASTIC|WOOD|LEATHER)\b/gi },
];

/**
 * Extract variation attributes from a product name
 */
function extractAttributes(name: string): Map<string, string> {
  const attributes = new Map<string, string>();

  for (const pattern of VARIATION_PATTERNS) {
    const matches = [...name.matchAll(pattern.regex)];
    if (matches.length > 0) {
      // Take the first match for each pattern type
      const match = matches[0];
      const value = match[0].trim().toUpperCase();
      attributes.set(pattern.name, value);
    }
  }

  return attributes;
}

/**
 * Get the base name by removing variation-specific parts
 */
function getBaseName(name: string): string {
  let baseName = name;

  // Remove all variation patterns
  for (const pattern of VARIATION_PATTERNS) {
    baseName = baseName.replace(pattern.regex, ' ');
  }

  // Clean up multiple spaces and trim
  baseName = baseName.replace(/\s+/g, ' ').trim();

  return baseName;
}

/**
 * Get base SKU pattern by removing trailing numbers/letters that might indicate variations
 * Examples: EPG02 -> EPG, GUNOIL2OZ -> GUNOIL
 */
function getBaseSkuPattern(sku: string): string {
  // Remove trailing digits
  let base = sku.replace(/\d+$/g, '');

  // Also try removing common variation suffixes
  base = base.replace(/(?:SM|MD|LG|XL|XXL|XXXL)$/gi, '');

  return base;
}

/**
 * Calculate similarity between two strings (0-1, where 1 is identical)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Find products that should be grouped as variations
 */
export async function detectProductVariations(): Promise<VariationGroup[]> {
  // Get all active products that aren't already variations
  const products = await prisma.product.findMany({
    where: {
      active: true,
      parentProductId: null, // Not already a variation
    },
    select: {
      id: true,
      sku: true,
      name: true,
      manufacturerId: true,
      productTypeId: true,
      price: true,
      stockStatus: true,
      stockQuantity: true,
    },
  });

  console.log(`Analyzing ${products.length} products for variations...`);

  // Group products by potential base name and SKU pattern
  const potentialGroups = new Map<string, ProductVariationCandidate[]>();

  for (const product of products) {
    const baseName = getBaseName(product.name);
    const baseSkuPattern = getBaseSkuPattern(product.sku);

    // Create a group key that includes manufacturer and type for better matching
    const groupKey = `${baseName}|${baseSkuPattern}|${product.manufacturerId}|${product.productTypeId}`;

    if (!potentialGroups.has(groupKey)) {
      potentialGroups.set(groupKey, []);
    }

    potentialGroups.get(groupKey)!.push(product);
  }

  // Filter to only groups with 2+ products (actual variation groups)
  const variationGroups: VariationGroup[] = [];

  for (const [groupKey, groupProducts] of potentialGroups) {
    if (groupProducts.length < 2) continue;

    const [baseName, baseSkuPattern] = groupKey.split('|');

    // Verify products are similar enough (check if base names are actually similar)
    const nameSimilarity = groupProducts.every((p1, i) =>
      groupProducts.every((p2, j) =>
        i === j || calculateSimilarity(getBaseName(p1.name), getBaseName(p2.name)) > 0.7
      )
    );

    if (!nameSimilarity) continue;

    // Extract attributes from each product
    const detectedAttributes = new Map<string, Set<string>>();

    for (const product of groupProducts) {
      const attributes = extractAttributes(product.name);

      for (const [attrName, attrValue] of attributes) {
        if (!detectedAttributes.has(attrName)) {
          detectedAttributes.set(attrName, new Set());
        }
        detectedAttributes.get(attrName)!.add(attrValue);
      }
    }

    // Only include groups where we detected actual varying attributes
    if (detectedAttributes.size > 0) {
      // Check if attributes actually vary (not all the same)
      const hasVariation = Array.from(detectedAttributes.values()).some(values => values.size > 1);

      if (hasVariation) {
        variationGroups.push({
          baseName,
          baseSkuPattern,
          products: groupProducts,
          detectedAttributes,
        });
      }
    }
  }

  console.log(`Found ${variationGroups.length} variation groups`);

  // Log details for each group
  for (const group of variationGroups) {
    console.log(`\nGroup: ${group.baseName} (${group.products.length} variations)`);
    console.log(`  SKU Pattern: ${group.baseSkuPattern}`);
    console.log(`  Attributes:`, Array.from(group.detectedAttributes.entries()).map(([k, v]) =>
      `${k}: ${Array.from(v).join(', ')}`
    ));
    console.log(`  Products:`, group.products.map(p => `${p.sku} - ${p.name}`).join('\n    '));
  }

  return variationGroups;
}

/**
 * Merge a group of products into a variable product with variations
 */
export async function mergeProductVariations(group: VariationGroup): Promise<string> {
  console.log(`\nMerging variation group: ${group.baseName}`);

  // Find the "best" product to be the parent (usually the smallest/cheapest or first one)
  const sortedProducts = [...group.products].sort((a, b) => {
    // Prefer lower SKU number
    const aNum = parseInt(a.sku.match(/\d+$/)?.[0] || '999');
    const bNum = parseInt(b.sku.match(/\d+$/)?.[0] || '999');
    return aNum - bNum;
  });

  const parentProduct = sortedProducts[0];
  const variationProducts = sortedProducts.slice(1);

  // Update parent product to be a variable product
  await prisma.product.update({
    where: { id: parentProduct.id },
    data: {
      isVariableProduct: true,
      name: group.baseName.trim(), // Use clean base name
    },
  });

  console.log(`  Parent product: ${parentProduct.sku} - ${parentProduct.name}`);

  // Update variation products to point to parent
  for (const variation of variationProducts) {
    await prisma.product.update({
      where: { id: variation.id },
      data: {
        parentProductId: parentProduct.id,
      },
    });

    console.log(`  + Added variation: ${variation.sku}`);
  }

  // Create variation attributes for all products (including parent)
  for (const product of group.products) {
    const attributes = extractAttributes(product.name);

    for (const [attrName, attrValue] of attributes) {
      await prisma.productVariationAttribute.create({
        data: {
          productId: product.id,
          name: attrName,
          value: attrValue,
          sortOrder: 0,
        },
      });
    }
  }

  console.log(`  ✓ Merged ${group.products.length} products into variable product`);

  return parentProduct.id;
}

/**
 * Automatically detect and merge all product variations
 */
export async function autoMergeAllVariations(): Promise<{
  groupsFound: number;
  groupsMerged: number;
  productsAffected: number;
}> {
  const groups = await detectProductVariations();

  let groupsMerged = 0;
  let productsAffected = 0;

  for (const group of groups) {
    try {
      await mergeProductVariations(group);
      groupsMerged++;
      productsAffected += group.products.length;
    } catch (error) {
      console.error(`Error merging group ${group.baseName}:`, error);
    }
  }

  return {
    groupsFound: groups.length,
    groupsMerged,
    productsAffected,
  };
}
