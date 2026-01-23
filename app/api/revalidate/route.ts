import { revalidatePath, revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

// Webhook endpoint for WordPress to trigger revalidation
// Configure in WordPress: Settings > Webhooks or use a plugin like WP Webhooks
export async function POST(request: NextRequest) {
  // Verify the secret token
  const secret = request.nextUrl.searchParams.get('secret');

  if (secret !== process.env.REVALIDATION_SECRET) {
    return NextResponse.json({ message: 'Invalid token' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { type, slug } = body;

    // Revalidate based on content type
    switch (type) {
      case 'post':
        if (slug) {
          revalidatePath(`/blog/${slug}`);
          revalidatePath('/blog');
        } else {
          revalidatePath('/blog');
        }
        break;

      case 'product':
        if (slug) {
          revalidatePath(`/product/${slug}`);
          revalidatePath('/shop');
        } else {
          revalidatePath('/shop');
        }
        break;

      case 'all':
        revalidatePath('/', 'layout');
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
