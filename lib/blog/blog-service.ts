import { getClient } from '@/lib/apollo/client';
import {
  SEARCH_POSTS,
  SEARCH_POSTS_BY_TITLE,
  GET_ALL_CATEGORIES,
  GET_ALL_POSTS,
  GET_POSTS_BY_CATEGORY,
} from '@/lib/queries/posts';
import { Post } from '@/lib/types/wordpress';
import {
  tokenizeQuery,
  calculateRelevanceScore,
  matchesAllTerms,
  matchesAnyTerm,
} from '@/lib/utils/search-helpers';

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
 * Search blog posts with relevance ranking
 * Uses stemming, tokenization, and fuzzy matching for improved results
 * Returns posts sorted by: all terms in title > any term in title > relevance score
 */
export async function searchBlogPosts(
  query: string,
  options: {
    first?: number;
    categorySlug?: string;
  } = {}
): Promise<BlogSearchResult> {
  const { first = 20, categorySlug } = options;

  // Tokenize the search query for multi-word and stemming support
  const searchTerms = tokenizeQuery(query);
  if (searchTerms.length === 0) {
    return {
      posts: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
  }

  try {
    // Use the primary term for database search (most significant word)
    const primaryTerm = searchTerms[0];

    // Fetch both title matches and content matches in parallel
    const [titleResult, contentResult] = await Promise.all([
      getClient().query({
        query: SEARCH_POSTS_BY_TITLE,
        variables: {
          titleSearch: primaryTerm,
          first: first * 2,
          categoryName: categorySlug || null,
        },
        fetchPolicy: 'no-cache',
      }),
      getClient().query({
        query: SEARCH_POSTS,
        variables: {
          search: query,
          first: first * 3,
          categoryName: categorySlug || null,
        },
        fetchPolicy: 'no-cache',
      }),
    ]);

    const titlePosts: Post[] = titleResult.data?.posts?.nodes || [];
    const contentPosts: Post[] = contentResult.data?.posts?.nodes || [];

    // Combine and deduplicate results
    const seenIds = new Set<string>();
    const allPosts: Post[] = [];

    for (const post of [...titlePosts, ...contentPosts]) {
      if (!seenIds.has(post.id)) {
        seenIds.add(post.id);
        allPosts.push(post);
      }
    }

    // Score and categorize all posts
    const scoredPosts = allPosts.map(post => {
      const titleLower = post.title?.toLowerCase() || '';
      const allTermsInTitle = matchesAllTerms(titleLower, searchTerms);
      const anyTermInTitle = matchesAnyTerm(titleLower, searchTerms);
      const relevanceScore = calculateRelevanceScore(
        { title: post.title, excerpt: post.excerpt },
        searchTerms
      );

      return {
        post,
        allTermsInTitle,
        anyTermInTitle,
        relevanceScore,
      };
    });

    // Sort by: all terms in title > any term in title > relevance score
    scoredPosts.sort((a, b) => {
      // All terms in title first
      if (a.allTermsInTitle && !b.allTermsInTitle) return -1;
      if (!a.allTermsInTitle && b.allTermsInTitle) return 1;

      // Then any term in title
      if (a.anyTermInTitle && !b.anyTermInTitle) return -1;
      if (!a.anyTermInTitle && b.anyTermInTitle) return 1;

      // Finally by relevance score
      return b.relevanceScore - a.relevanceScore;
    });

    // Filter out posts with zero relevance (no matches at all)
    const relevantPosts = scoredPosts
      .filter(s => s.relevanceScore > 0 || s.anyTermInTitle)
      .slice(0, first)
      .map(s => s.post);

    return {
      posts: relevantPosts,
      pageInfo: {
        hasNextPage: relevantPosts.length >= first,
        endCursor: titleResult.data?.posts?.pageInfo?.endCursor || null,
      },
    };
  } catch (error) {
    console.error('Error searching blog posts:', error);
    return {
      posts: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
  }
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
 * Uses stemming, tokenization, and fuzzy matching for improved suggestions
 * Returns title matches first, then content matches sorted by relevance
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

  // Tokenize the search query
  const searchTerms = tokenizeQuery(query);
  const primaryTerm = searchTerms.length > 0 ? searchTerms[0] : query;

  const [titleResult, contentResult, categoriesResult] = await Promise.all([
    getClient().query({
      query: SEARCH_POSTS_BY_TITLE,
      variables: { titleSearch: primaryTerm, first: limit * 2 },
      fetchPolicy: 'no-cache',
    }),
    getClient().query({
      query: SEARCH_POSTS,
      variables: { search: query, first: limit * 3 },
      fetchPolicy: 'no-cache',
    }),
    getClient().query({
      query: GET_ALL_CATEGORIES,
      fetchPolicy: 'no-cache',
    }),
  ]);

  const titlePosts: Post[] = titleResult.data?.posts?.nodes || [];
  const contentPosts: Post[] = contentResult.data?.posts?.nodes || [];
  const allCategories: CategoryNode[] = categoriesResult.data?.categories?.nodes || [];

  // Combine and deduplicate results
  const seenIds = new Set<string>();
  const allPosts: Post[] = [];

  for (const post of [...titlePosts, ...contentPosts]) {
    if (!seenIds.has(post.id)) {
      seenIds.add(post.id);
      allPosts.push(post);
    }
  }

  // Score and sort posts
  const scoredPosts = allPosts.map(post => {
    const titleLower = post.title?.toLowerCase() || '';
    const allTermsInTitle = matchesAllTerms(titleLower, searchTerms);
    const anyTermInTitle = matchesAnyTerm(titleLower, searchTerms);
    const relevanceScore = calculateRelevanceScore(
      { title: post.title, excerpt: post.excerpt },
      searchTerms
    );

    return {
      post,
      allTermsInTitle,
      anyTermInTitle,
      relevanceScore,
    };
  });

  // Sort by: all terms in title > any term in title > relevance score
  scoredPosts.sort((a, b) => {
    if (a.allTermsInTitle && !b.allTermsInTitle) return -1;
    if (!a.allTermsInTitle && b.allTermsInTitle) return 1;
    if (a.anyTermInTitle && !b.anyTermInTitle) return -1;
    if (!a.anyTermInTitle && b.anyTermInTitle) return 1;
    return b.relevanceScore - a.relevanceScore;
  });

  // Get top results
  const topPosts = scoredPosts
    .filter(s => s.relevanceScore > 0 || s.anyTermInTitle)
    .slice(0, limit)
    .map(s => s.post);

  // Filter categories that match the search term (with stemming support)
  const queryLower = query.toLowerCase();
  const matchingCategories = allCategories
    .filter((cat) => {
      const catLower = cat.name.toLowerCase();
      // Direct match or any search term matches
      return (catLower.includes(queryLower) ||
              searchTerms.some(term => catLower.includes(term))) &&
             cat.count > 0;
    })
    .slice(0, 3)
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
    }));

  // Format posts for suggestions
  const postSuggestions = topPosts.map((post) => {
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
