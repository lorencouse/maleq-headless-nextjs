import { getClient } from '@/lib/apollo/client';
import {
  SEARCH_POSTS_BY_TITLE,
  GET_ALL_CATEGORIES,
  GET_ALL_POSTS,
  GET_POSTS_BY_CATEGORY,
} from '@/lib/queries/posts';
import { Post } from '@/lib/types/wordpress';

interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  count: number;
  description?: string | null;
}

export interface BlogSearchResult {
  posts: Post[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

export interface BlogCategory {
  id: string;
  name: string;
  slug: string;
  count?: number;
}

export interface BlogSearchSuggestion {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  image: string | null;
  category: string | null;
}

/**
 * Search blog posts by title only for more relevant results
 * Used by blog pages for full search results
 */
export async function searchBlogPosts(
  query: string,
  options: {
    first?: number;
    categorySlug?: string;
  } = {}
): Promise<BlogSearchResult> {
  const { first = 20, categorySlug } = options;

  const { data } = await getClient().query({
    query: SEARCH_POSTS_BY_TITLE,
    variables: {
      titleSearch: query,
      first,
      categoryName: categorySlug || null,
    },
    fetchPolicy: 'no-cache',
  });

  const posts: Post[] = data?.posts?.nodes || [];

  return {
    posts,
    pageInfo: {
      hasNextPage: data?.posts?.pageInfo?.hasNextPage || false,
      endCursor: data?.posts?.pageInfo?.endCursor || null,
    },
  };
}

/**
 * Get blog posts with pagination
 * Used by blog pages for default listing
 */
export async function getBlogPosts(
  options: {
    first?: number;
    after?: string;
    categorySlug?: string;
  } = {}
): Promise<BlogSearchResult> {
  const { first = 12, after, categorySlug } = options;

  const { data } = await getClient().query({
    query: categorySlug ? GET_POSTS_BY_CATEGORY : GET_ALL_POSTS,
    variables: categorySlug
      ? { categoryName: categorySlug, first, after }
      : { first, after },
    fetchPolicy: 'no-cache',
  });

  return {
    posts: data?.posts?.nodes || [],
    pageInfo: data?.posts?.pageInfo || {
      hasNextPage: false,
      endCursor: null,
    },
  };
}

/**
 * Get blog search suggestions for autocomplete
 * Used by navbar search and other autocomplete UIs
 */
export async function getBlogSearchSuggestions(
  query: string,
  limit: number = 5
): Promise<{
  posts: BlogSearchSuggestion[];
  categories: BlogCategory[];
}> {
  if (!query || query.length < 2) {
    return { posts: [], categories: [] };
  }

  const [postsResult, categoriesResult] = await Promise.all([
    getClient().query({
      query: SEARCH_POSTS_BY_TITLE,
      variables: { titleSearch: query, first: limit },
      fetchPolicy: 'no-cache',
    }),
    getClient().query({
      query: GET_ALL_CATEGORIES,
      fetchPolicy: 'no-cache',
    }),
  ]);

  const posts: Post[] = postsResult.data?.posts?.nodes || [];
  const allCategories: CategoryNode[] = categoriesResult.data?.categories?.nodes || [];

  // Filter categories that match the search term
  const matchingCategories = allCategories
    .filter((cat) => cat.name.toLowerCase().includes(query.toLowerCase()) && cat.count > 0)
    .slice(0, 3)
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
    }));

  // Format posts for suggestions
  const postSuggestions = posts.map((post) => {
    // Strip HTML tags and limit excerpt length
    const cleanExcerpt = post.excerpt
      ? post.excerpt.replace(/<[^>]*>/g, '').slice(0, 100)
      : '';

    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: cleanExcerpt,
      image: post.featuredImage?.node?.sourceUrl || null,
      category: post.categories?.nodes?.[0]?.name || null,
    };
  });

  return {
    posts: postSuggestions,
    categories: matchingCategories,
  };
}

/**
 * Get all blog categories
 */
export async function getBlogCategories(): Promise<BlogCategory[]> {
  const { data } = await getClient().query({
    query: GET_ALL_CATEGORIES,
    fetchPolicy: 'no-cache',
  });

  return (data?.categories?.nodes || []).map((cat: CategoryNode) => ({
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    count: cat.count,
  }));
}
