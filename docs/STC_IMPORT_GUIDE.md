# STC Product Import Guide

This guide documents the process for importing products from the STC (Sportsheets Trading Company) warehouse CSV feed into the Male Q WooCommerce database.

## Data Source

- **File**: `data/stc-product-feed.csv`
- **Format**: CSV with headers
- **Source**: Shopify-based warehouse feed

## CSV Column Mapping

| STC Column | WooCommerce Field | Notes |
|------------|-------------------|-------|
| Handle | `post_name` (slug) | URL-friendly product slug |
| UPC | `_sku`, `_wt_barcode` | Primary SKU for WooCommerce |
| Product Name | `post_title` | Apply title case normalization |
| Description | `post_content` | Clean HTML, generate excerpt |
| Brand | `product_brand` taxonomy | Map to existing brand terms |
| Price | Calculate from wholesale | Use same multiplier as WT import |
| Category 1/2/3 | `product_cat` taxonomy | Map to existing categories (see below) |
| Features | `_product_attributes`, tags | Parse comma-separated values |
| Functions | `_product_attributes` | e.g., "Warming", "Vibrating" |
| Warranty | `_warranty` meta | skip |
| Water Resistance | `_water_resistance` meta | skip |
| Size | `pa_size` attribute | Parse and normalize |
| Power | `_power` meta | e.g., "Battery", "Rechargeable" |
| Material | `pa_material` attribute | Normalize to existing terms |
| Color | `pa_color` attribute | Normalize to existing terms |
| Image 1/2/3 | `_thumbnail_id`, gallery | Download and optimize |
| Allow Marketplace | `_allow_marketplace` meta | skip |
| Discountable | `_wt_discountable` | skip |
| Weight | `_weight` | In pounds, convert if needed |
| Width | `_width` | In inches |
| Height | `_height` | In inches |
| Length | `_length` | In inches |
| Insertable Length | `_insertable_length` meta | Custom dimension |
| Inner Diameter | `_inner_diameter` meta | Custom dimension |

## Import Rules

### 1. Duplicate SKU Handling

- **Check existing SKUs first** using UPC as the SKU
- If SKU already exists:
  - Update `_product_source` meta to include "stc" if not already present
  - Fill in any missing fields (description, dimensions) but **DO NOT overwrite existing data**
  - Skip products that have identical data

### 2. Category Mapping

STC uses text-based categories that must be mapped to existing WooCommerce category IDs.

#### Category Mapping Table

Review and update this table before importing:

| STC Category | WooCommerce Category | WC ID | Notes |
|-------------|---------------------|-------|-------|
| Women's Lingerie | Lingerie & Clothing | 1555 | Parent category |
| Books | Books, Adult Games & Music | 1556 | |
| Games & Novelty | Party Games, Gifts & Supplies > Adult Party Games | 1673 | |
| Lubricants | Lubricants | 1562 | Parent category |
| Vibrators | Vibrators | 1546 | Parent category |
| Anal Toys | Anal Toys | 1549 | Parent category |
| Bondage | Bondage, Fetish & Kink | 1551 | Parent category |
| Dildos | Dildos & Dongs | 1548 | Parent category |
| Cock Rings | Sextoys for Men > Cock Rings | 1735 | |
| Masturbators | Sextoys for Men > Masturbators | 1581 | |
| Condoms | Condoms | 1557 | Parent category |
| Health & Beauty | Health & Beauty | 1554 | Parent category |
| Massage | Erotic Body Lotions > Massage Lotions & Creams | 1652 | |

**Before import**: Generate a full category match table by running:
```bash
bun scripts/generate-stc-category-mapping.ts
```

#### Category Rules

1. **Match existing categories first** - Never create new categories without approval
2. **Add parent categories automatically** - When assigning a subcategory, also assign all parent categories
3. **Use Features column for subcategory hints** - e.g., "Crotchless" suggests Women's Underwear, "Water-Based" suggests Water-Based lubricants
4. **Notify on unmapped categories** - Log any categories that can't be matched

### 3. Excluded Categories

Do not import products from these categories:

- DVDs / Videos
- Magazines / Comics
- Pills / Sexual Enhancement
- Holiday Items (Christmas, etc.)
- Discontinued items
- Display-only items (counters, stands)
- Samples / Promotional items

### 4. Brand Mapping

Create a brand mapping file at `data/stc-brand-mapping.json`:

```json
{
  "Dreamgirl": "DRM",
  "Pink": "PNK",
  "Sportsheets": "SPS",
  ...
}
```

Map STC brand names to existing manufacturer codes where possible. New brands should be added to the `product_brand` taxonomy.

### 5. Image Handling

#### Image Processing Rules

