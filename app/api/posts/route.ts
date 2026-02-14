import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '@/lib/apollo/client';
import {
  GET_ALL_POSTS,
  GET_POSTS_BY_CATEGORY,
  GET_POSTS_BY_TAG,
  GET_POSTS_EXCLUDING_CATEGORIES,
  GET_CATEGORY_BY_SLUG,
} from '@/lib/queries/posts';

async function resolveCategoryIds(slugs: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const slug of slugs) {
    try {
      const { data } = await getClient().query({
        query: GET_CATEGORY_BY_SLUG,
        variables: { slug },
      });
      if (data?.category?.databaseId) {
        ids.push(data.category.databaseId);
      }
    } catch {
      // Skip categories that don't exist
    }
  }
  return ids;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const after = searchParams.get('after');
  const first = parseInt(searchParams.get('first') || '12', 10);
  const category = searchParams.get('category');
  const tag = searchParams.get('tag');
  const excludeCategories = searchParams.get('excludeCategories');

  try {
    let query = GET_ALL_POSTS;
    let variables: Record<string, unknown> = { first, after };

    if (category) {
      query = GET_POSTS_BY_CATEGORY;
      variables = { ...variables, categoryName: category };
    } else if (tag) {
      query = GET_POSTS_BY_TAG;
      variables = { ...variables, tag };
    } else if (excludeCategories) {
      const slugs = excludeCategories.split(',').map(s => s.trim());
      const categoryIds = await resolveCategoryIds(slugs);
      if (categoryIds.length > 0) {
        query = GET_POSTS_EXCLUDING_CATEGORIES;
        variables = { ...variables, categoryNotIn: categoryIds };
      }
    }

    const { data } = await getClient().query({
      query,
      variables,
    });

    const posts = data?.posts?.nodes || [];
    const pageInfo = data?.posts?.pageInfo || {
      hasNextPage: false,
      endCursor: null,
    };

    return NextResponse.json({
      posts,
      pageInfo: {
        hasNextPage: pageInfo.hasNextPage,
        endCursor: pageInfo.endCursor,
      },
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch posts' },
      { status: 500 }
    );
  }
}
