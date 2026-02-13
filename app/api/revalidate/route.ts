import { revalidatePath, revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

// Webhook endpoint for WordPress to trigger revalidation
// Configure in WordPress: Settings > Webhooks or use a plugin like WP Webhooks
export async function POST(request: NextRequest) {
  // Verify the secret token (header only)
  const secret = request.headers.get('x-revalidation-secret');
  const expected = process.env.REVALIDATION_SECRET;

  if (!secret || !expected || secret.length !== expected.length ||
      !timingSafeEqual(Buffer.from(secret), Buffer.from(expected))) {
    return NextResponse.json({ message: 'Invalid token' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { type, slug } = body;

    // Revalidate based on content type
    switch (type) {
      case 'post':
        if (slug) {
          revalidatePath(`/guides/${slug}`);
          revalidatePath('/guides');
        } else {
          revalidatePath('/guides');
        }
        break;

      case 'product':

        if (slug) {
          revalidatePath(`/product/${slug}`);
          revalidatePath('/shop');
        } else {
          revalidatePath('/shop');
        }
        revalidateTag('categories');
        revalidateTag('brands');
        revalidateTag('attributes');
        break;

      case 'all':

        revalidatePath('/', 'layout');
        revalidateTag('categories');
        revalidateTag('brands');
        revalidateTag('attributes');
        break;

      default:
        return NextResponse.json(
          { message: 'Invalid revalidation type' },
          { status: 400 }
        );
    }

    return NextResponse.json({
      revalidated: true,
      type,
      slug: slug || 'all',
      now: Date.now(),
    });
  } catch (err) {
    return NextResponse.json(
      { message: 'Error revalidating', error: err },
      { status: 500 }
    );
  }
}
