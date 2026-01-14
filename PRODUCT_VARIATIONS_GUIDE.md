# Product Variations System

Automatic detection and merging of product variations (e.g., different sizes, colors, counts).

## Overview

The system automatically detects products that are variations of the same base product and merges them into variable products with selectable options. For example:

**Before:**
- GUN OIL LUBRICANT H2O 2 OZ (SKU: EPG02)
- GUN OIL LUBRICANT H2O 4 OZ (SKU: EPG04)
- GUN OIL LUBRICANT H2O 8 OZ (SKU: EPG08)
- GUN OIL LUBRICANT H2O 16 OZ (SKU: EPG16)

**After:**
- GUN OIL LUBRICANT H2O (Parent Product)
  - Variation: 2 OZ (EPG02)
  - Variation: 4 OZ (EPG04)
  - Variation: 8 OZ (EPG08)
  - Variation: 16 OZ (EPG16)

## How It Works

### Detection Criteria

Products are grouped as variations when they match ALL of these criteria:

1. **Similar base names** - Names are similar after removing size/color/count indicators
2. **Similar SKU patterns** - SKUs follow a pattern (e.g., EPG02, EPG04, EPG08)
3. **Same manufacturer** - Products from the same manufacturer
4. **Same product type** - Products in the same category
5. **Detected variation attributes** - System finds varying attributes like:
   - Volume/Size (2 OZ, 4 OZ, 8 OZ, 100ML, etc.)
   - Color (Black, Red, Blue, etc.)
   - Count (2 Pack, 6 Count, etc.)
   - Length/Dimensions (6 inch, 8 inch, etc.)
   - Material (Silicone, Glass, Metal, etc.)

### Database Schema

The system adds these fields to the `Product` table:

```prisma
model Product {
  // ... existing fields ...

  isVariableProduct Boolean   @default(false) // Is this a parent with variations?
  parentProductId   String?                   // Points to parent if this is a variation
  parentProduct     Product?  @relation("ProductVariations")
  variations        Product[] @relation("ProductVariations")
  variationAttributes ProductVariationAttribute[]
}

model ProductVariationAttribute {
  id        String
  productId String
  name      String   // e.g., "Size", "Color", "Volume"
  value     String   // e.g., "2 OZ", "Red", "100ml"
  sortOrder Int
}
```

## Usage

### Admin Interface

Visit the variations management page:

```
http://localhost:3000/admin/variations
```

**Step 1: Detect Variations**
- Click "Detect Variations" button
- System scans all products and finds potential variation groups
- Review the detected groups with their attributes

**Step 2: Merge Variations**
- Click "Merge X Groups" button
- System automatically:
  - Converts the first product in each group to a parent product
  - Links other products as variations
  - Extracts and stores variation attributes (size, color, etc.)

### Programmatic API

#### Detect variations without merging:

```typescript
import { detectProductVariations } from '@/lib/products/variation-detector';

const groups = await detectProductVariations();
// Returns array of VariationGroup objects
```

#### Automatically merge all detected variations:

```typescript
import { autoMergeAllVariations } from '@/lib/products/variation-detector';

const result = await autoMergeAllVariations();
// Returns: { groupsFound, groupsMerged, productsAffected }
```

#### Merge a specific group:

```typescript
import { mergeProductVariations } from '@/lib/products/variation-detector';

await mergeProductVariations(group);
// Returns parent product ID
```

### API Endpoints

**GET** `/api/admin/variations/detect`
- Detects all variation groups
- Returns list of groups with products and attributes

**POST** `/api/admin/variations/merge`
- Merges all detected variation groups
- Returns success statistics

## Product Display

### Accessing Variation Data

When fetching a product via `getProductBySlug()`, variable products include variation data:

```typescript
import { getProductBySlug } from '@/lib/products/product-service';

const product = await getProductBySlug('epg02');

if (product.isVariableProduct && product.variations) {
  // This is a variable product with options
  console.log('Variations:', product.variations);

  product.variations.forEach(variation => {
    console.log(`${variation.sku}: ${variation.name}`);
    console.log('Attributes:', variation.attributes);
    console.log('Price:', variation.price);
    console.log('Stock:', variation.stockStatus);
  });
}
```

### Variation Object Structure

```typescript
{
  isVariableProduct: true,
  variations: [
    {
      id: "clxx...",
      sku: "EPG02",
      name: "GUN OIL LUBRICANT H2O 2 OZ",
      price: "9.99",
      stockStatus: "IN_STOCK",
      stockQuantity: 50,
      attributes: [
        { name: "Volume", value: "2 OZ" }
      ]
    },
    {
      id: "clxy...",
      sku: "EPG04",
      name: "GUN OIL LUBRICANT H2O 4 OZ",
      price: "14.99",
      stockStatus: "IN_STOCK",
      stockQuantity: 30,
      attributes: [
        { name: "Volume", value: "4 OZ" }
      ]
    }
  ]
}
```

## Supported Variation Types

The system automatically detects these attribute types:

