import sharp from 'sharp';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';

const TARGET_SIZE = 650;
const PUBLIC_DIR = join(process.cwd(), 'public');
const PRODUCTS_DIR = join(PUBLIC_DIR, 'products');

// Ensure products directory exists
if (!existsSync(PRODUCTS_DIR)) {
  mkdirSync(PRODUCTS_DIR, { recursive: true });
}

export interface ProcessedImageData {
  localPath: string;
  localFileName: string;
  imageAlt: string;
  imageTitle: string;
}

/**
 * Sanitize product name for use in filenames
 */
function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50); // Limit length
}

/**
 * Fetch image from URL and return as buffer
 */
async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Process image: resize to 650x650, add white background, convert to WebP
 */
async function processImage(
  inputBuffer: Buffer,
  outputPath: string
): Promise<void> {
  const image = sharp(inputBuffer);
  const metadata = await image.metadata();

  // Calculate dimensions to fit 650x650 with white background
  let width = metadata.width || TARGET_SIZE;
  let height = metadata.height || TARGET_SIZE;

  // Calculate the scaling factor to fit within 650x650 without cropping
  const scale = Math.min(TARGET_SIZE / width, TARGET_SIZE / height);
  const scaledWidth = Math.round(width * scale);
  const scaledHeight = Math.round(height * scale);

  // Resize image while maintaining aspect ratio
  const resizedImage = await image
    .resize(scaledWidth, scaledHeight, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .toBuffer();

  // Create 650x650 white background and composite the resized image
  await sharp({
    create: {
      width: TARGET_SIZE,
      height: TARGET_SIZE,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .composite([
      {
        input: resizedImage,
        gravity: 'center'
      }
    ])
    .webp({ quality: 85, alphaQuality: 0 }) // No transparency for space efficiency
    .toFile(outputPath);
}

/**
 * Download and process a product image
 */
export async function downloadAndProcessImage(
  imageUrl: string,
  productName: string,
  imageIndex: number
): Promise<ProcessedImageData> {
  try {
    // Generate filename
    const sanitizedName = sanitizeFilename(productName);
    const fileName = `${sanitizedName}-${imageIndex + 1}.webp`;
    const filePath = join(PRODUCTS_DIR, fileName);
    const publicPath = `/products/${fileName}`;

    // Check if file already exists
    if (existsSync(filePath)) {
      return {
        localPath: publicPath,
        localFileName: fileName,
        imageAlt: `${productName} - Image ${imageIndex + 1}`,
        imageTitle: productName,
      };
    }

    // Fetch image
    const imageBuffer = await fetchImageBuffer(imageUrl);

    // Process and save image
    await processImage(imageBuffer, filePath);

    return {
      localPath: publicPath,
      localFileName: fileName,
      imageAlt: `${productName} - Image ${imageIndex + 1}`,
      imageTitle: productName,
    };
  } catch (error) {
    console.error(`Error processing image ${imageUrl}:`, error);
    throw error;
  }
}

/**
 * Process all images for a product
 */
export async function processProductImages(
  images: Array<{ url: string; id: string }>,
  productName: string
): Promise<Map<string, ProcessedImageData>> {
  const results = new Map<string, ProcessedImageData>();

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    try {
      const processedData = await downloadAndProcessImage(
        image.url,
        productName,
        i
      );
      results.set(image.id, processedData);
    } catch (error) {
      console.error(`Failed to process image ${image.id} for ${productName}:`, error);
      // Continue processing other images even if one fails
    }
  }

  return results;
}
