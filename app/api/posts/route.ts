import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '@/lib/apollo/client';
import {
  GET_ALL_POSTS,
  GET_POSTS_BY_CATEGORY,
  GET_POSTS_BY_TAG,
} from '@/lib/queries/posts';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const after = searchParams.get('after');
  const first = parseInt(searchParams.get('first') || '12', 10);
  const category = searchParams.get('category');
  const tag = searchParams.get('tag');

  try {
    let query = GET_ALL_POSTS;
    let variables: Record<string, unknown> = { first, after };

    if (category) {
      query = GET_POSTS_BY_CATEGORY;
      variables = { ...variables, categoryName: category };
    } else if (tag) {
      query = GET_POSTS_BY_TAG;
      variables = { ...variables, tag };
    }

    const { data } = await getClient().query({
      query,
      variables,
      fetchPolicy: 'no-cache',
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