### Volume/Size
- Patterns: `2 OZ`, `4 OZ`, `100 ML`, `1 L`, `8 FL OZ`
- Examples: lubricants, liquids, gels

### Count/Quantity
- Patterns: `2 PACK`, `6 COUNT`, `12 CT`, `3 PIECES`
- Examples: multi-packs, bundles

### Dimensions
- Patterns: `6 INCH`, `8 IN`, `10 CM`, `12 FOOT`
- Examples: length, width, diameter

### Color
- Patterns: `BLACK`, `WHITE`, `RED`, `BLUE`, `PINK`, `PURPLE`
- Examples: color variations

### Material
- Patterns: `SILICONE`, `GLASS`, `METAL`, `LATEX`, `RUBBER`
- Examples: product materials

### Size Labels
- Patterns: `SMALL`, `MEDIUM`, `LARGE`, `XL`, `XXL`
- Examples: clothing, accessories

## Examples

### Example 1: Volume Variations

**Products:**
- SLIQUID H2O 2 OZ (SLI02)
- SLIQUID H2O 4 OZ (SLI04)
- SLIQUID H2O 8 OZ (SLI08)

**Detection:**
- Base name: "SLIQUID H2O"
- SKU pattern: "SLI"
- Attribute: Volume (2 OZ, 4 OZ, 8 OZ)

**Result:** Variable product with 3 size options

### Example 2: Color + Size Variations

**Products:**
- VIBRATOR 6 INCH BLACK (VIB6BK)
- VIBRATOR 6 INCH RED (VIB6RD)
- VIBRATOR 8 INCH BLACK (VIB8BK)
- VIBRATOR 8 INCH RED (VIB8RD)

**Detection:**
- Base name: "VIBRATOR"
- SKU pattern: "VIB"
- Attributes:
  - Length (6 INCH, 8 INCH)
  - Color (BLACK, RED)

**Result:** Variable product with 4 combinations

### Example 3: Count Variations

**Products:**
- CONDOMS 3 PACK (CON3)
- CONDOMS 12 PACK (CON12)
- CONDOMS 36 PACK (CON36)

**Detection:**
- Base name: "CONDOMS"
- SKU pattern: "CON"
- Attribute: Count (3 PACK, 12 PACK, 36 PACK)

**Result:** Variable product with 3 count options

## Customization

### Adding New Variation Patterns

Edit `lib/products/variation-detector.ts` and add to `VARIATION_PATTERNS`:

```typescript
const VARIATION_PATTERNS = [
  // Add your custom pattern
  {
    name: 'Intensity',
    regex: /\b(LOW|MEDIUM|HIGH|EXTREME)\s*(?:INTENSITY|POWER)?\b/gi
  },
  // ... existing patterns
];
```

### Adjusting Similarity Threshold

In `detectProductVariations()`, adjust the similarity threshold (default: 0.7):

```typescript
const nameSimilarity = groupProducts.every((p1, i) =>
  groupProducts.every((p2, j) =>
    i === j || calculateSimilarity(getBaseName(p1.name), getBaseName(p2.name)) > 0.7 // <-- Change this value
  )
);
```

Lower values (e.g., 0.5) = more groups detected, less precise
Higher values (e.g., 0.9) = fewer groups, more precise

## Best Practices

1. **Review Before Merging** - Always review detected groups before merging
2. **Test on Staging** - Test the detection algorithm on a staging database first
3. **Backup First** - Backup your database before running merge operations
4. **Incremental Approach** - Merge a few groups at a time initially
5. **Monitor Results** - Check product pages after merging to verify correct display

## Troubleshooting

### Products Not Detected as Variations

**Possible reasons:**
- Names are too different (below 70% similarity)
- Different manufacturers or product types
- SKU patterns don't match
- No varying attributes detected

**Solutions:**
- Adjust similarity threshold
- Add custom variation patterns
- Manually review product names for consistency

### Wrong Products Grouped Together

**Possible reasons:**
- Names are too similar
- SKU patterns overlap

**Solutions:**
- Increase similarity threshold
- Review and manually ungroup

### To Ungroup Variations

```sql
-- Reset a variation back to standalone product
UPDATE Product
SET parentProductId = NULL
WHERE id = 'product-id';

-- Reset parent product
UPDATE Product
SET isVariableProduct = FALSE
WHERE id = 'parent-product-id';

-- Delete variation attributes
DELETE FROM ProductVariationAttribute
WHERE productId IN ('product-id-1', 'product-id-2');
```

## Performance

- Detection runs in O(n²) time complexity for similarity checking
- Recommended for databases with < 10,000 products
- For larger databases, consider batching or background processing
- Indexing on `parentProductId` and `isVariableProduct` improves query performance

## Future Enhancements

Potential improvements:
- [ ] Manual variation creation UI
- [ ] Variation attribute management UI
- [ ] Product combination/bundling
- [ ] Automatic pricing rules (e.g., bulk discounts)
- [ ] Variation-specific images
- [ ] Inventory management across variations
- [ ] Advanced filtering by variation attributes
- [ ] Machine learning-based detection
