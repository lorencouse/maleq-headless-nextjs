import { NextRequest, NextResponse } from 'next/server';
import { getBlogPosts } from '@/lib/blog/blog-service';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const after = searchParams.get('after') || undefined;
  const first = parseInt(searchParams.get('first') || '12', 10);
  const category = searchParams.get('category') || undefined;
  const tag = searchParams.get('tag') || undefined;
  const excludeCategories = searchParams.get('excludeCategories') || undefined;

  try {
    const excludeCategorySlugs = excludeCategories
      ? excludeCategories.split(',').map(s => s.trim())
      : undefined;

    const result = await getBlogPosts({
      first,
      after,
      categorySlug: category,
      tagSlug: tag,
      excludeCategorySlugs,
    });

    return NextResponse.json({
      posts: result.posts,
      pageInfo: result.pageInfo,
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch posts' },
      { status: 500 }
    );
  }
}
