# Product Images Processing Guide

## Overview

This system automatically fetches, processes, and stores product images locally when a product page is loaded for the first time. All images are optimized for web delivery and SEO.

## Image Processing Features

### Automatic Processing
- Images are fetched and processed **automatically** when a product page loads for the first time
- Processing happens in the background without blocking page load
- Once processed, images are served from your local server (much faster!)

### Image Specifications
- **Size**: 650x650 pixels (1:1 aspect ratio)
- **Format**: WebP (no transparency for space efficiency)
- **Background**: White background added to maintain aspect ratio without cropping
- **Quality**: 85% quality setting for optimal balance

### SEO Optimization
Images include proper metadata for search engines:
- **Alt Text**: `{Product Name} - Image {Number}` (e.g., "Vibrating Ring - Image 1")
- **Title**: `{Product Name}` for all images
- **Filenames**: Sanitized product names (e.g., `vibrating-ring-1.webp`)

## How It Works

### 1. First Load (Unprocessed Images)
```
Product Page Loads
    ↓
Images not processed?
    ↓
Display original URLs (from Williams Trading/WordPress)
    ↓
Background: Fetch → Resize → Add White BG → Convert to WebP → Save
    ↓
Update Database with local paths
```

### 2. Subsequent Loads (Processed Images)
```
Product Page Loads
    ↓
Images already processed?
    ↓
Display local images from /public/products/
    ↓
Super fast! ⚡
```

## File Structure

```
public/
  products/
    .gitkeep                    # Keep directory in git
    product-name-1.webp        # Ignored by git
    product-name-2.webp        # Ignored by git
    another-product-1.webp     # Ignored by git
```

## Database Schema

The `ProductImage` model includes these fields for processed images:

```prisma
model ProductImage {
  // Original fields
  imageUrl  String   // Original URL from Williams Trading
  fileName  String   // Original filename

  // Processed image fields
  localPath     String?   // e.g., /products/product-name-1.webp
  localFileName String?   // e.g., product-name-1.webp
  imageAlt      String?   // e.g., "Product Name - Image 1"
  imageTitle    String?   // e.g., "Product Name"
  isProcessed   Boolean   // true when processing complete
  processedAt   DateTime? // timestamp of processing
}
```

## Image Processing Logic

### Aspect Ratio Handling
The system preserves the original image without cropping:
1. Calculate the scale factor to fit within 650x650
2. Resize image proportionally
3. Create a 650x650 white canvas
4. Center the resized image on the white background

### Example Transforms
- **800x600 image** → Scaled to 650x487 → Centered on 650x650 white canvas
- **400x800 image** → Scaled to 325x650 → Centered on 650x650 white canvas
- **650x650 image** → No scaling needed → Direct output

## Components

### 1. Image Processor (`lib/utils/image-processor.ts`)
- Core image processing logic using Sharp
- Handles fetching, resizing, and WebP conversion
- Creates SEO-friendly filenames

### 2. API Route (`app/api/products/process-images/route.ts`)
- Optional endpoint for manual image processing
- Can be called via POST with `{ productId: "..." }`
- Returns processing status and count

### 3. Product Service (`lib/products/product-service.ts`)
- Checks if images need processing on product load
- Triggers background processing for unprocessed images
- Returns local paths when available, falls back to original URLs

### 4. Image Gallery (`components/product/ProductImageGallery.tsx`)
- Displays images with proper alt and title attributes
- Works seamlessly with both local and remote images

## Manual Processing

If you need to manually trigger image processing for a specific product:

```typescript
// Using the API endpoint
const response = await fetch('/api/products/process-images', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ productId: 'your-product-id' })
});

const result = await response.json();
console.log(`Processed ${result.processed} of ${result.total} images`);
```

## Bulk Processing Script

To process all products at once, you could create a script like:

```typescript
// scripts/process-all-images.ts
import { prisma } from '@/lib/prisma';
import { processProductImages } from '@/lib/utils/image-processor';

async function processAllImages() {
  const products = await prisma.product.findMany({
    include: {
      images: { where: { isProcessed: false } }
    }
  });

  for (const product of products) {
    if (product.images.length > 0) {
      console.log(`Processing ${product.name}...`);
      const imagesToProcess = product.images.map(img => ({
        url: img.imageUrl,
        id: img.id
      }));

      const processed = await processProductImages(imagesToProcess, product.name);

      for (const [imageId, imageData] of processed.entries()) {
        await prisma.productImage.update({
          where: { id: imageId },
          data: {
            localPath: imageData.localPath,
            localFileName: imageData.localFileName,
            imageAlt: imageData.imageAlt,
            imageTitle: imageData.imageTitle,
            isProcessed: true,
            processedAt: new Date()
          }
        });
      }

      console.log(`✓ Processed ${processed.size} images for ${product.name}`);
    }
  }
}

processAllImages();
```

## Performance Benefits

### Before (Remote Images)
- Load time: ~1-2s per image (external server)
- Bandwidth: Varies (unoptimized)
- CDN: Dependent on Williams Trading/WordPress

### After (Local Processed Images)
- Load time: ~50-200ms per image (local server)
- Bandwidth: Optimized WebP (~30-50% smaller)
- CDN: Your infrastructure (can add your own CDN)

## Storage Considerations

- **Average WebP size**: 20-50KB per image
- **1000 products × 3 images**: ~60-150MB total
- **10000 products × 3 images**: ~600MB-1.5GB total

Images are stored in `/public/products/` and ignored by git to keep your repository clean.

## Troubleshooting

### Images not processing?
1. Check console for errors
2. Verify `public/products/` directory exists and is writable
3. Check database `isProcessed` flag: `SELECT * FROM "ProductImage" WHERE "isProcessed" = false`

### Processing is slow?
- Background processing is intentional to avoid blocking page loads
- For bulk processing, use the manual script above

### Want to reprocess an image?
```sql
-- Reset processed flag for a specific product
UPDATE "ProductImage"
SET "isProcessed" = false, "localPath" = null, "processedAt" = null
WHERE "productId" = 'your-product-id';
```

## Environment Variables

No additional environment variables needed! The system uses existing configuration:
- `DATABASE_URL` - Already configured
- `WILLIAMS_TRADING_IMAGE_BASE` - Already configured

## Next Steps

1. ✅ Schema updated with processed image fields
2. ✅ Image processing utilities created
3. ✅ Auto-processing on product load enabled
4. ✅ SEO metadata included (alt, title)
5. ✅ WebP conversion for efficiency
6. ⏭️ Optional: Create bulk processing script
7. ⏭️ Optional: Add image optimization monitoring
8. ⏭️ Optional: Set up CDN for processed images
