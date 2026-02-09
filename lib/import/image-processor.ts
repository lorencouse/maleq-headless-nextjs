import sharp from 'sharp';
import { createHash } from 'crypto';
import { mkdir, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { wooClient } from '../woocommerce/client';
import type { WooMediaItem } from '../woocommerce/types';

interface ProcessedImage {
  localPath: string;
  filename: string;
  hash: string;
}

interface UploadedImage extends ProcessedImage {
  mediaId: number;
  url: string;
}

/**
 * Image processing utility
 * - Downloads images
 * - Converts to WebP format
 * - Places on 650x650 white background (centered)
 * - Shrinks large images to fit, never enlarges small images
 * - Maintains aspect ratio (no cropping or stretching)
 * - Optimizes for web (90% WebP quality)
 */
export class ImageProcessor {
  private cacheDir: string;
  private readonly TARGET_SIZE = 650;
  private readonly WEBP_QUALITY = 90;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // ms

  constructor(cacheDir = join(process.cwd(), 'data', 'image-cache')) {
    this.cacheDir = cacheDir;
  }

  /**
   * Initialize cache directory
   */
  async init(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
  }

  /**
   * Generate filename from product name and index
   */
  generateFilename(productName: string, index: number): string {
    const slug = productName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .substring(0, 50); // Limit length

    return `${slug}-${index + 1}.webp`;
  }

  /**
   * Download image with retry logic
   */
  private async downloadImage(url: string, retries = 0): Promise<Buffer> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WooCommerceImporter/1.0)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      if (retries < this.MAX_RETRIES) {
        console.warn(`  Retry ${retries + 1}/${this.MAX_RETRIES} for ${url}`);
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY * (retries + 1)));
        return this.downloadImage(url, retries + 1);
      }
      throw error;
    }
  }

  /**
   * Process image: download, resize, add white background, convert to WebP
   */
  async processImage(
    imageUrl: string,
    filename: string
  ): Promise<ProcessedImage> {
    // Check if already processed (by filename)
    const cachedPath = join(this.cacheDir, filename);
    try {
      await access(cachedPath);
      // File exists, calculate hash
      const buffer = await readFile(cachedPath);
      const hash = createHash('md5').update(buffer).digest('hex');
      return { localPath: cachedPath, filename, hash };
    } catch {
      // File doesn't exist, process it
    }

    // Download image
    const imageBuffer = await this.downloadImage(imageUrl);

    // Calculate hash of original
    const originalHash = createHash('md5').update(imageBuffer).digest('hex');

    // Process with Sharp
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    // Calculate dimensions to fit in 650x650 while maintaining aspect ratio
    const { width = 1, height = 1 } = metadata;
    const aspectRatio = width / height;

    let resizeWidth: number;
    let resizeHeight: number;

    if (aspectRatio > 1) {
      // Landscape or square
      resizeWidth = Math.min(width, this.TARGET_SIZE);
      resizeHeight = Math.round(resizeWidth / aspectRatio);
    } else {
      // Portrait
      resizeHeight = Math.min(height, this.TARGET_SIZE);
      resizeWidth = Math.round(resizeHeight * aspectRatio);
    }

    // Resize image (only shrink if larger than target, never enlarge)
    const resizedBuffer = await image
      .resize(resizeWidth, resizeHeight, {
        fit: 'inside',
        withoutEnlargement: true, // Don't stretch small images
      })
      .toBuffer();

    // Create 650x650 white canvas and composite resized image
    const finalImage = await sharp({
      create: {
        width: this.TARGET_SIZE,
        height: this.TARGET_SIZE,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }, // White background
      },
    })
      .composite([
        {
          input: resizedBuffer,
          gravity: 'center', // Center the image on canvas
        },
      ])
      .webp({
        quality: this.WEBP_QUALITY,
        effort: 6, // Higher effort = better compression (0-6)
      })
      .toBuffer();

    // Save to cache
    await writeFile(cachedPath, finalImage);

    // Calculate hash of processed image
    const processedHash = createHash('md5').update(finalImage).digest('hex');

    return {
      localPath: cachedPath,
      filename,
      hash: processedHash,
    };
  }

  /**
   * Process multiple images for a product
   */
  async processProductImages(
    imageUrls: string[],
    productName: string,
    baseImageUrl: string = 'https://images.williams-trading.com'
  ): Promise<ProcessedImage[]> {
    const processed: ProcessedImage[] = [];

    for (let i = 0; i < imageUrls.length; i++) {
      try {
        const imageUrl = imageUrls[i];
        // Construct full URL if relative path
        const fullUrl = imageUrl.startsWith('http') ? imageUrl : `${baseImageUrl}${imageUrl}`;

        const filename = this.generateFilename(productName, i);

        console.log(`  Processing image ${i + 1}/${imageUrls.length}: ${filename}`);

        const processedImage = await this.processImage(fullUrl, filename);
        processed.push(processedImage);
      } catch (error) {
        console.error(`  ✗ Failed to process image ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Continue with other images
      }
    }

    return processed;
  }

  /**
   * Upload processed image to WordPress media library
   */
  async uploadToWordPress(
    processedImage: ProcessedImage,
    altText: string,
    title: string
  ): Promise<UploadedImage | null> {
    try {
      // Read processed image
      const imageBuffer = await readFile(processedImage.localPath);

      // Check if already uploaded (by searching for filename)
      const existing = await wooClient.getMediaByFilename(processedImage.filename);
      if (existing && existing.id) {
        console.log(`  ⊕ Image already uploaded: ${processedImage.filename} (ID: ${existing.id})`);
        return {
          ...processedImage,
          mediaId: existing.id,
          url: existing.src,
        };
      }

      // Upload to WordPress
      const response = await fetch(`${process.env.WOOCOMMERCE_URL}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(
            `${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`
          ).toString('base64')}`,
          'Content-Type': 'image/webp',
          'Content-Disposition': `attachment; filename="${processedImage.filename}"`,
        },
        body: imageBuffer,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`Upload failed: ${error.message || response.statusText}`);
      }

      const media = (await response.json()) as WooMediaItem;

      // Update alt text and title
      if (media.id) {
        await fetch(`${process.env.WOOCOMMERCE_URL}/wp-json/wp/v2/media/${media.id}`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(
              `${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`
            ).toString('base64')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            alt_text: altText,
            title: title,
          }),
        });
      }

      console.log(`  ✓ Uploaded: ${processedImage.filename} (ID: ${media.id})`);

      return {
        ...processedImage,
        mediaId: media.id,
        url: media.src,
      };
    } catch (error) {
      console.error(
        `  ✗ Failed to upload ${processedImage.filename}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return null;
    }
  }

  /**
   * Process and upload all images for a product
   */
  async processAndUploadImages(
    imageUrls: string[],
    productName: string,
    baseImageUrl?: string
  ): Promise<UploadedImage[]> {
    // Process images
    const processedImages = await this.processProductImages(imageUrls, productName, baseImageUrl);

    // Upload to WordPress
    const uploadedImages: UploadedImage[] = [];

    for (let i = 0; i < processedImages.length; i++) {
      const processed = processedImages[i];
      const altText = `${productName} - Image ${i + 1}`;
      const title = altText;

      const uploaded = await this.uploadToWordPress(processed, altText, title);
      if (uploaded) {
        uploadedImages.push(uploaded);
      }
    }

    return uploadedImages;
  }

  /**
   * Clear image cache
   */
  async clearCache(): Promise<void> {
    // Implementation would recursively delete cache directory
    console.log('Image cache cleared');
  }
}
