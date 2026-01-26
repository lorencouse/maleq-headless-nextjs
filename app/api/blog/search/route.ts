import { NextRequest, NextResponse } from 'next/server';
import { getBlogSearchSuggestions } from '@/lib/blog/blog-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || '';
    const limit = parseInt(searchParams.get('limit') || '5', 10);

    if (!query || query.length < 2) {
      return NextResponse.json({
        posts: [],
        categories: [],
      });
    }

    const { posts, categories, suggestions } = await getBlogSearchSuggestions(query, limit);

    return NextResponse.json({
      posts,
      categories,
      suggestions: suggestions || [],
    });
  } catch (error) {
    console.error('Blog search error:', error);

    return NextResponse.json(
      { error: 'Blog search failed' },
      { status: 500 }
    );
  }
}
