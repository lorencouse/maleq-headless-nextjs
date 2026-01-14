# Product Page Customization Guide

This guide explains how to customize product pages to display dynamic data from the Williams Trading warehouse API.

## Overview

Your product pages now support rich, dynamic data from both WordPress and Williams Trading warehouse:

- **Product Images** - Full gallery with thumbnails
- **Product Specifications** - Automatically extracted from API data
- **Dimensions & Weight** - Physical product details
- **Stock Information** - Real-time availability
- **Raw API Data** - Access to all original fields (dev mode only)

## Files Structure

```
app/shop/product/[slug]/
  └── page.tsx                    # Main product page

lib/products/
  ├── product-service.ts          # Product data fetching & spec extraction
  └── combined-service.ts         # Unified product interface

components/product/
  ├── ProductImageGallery.tsx     # Image gallery component
  ├── ProductSpecifications.tsx   # Specs table component
  └── RawDataDebug.tsx           # Raw API data viewer (dev only)
```

## Accessing Raw API Data

All products store their original API response in the `rawData` field. You can access this data to display custom fields.

### In Development Mode

The raw API data is automatically displayed at the bottom of product pages in development mode. Click to expand and view all available fields.

### Programmatically

The `EnhancedProduct` type includes:
- `rawApiData` - Parsed JSON object with all API fields
- `specifications` - Pre-extracted key specs
- `dimensions` - Physical dimensions object

## Adding Custom Product Fields

### Step 1: Update Specification Extraction

