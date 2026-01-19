# Product Import Parameters

This document defines the specifications and requirements for importing products from the Williams Trading XML data into WooCommerce.

## Core Import Settings

### Product Identification
- **SKU Source**: Use `<barcode>` (UPC) as the primary product SKU
- **Duplicate Detection**: Check for existing products by UPC/SKU before import
- **Variation Handling**: Auto-detect and merge products with similar names/attributes into variable products

### Pricing Strategy
- **Regular Price**: 3x the Williams Trading `<price>` value
  - Example: WT price $8.90 → Regular price $26.70
- **Sale Price**: 10% discount off regular price (90% of regular price)
  - Example: Regular $26.70 → Sale $24.03
- **Price Rounding**: Round to 2 decimal places
- **Currency**: USD

### Taxonomy Setup Priority
1. **Manufacturers** (from `data/manufacturers.json`)
   - Create custom taxonomy: `pa_manufacturer`
   - Only import active manufacturers (`active: "1"`)
   - Use manufacturer code for slug generation
   - Store manufacturer code in product meta for reference

2. **Categories** (from XML `<categories>`)
   - Maintain parent-child hierarchy
   - Map category codes to WooCommerce term IDs
   - Support multiple categories per product

3. **Product Types** (from XML `<type>`)
   - Consider as secondary taxonomy or product attribute

## Image Processing Requirements

