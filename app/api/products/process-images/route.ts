import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { processProductImages } from '@/lib/utils/image-processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Process images for a product
 * This endpoint is called when a product page is loaded for the first time
 */
export async function POST(request: NextRequest) {
  try {
    const { productId } = await request.json();

    if (!productId) {
      return NextResponse.json(
        { error: 'Product ID is required' },
        { status: 400 }
      );
    }

    // Get product with images
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        images: {
          where: { isProcessed: false },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    // Check if there are images to process
    if (!product.images || product.images.length === 0) {
      return NextResponse.json({
        message: 'No images to process',
        processed: 0,
      });
    }

    // Process images
    const imagesToProcess = product.images.map(img => ({
      url: img.imageUrl,
      id: img.id,
    }));

    const processedImages = await processProductImages(
      imagesToProcess,
      product.name
    );

    // Update database with processed image data
    let processedCount = 0;
    for (const [imageId, imageData] of processedImages.entries()) {
      await prisma.productImage.update({
        where: { id: imageId },
        data: {
          localPath: imageData.localPath,
          localFileName: imageData.localFileName,
          imageAlt: imageData.imageAlt,
          imageTitle: imageData.imageTitle,
          isProcessed: true,
          processedAt: new Date(),
        },
      });
      processedCount++;
    }

    return NextResponse.json({
      message: 'Images processed successfully',
      processed: processedCount,
      total: product.images.length,
    });
  } catch (error) {
    console.error('Error processing product images:', error);
    return NextResponse.json(
      { error: 'Failed to process images', details: String(error) },
      { status: 500 }
    );
  }
}
