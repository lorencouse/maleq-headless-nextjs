import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/api/admin-auth';
import {
  startWarming,
  stopWarming,
  getWarmingStatus,
  type PageType,
} from '@/lib/utils/cache-warmer';

export const dynamic = 'force-dynamic';

const VALID_TYPES: PageType[] = [
  'blog',
  'blog-category',
  'blog-tag',
  'category',
  'brand',
  'product',
];

export async function POST(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  let types: PageType[] | undefined;
  let concurrency: number | undefined;
  let delayMs: number | undefined;

  try {
    const body = await request.json();
    if (body.types) {
      const requested = body.types as string[];
      const invalid = requested.filter(
        (t) => !VALID_TYPES.includes(t as PageType),
      );
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Invalid types: ${invalid.join(', ')}. Valid: ${VALID_TYPES.join(', ')}` },
          { status: 400 },
        );
      }
      types = requested as PageType[];
    }
    if (typeof body.concurrency === 'number') concurrency = body.concurrency;
    if (typeof body.delayMs === 'number') delayMs = body.delayMs;
  } catch {
    // No body or invalid JSON — use defaults
  }

  const result = startWarming({ types, concurrency, delayMs });

  if (!result.started) {
    return NextResponse.json(
      { error: result.message, status: getWarmingStatus() },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    message: result.message,
  });
}

export async function GET(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  return NextResponse.json(getWarmingStatus());
}

export async function DELETE(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  const result = stopWarming();

  if (!result.stopped) {
    return NextResponse.json(
      { error: result.message },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    message: result.message,
  });
}