### Image Specifications
- **Format**: WebP (convert from JPG/PNG)
- **Dimensions**: 650px × 650px (1:1 aspect ratio)
- **Background**: White (#FFFFFF)
- **Transparency**: None (fill with white background)
- **Quality**: 90% WebP quality for optimal file size

### Image Handling Rules
- **Aspect Ratio Preservation**: Do NOT crop images
  - For non-square images, overlay on 650×650 white canvas
  - Center the image on the canvas
  - Maintain original aspect ratio
- **Image Priority**:
  1. First image in XML → Featured/thumbnail image
  2. Additional images → Product gallery
- **Image Optimization**:
  - Compress all images
  - Strip EXIF data
  - Progressive/optimized encoding

### Variable Product Image Rules
- **First Variation**:
  - Download ALL images from the first variation's source product
  - First image → Parent product featured image
  - Additional images → Parent product gallery
- **Other Variations**:
  - Download ONLY the first image from each variation's source product
  - Set as the variation's featured image
- **Image Linking**: Images are linked by matching product SKU to XML product

### Simple Product Image Rules
- Download and process ALL images from the XML product
- First image → Product featured image
- Additional images → Product gallery

### Image SEO
- **File Naming**: `{product-name-slug}-{number}.webp`
  - Example: `aloe-cadabra-natural-lube-1.webp`
- **Alt Text**: `{Product Name} - Image {number}`
  - Example: "Aloe Cadabra Natural Lube - Image 1"
- **Title Text**: Same as alt text
- **Image Captions**: Optional, use product short description

## Text & SEO Optimization

### Title Formatting (Title Case)
- **Capitalize**: First letter of major words
- **Lowercase**: Articles, conjunctions, prepositions (unless first word)
  - Lowercase: the, a, an, and, but, or, for, nor, on, at, to, from, by, of, in, with
  - Example: "Aloe Cadabra Organic Lube Natural Aloe 2.5 oz"

### Product Name/Title
- **Source**: XML `<name>` field
- **Processing**:
  - Apply title case formatting
  - Remove excessive whitespace
  - Remove trailing periods
  - Remove "RESTRICTED" or similar flags
  - Max length: 200 characters

### Product Slug
- **Generation**: Auto-generate from product name
- **Format**: lowercase, hyphen-separated
- **Uniqueness**: Append number if duplicate exists
- **Max Length**: 200 characters

### Description Processing
- **Full Description**: XML `<description>` → wp_posts.post_content
  - Clean HTML entities
  - Remove excessive line breaks
  - Convert to proper HTML paragraphs
  - Remove "2024", "2025" year markers at end

- **Short Description**: Auto-generate from description
  - Extract first 2-3 sentences (max 160 characters)
  - Or use first paragraph if under 200 characters
  - Ensure complete sentences

### Meta Description (SEO)
- **Length**: 150-160 characters
- **Format**: "{Product Name} - {Key Features}. Buy now at {Store Name}."
- **Source**: Derive from short description or product attributes

### Product Attributes for SEO
- **Color**: XML `<color>` → Product attribute
- **Material**: XML `<material>` → Product attribute
- **Dimensions**: Height, Length, Width → Product specs
- **Weight**: XML `<weight>` → Product specs

## Variation Detection & Merging

### Auto-Variation Rules
Products should be merged into variations if they share:
1. **Base Name Match** (remove size/color/flavor indicators)
   - Example: "Aloe Cadabra Organic Lube [NATURAL|PINA COLADA|MANGO]"
2. **Same Manufacturer Code**
3. **Same Product Type Code**
4. **Different Attributes**:
   - Color
   - Flavor/Scent
   - Size (oz, ml)

### Variation Attributes
- **Primary Variation Attributes**:
  - Color (if different)
  - Flavor/Scent (if different)
  - Size (if different)
- **Variation Naming**: Use attribute value (e.g., "Natural Aloe", "Pina Colada")
- **Variation SKUs**: Keep individual UPC codes
- **Variation Images**: Assign specific images to each variation when available

### Variable Product Structure
- **Parent Product**:
  - Name: Base name without variant indicators
  - SKU: Lowest variation SKU or leave empty
  - Price: Lowest variation price (for display)
  - Stock: Sum of all variation stock

- **Child Variations**:
  - Individual SKU (UPC)
  - Individual pricing
  - Individual stock quantities
  - Individual images where applicable

## Additional SEO Best Practices

### On-Page SEO
- **Focus Keyword**: Derive from product name and category
  - Example: "Aloe Cadabra Natural Lube"
- **Related Products**: Auto-link products from same manufacturer/category
- **Product Schema Markup**: Include structured data
  - Price
  - Availability
  - SKU
  - Brand (manufacturer)
  - Images
  - Reviews (when available)

### URL Structure
- **Product URLs**: `/shop/product/{slug}/`
- **Category URLs**: `/shop/category/{category-slug}/`
- **Manufacturer URLs**: `/shop/brand/{manufacturer-slug}/`

### Internal Linking
- Link to manufacturer/brand page
- Link to parent category and subcategories
- Cross-link related products (same category/manufacturer)

### Performance Optimization
- **Lazy Load Images**: Enable for gallery images
- **Image CDN**: Serve images from CDN if available
- **Caching**: Enable product page caching

## Data Validation & Quality Control

### Pre-Import Validation
- ✅ Verify all images are accessible
- ✅ Check for duplicate SKUs/UPCs
- ✅ Validate price fields are numeric
- ✅ Ensure stock quantities are integers
- ✅ Validate category codes exist
- ✅ Validate manufacturer codes exist

### Import Logging
- Log all created products (ID, SKU, name)
- Log all errors and skipped products
- Log image processing results
- Log variation merges
- Generate import summary report

### Post-Import Quality Checks
- ✅ Verify all images loaded correctly
- ✅ Check featured images are set
- ✅ Validate prices are calculated correctly
- ✅ Ensure variations are properly linked
- ✅ Test product URLs and slugs
- ✅ Verify category assignments
- ✅ Check stock status displays correctly

## Stock Management

### Stock Settings
- **Manage Stock**: Enable for all products
- **Stock Status**:
  - `stock_quantity > 0` → "instock"
  - `stock_quantity <= 0` → "outofstock"
- **Backorders**: Not allowed ("no")
- **Low Stock Threshold**: 3 units

### Stock Display
- Show remaining quantity on product page
- Display "Only X left in stock" when quantity < 5

## Product Status & Visibility

### Publication Status
- **Active Products** (`active="1"`): Status = "publish"
- **Inactive Products** (`active="0"`): Status = "draft"
- **On Sale** (`on_sale="1"`): Set sale price, add to sale category

### Catalog Visibility
- **Default**: "visible" (shop and search)
- **Out of Stock**: Keep visible but marked as "Out of Stock"

## Additional Product Meta

### Custom Meta Fields to Store
```php
_wt_sku              // Original Williams Trading SKU
_wt_barcode          // UPC/Barcode
_wt_manufacturer_code // Manufacturer code
_wt_product_type_code // Product type code
_wt_release_date     // Original release date
_wt_color            // Color attribute
_wt_material         // Material attribute
_wt_discountable     // Discount eligibility flag
_wt_active           // Original active status
_wt_on_sale          // Original on_sale flag
_wt_last_synced      // Last sync timestamp
```

## Import Process Order

1. **Setup Phase**
   - Create/verify manufacturer taxonomy
   - Import all manufacturers from JSON
   - Create/verify category taxonomy
   - Parse and create all categories from XML
   - Create category code → term ID mapping

2. **Product Processing Phase**
   - Parse all products from XML
   - Group potential variations
   - Process images (download, convert, resize, optimize)
   - Upload images to WordPress media library

3. **Product Import Phase**
   - Import simple products
   - Create variable products from grouped variations
   - Assign categories and taxonomies
   - Set featured and gallery images
   - Calculate and set prices

4. **Validation Phase**
   - Run quality checks
   - Generate import report
   - Fix any issues found

5. **Post-Import Optimization**
   - Regenerate product thumbnails
   - Clear WooCommerce caches
   - Update product counts for categories
   - Build product search index

## Error Handling

### Skip Product If:
- Missing required fields (name, SKU/barcode, price)
- Invalid image URLs (404 errors)
- Duplicate SKU/barcode conflicts
- Invalid category or manufacturer codes

### Retry Logic
- Image downloads: 3 retries with exponential backoff
- API calls to WooCommerce: 2 retries
- Database operations: No retry (log and skip)

## Import Performance

### Batch Processing
- **Batch Size**: 50 products per batch
- **Images**: Process 10 images concurrently
- **Rate Limiting**: Respect WooCommerce API rate limits
- **Memory Management**: Clear image buffers after processing

### Progress Tracking
- Display progress bar/percentage
- Estimate remaining time
- Show current product being processed

## Notes

- All monetary values in USD
- All measurements in inches (length, width, height) and pounds (weight)
- All dates in ISO 8601 format (YYYY-MM-DD)
- Character encoding: UTF-8
- HTML entities should be decoded properly from CDATA sections