Edit [lib/products/product-service.ts:28](lib/products/product-service.ts#L28) and add your custom fields:

```typescript
function extractSpecifications(product: any): ProductSpecification[] {
  const specs: ProductSpecification[] = [];

  // ... existing specs ...

  // Add your custom fields here
  if (rawData) {
    // Example: Add color field
    if (rawData.color) {
      specs.push({ label: 'Color', value: rawData.color });
    }

    // Example: Add material field
    if (rawData.material) {
      specs.push({ label: 'Material', value: rawData.material });
    }

    // Example: Add multiple features
    if (rawData.features && Array.isArray(rawData.features)) {
      specs.push({
        label: 'Features',
        value: rawData.features.join(', ')
      });
    }

    // Example: Add custom field with formatting
    if (rawData.battery_life) {
      specs.push({
        label: 'Battery Life',
        value: `${rawData.battery_life} hours`
      });
    }
  }

  return specs;
}
```

### Step 2: Add Custom Sections to Product Page

Edit [app/shop/product/[slug]/page.tsx:233](app/shop/product/[slug]/page.tsx#L233) to add custom display sections:

```typescript
{/* Custom: Power Features */}
{product.rawApiData?.power_source && (
  <div className="mt-8 border-t border-gray-200 pt-8">
    <h2 className="text-2xl font-bold text-gray-900 mb-4">Power Information</h2>
    <div className="bg-gray-50 rounded-lg p-6">
      <p className="text-gray-700">
        <span className="font-semibold">Power Source:</span> {product.rawApiData.power_source}
      </p>
      {product.rawApiData.battery_life && (
        <p className="text-gray-700 mt-2">
          <span className="font-semibold">Battery Life:</span> {product.rawApiData.battery_life} hours
        </p>
      )}
    </div>
  </div>
)}

{/* Custom: Materials */}
{product.rawApiData?.materials && (
  <div className="mt-8">
    <h3 className="text-xl font-bold text-gray-900 mb-4">Materials</h3>
    <ul className="list-disc list-inside space-y-2 text-gray-700">
      {product.rawApiData.materials.map((material: string, index: number) => (
        <li key={index}>{material}</li>
      ))}
    </ul>
  </div>
)}
```

## Common Williams Trading API Fields

Based on the API documentation, here are common fields you might find in `rawData`:

### Basic Fields
- `sku` - Product SKU
- `name` - Product name
- `description` - Full description
- `short_description` - Brief description

### Pricing
- `price` - Wholesale price
- `retail_price` - MSRP
- `sale_price` - Sale price (if on sale)
- `on_sale` - '1' or '0'

### Physical Attributes
- `length`, `width`, `height` - Dimensions in inches
- `weight` - Weight in pounds
- `color` - Product color
- `material` - Product material

### Product Information
- `manufacturer_code` - Brand code
- `manufacturer_sku` - Brand's SKU
- `product_type_code` - Category code
- `upc_code` - UPC barcode
- `release_date` - Product release date

### Stock
- `stock_quantity` - Available quantity
- `active` - '1' if active, '0' if discontinued

### Additional Fields
Many products have additional custom fields like:
- `power_source` - Battery, USB, etc.
- `features` - Array of feature strings
- `certifications` - Safety certifications
- `warranty` - Warranty information

**Note:** Fields vary by product type. Always check `rawData` in dev mode to see available fields.

## Example: Adding a "Key Features" Section

Here's a complete example of adding a custom features section:

### 1. Extract features in product-service.ts:

```typescript
// In extractSpecifications function
if (rawData?.features) {
  const features = Array.isArray(rawData.features)
    ? rawData.features
    : rawData.features.split(',').map((f: string) => f.trim());

  specs.push({
    label: 'Key Features',
    value: features.join(' • ')
  });
}
```

### 2. Display in product page:

```typescript
{/* Key Features Section */}
{product.rawApiData?.features && (
  <div className="mt-8 border-t border-gray-200 pt-8">
    <h2 className="text-2xl font-bold text-gray-900 mb-4">Key Features</h2>
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {(Array.isArray(product.rawApiData.features)
        ? product.rawApiData.features
        : product.rawApiData.features.split(',')
      ).map((feature: string, index: number) => (
        <li key={index} className="flex items-start gap-3">
          <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span className="text-gray-700">{feature.trim()}</span>
        </li>
      ))}
    </ul>
  </div>
)}
```

## Customizing the Specifications Table

The specifications table is generated from the `specifications` array. You can customize which specs appear and their order.

### Change Spec Order

In [lib/products/product-service.ts:28](lib/products/product-service.ts#L28):

```typescript
function extractSpecifications(product: any): ProductSpecification[] {
  const specs: ProductSpecification[] = [];

  // Add specs in your preferred order
  // 1. Most important first
  if (product.manufacturer) {
    specs.push({ label: 'Brand', value: product.manufacturer.name });
  }

  // 2. Then technical details
  if (product.dimensions) {
    // ... dimensions
  }

  // 3. Then meta information
  if (product.sku) {
    specs.push({ label: 'SKU', value: product.sku });
  }

  return specs;
}
```

### Conditional Specs by Category

Show different specs based on product category:

```typescript
// Show power info only for electronic products
if (product.productType?.code === 'ELECTRONICS') {
  if (rawData?.power_source) {
    specs.push({ label: 'Power Source', value: rawData.power_source });
  }
}

// Show fabric info only for apparel
if (product.productType?.code === 'APPAREL') {
  if (rawData?.fabric) {
    specs.push({ label: 'Fabric', value: rawData.fabric });
  }
}
```

## Styling Customization

### Change Specification Table Style

Edit [components/product/ProductSpecifications.tsx:10](components/product/ProductSpecifications.tsx#L10):

```typescript
// Current: 2-column grid with gray background
<dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">

// Option 1: Single column list
<dl className="space-y-4">

// Option 2: 3-column grid
<dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">

// Option 3: Compact table style
<table className="w-full">
  <tbody>
    {specifications.map((spec, index) => (
      <tr key={index} className="border-b">
        <td className="py-3 font-semibold">{spec.label}</td>
        <td className="py-3">{spec.value}</td>
      </tr>
    ))}
  </tbody>
</table>
```

### Change Gallery Style

Edit [components/product/ProductImageGallery.tsx:36](components/product/ProductImageGallery.tsx#L36):

```typescript
// Current: 4-column thumbnail grid
<div className="grid grid-cols-4 gap-4">

// Option 1: 5-column grid for more thumbnails
<div className="grid grid-cols-5 gap-3">

// Option 2: Horizontal scrolling carousel
<div className="flex gap-4 overflow-x-auto pb-4">

// Option 3: Vertical sidebar
<div className="flex gap-4">
  <div className="flex flex-col gap-4 w-24">
    {/* thumbnails */}
  </div>
  <div className="flex-1">
    {/* main image */}
  </div>
</div>
```

## Adding Interactive Features

### Image Zoom on Click

Edit [components/product/ProductImageGallery.tsx](components/product/ProductImageGallery.tsx):

```typescript
'use client';

import { useState } from 'react';

export default function ProductImageGallery({ images, productName }: Props) {
  const [isZoomed, setIsZoomed] = useState(false);

  return (
    <>
      <div
        className="relative aspect-square rounded-lg overflow-hidden cursor-zoom-in"
        onClick={() => setIsZoomed(true)}
      >
        {/* image */}
      </div>

      {/* Zoom Modal */}
      {isZoomed && (
        <div
          className="fixed inset-0 z-50 bg-black bg-opacity-90 flex items-center justify-center p-4"
          onClick={() => setIsZoomed(false)}
        >
          <Image
            src={selectedImage.url}
            alt={selectedImage.altText}
            width={1200}
            height={1200}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      )}
    </>
  );
}
```

### Share Button

Add to product page:

```typescript
{/* Share Section */}
<div className="mt-6 flex gap-3">
  <button
    onClick={() => {
      navigator.share({
        title: product.name,
        text: product.shortDescription || '',
        url: window.location.href,
      });
    }}
    className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
  >
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
    </svg>
    Share
  </button>
</div>
```

## Testing Your Changes

### 1. View in Development Mode

```bash
~/.bun/bin/bun dev
```

Visit: http://localhost:3000/shop

### 2. Check Raw Data

In development mode, scroll to bottom of any product page to see "Raw API Data" section. This shows all available fields.

### 3. Test with Different Products

Test with products from both sources:
- WordPress products (purple badge)
- Williams Trading products (blue badge)

## Production Considerations

### Performance

- Raw API data viewer only shows in development mode
- Specifications are cached with product data
- Images are optimized via Next.js Image component

### SEO

Add metadata to product pages:

```typescript
// In app/shop/product/[slug]/page.tsx
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) return {};

  return {
    title: product.name,
    description: product.shortDescription || product.description,
    openGraph: {
      images: [product.image?.url].filter(Boolean),
    },
  };
}
```

### Error Handling

The product page handles missing data gracefully:
- Falls back to placeholder if no images
- Hides sections if data not available
- Shows "N/A" for missing prices

## Examples

See these files for complete examples:
- [lib/products/product-service.ts](lib/products/product-service.ts) - Spec extraction
- [app/shop/product/[slug]/page.tsx](app/shop/product/[slug]/page.tsx) - Product display
- [components/product/](components/product/) - Reusable components

## Need Help?

Check the raw API data in development mode to see what fields are available for your products. Every product from Williams Trading includes the complete API response in the `rawData` field.