- Download images from Shopify CDN URLs
- Convert to WebP format (90% quality)
- Place on 650px x 650px white background, centered
- **Do not crop** - maintain aspect ratio
- **Do not stretch** - small images (<650px) keep original size, just centered on white background
- Large images (>650px) shrink to fit within 650x650
- Store in: `/wp-content/uploads/{year}/{month}/`
- Set first image as featured, others as gallery

#### Variable Product Images

For products with variations (e.g., different colors):

1. **Copy all images from PRIMARY (first) variation** to the parent product
   - First image → Parent's featured image
   - Additional images → Parent's gallery
2. **If total images across ALL variations < 7**, also add images from other variations to the gallery
   - This ensures products with few images still have a reasonable gallery
3. **If total images >= 7**, only use primary variation images to avoid mixing different colors/styles
4. Each variation keeps its own featured image for display when selected

### 6. Variation Detection

Apply the same variation detection logic as the Williams Trading import:

- Group by base name + brand + price
- Detect variation type (color, size, flavor, style)
- Create variable products with variations

### 7. Attribute Extraction

Parse the Features column for product attributes:

| Feature Keyword | Attribute/Tag |
|----------------|---------------|
| Crotchless | Feature: Crotchless |
| Water-Based | Lube Type: Water-Based |
| Glycerin Free | Feature: Glycerin Free |
| Warming | Function: Warming |
| Rechargeable | Power: Rechargeable |
| Waterproof | Water Resistance: Waterproof |

## Import Script Usage

### Generate Category Mapping (First Run)

```bash
bun scripts/generate-stc-category-mapping.ts
```

This creates `data/stc-category-mapping.json` for review.

### Dry Run

```bash
bun scripts/import-stc-products.ts --dry-run --limit 100
```

### Full Import

```bash
bun scripts/import-stc-products.ts [options]
```

**Options:**
- `--limit <n>` - Limit number of products to import
- `--skip-images` - Skip image downloads (faster for testing)
- `--dry-run` - Preview what would be imported
- `--no-variations` - Import all as simple products
- `--update-existing` - Update existing products (default: skip)

## Data Files

| File | Purpose |
|------|---------|
| `data/stc-product-feed.csv` | Source product data |
| `data/stc-category-mapping.json` | STC category -> WC category mapping |
| `data/stc-brand-mapping.json` | STC brand -> WC brand mapping |
| `data/stc-import-report.json` | Import results and errors |

## Pre-Import Checklist

- [ ] Download latest STC CSV feed
- [ ] Generate category mapping and review
- [ ] Generate brand mapping and review
- [ ] Run dry-run import to check for issues
- [ ] Review any unmapped categories/brands
- [ ] Confirm excluded categories list
- [ ] Backup database before full import

## Post-Import Tasks

1. **Verify product counts** - Compare expected vs actual
2. **Check category assignments** - Spot check products
3. **Verify images downloaded** - Check for missing images
4. **Test variation products** - Ensure variations work correctly
5. **Run WooCommerce regenerate** - Update product lookups
6. **Clear caches** - Flush WP and CDN caches

## Pricing Configuration

Using the same pricing formula as Williams Trading import:

```typescript
const PRICE_MULTIPLIER = 3;        // Wholesale -> Retail
const SALE_DISCOUNT_PERCENT = 10;  // Sale price discount

function calculatePrices(wholesalePrice: number) {
  const regular = Math.round(wholesalePrice * PRICE_MULTIPLIER * 100) / 100;
  const sale = Math.round(regular * (1 - SALE_DISCOUNT_PERCENT / 100) * 100) / 100;
  return { regular, sale };
}
```

## Product Source Tracking

Each product will have a `_product_source` meta field:

- Products only from Williams Trading: `"wt"`
- Products only from STC: `"stc"`
- Products from both: `"wt,stc"` or `"stc,wt"`

This allows tracking which warehouse(s) carry each product.

## Troubleshooting

### Common Issues

1. **Category not found**: Check `stc-category-mapping.json`, may need manual mapping
2. **Duplicate SKU**: Product exists, use `--update-existing` to update or check for data conflicts
3. **Image download failed**: Check CDN URL validity, may be expired/removed
4. **Brand not mapped**: Add to `stc-brand-mapping.json` or create new brand term

### Logs

Import logs are written to:
- Console output during import
- `data/stc-import-report.json` for detailed results
- `data/stc-import-errors.log` for errors

## Related Files

- `scripts/import-products-direct.ts` - Reference: Williams Trading import script
- `lib/import/xml-parser.ts` - Reference: Product parsing utilities
- `data/category-mapping.json` - Williams Trading category mappings
- `data/manufacturer-mapping.json` - Williams Trading brand mappings
- `data/excluded-product-types.json` - Excluded product type codes
