import { NextResponse } from 'next/server';
import { detectProductVariations } from '@/lib/products/variation-detector';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const groups = await detectProductVariations();

    return NextResponse.json({
      success: true,
      groupsFound: groups.length,
      groups: groups.map(group => ({
        baseName: group.baseName,
        baseSkuPattern: group.baseSkuPattern,
        productCount: group.products.length,
        products: group.products.map(p => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          price: p.price?.toString(),
          stockStatus: p.stockStatus,
        })),
        attributes: Array.from(group.detectedAttributes.entries()).map(([name, values]) => ({
          name,
          values: Array.from(values),
        })),
      })),
    });
  } catch (error) {
    console.error('Error detecting variations:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
