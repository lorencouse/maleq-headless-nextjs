import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Get image processing status for all products or a specific product
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');

    if (productId) {
      // Get status for a specific product
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          images: {
            select: {
              id: true,
              fileName: true,
              isProcessed: true,
              processedAt: true,
              localPath: true,
            },
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

      return NextResponse.json({
        productId: product.id,
        productName: product.name,
        totalImages: product.images.length,
        processedImages: product.images.filter(img => img.isProcessed).length,
        unprocessedImages: product.images.filter(img => !img.isProcessed).length,
        images: product.images,
      });
    } else {
      // Get overall statistics
      const totalImages = await prisma.productImage.count();
      const processedImages = await prisma.productImage.count({
        where: { isProcessed: true },
      });
      const unprocessedImages = await prisma.productImage.count({
        where: { isProcessed: false },
      });

      // Get products with unprocessed images
      const productsWithUnprocessedImages = await prisma.product.findMany({
        where: {
          images: {
            some: { isProcessed: false },
          },
        },
        select: {
          id: true,
          name: true,
          sku: true,
          _count: {
            select: {
              images: true,
            },
          },
        },
        take: 20, // Limit to first 20 products
      });

      return NextResponse.json({
        overview: {
          totalImages,
          processedImages,
          unprocessedImages,
          percentProcessed: totalImages > 0
            ? Math.round((processedImages / totalImages) * 100)
            : 0,
        },
        productsNeedingProcessing: productsWithUnprocessedImages.length,
        sampleProducts: productsWithUnprocessedImages,
      });
    }
  } catch (error) {
    console.error('Error fetching image status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch image status', details: String(error) },
      { status: 500 }
    );
  }
}
