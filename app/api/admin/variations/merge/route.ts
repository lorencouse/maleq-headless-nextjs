import { NextResponse } from 'next/server';
import { autoMergeAllVariations } from '@/lib/products/variation-detector';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await autoMergeAllVariations();

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error merging variations:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
