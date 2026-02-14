import { getClient, REVALIDATE } from '@/lib/apollo/client';
import MiniSearch from 'minisearch';
import {
  SEARCH_POSTS,
  SEARCH_POSTS_BY_TITLE,
  GET_ALL_CATEGORIES,
  GET_ALL_POSTS,
  GET_POSTS_BY_CATEGORY,
  GET_POSTS_EXCLUDING_CATEGORIES,
  GET_CATEGORY_BY_SLUG,
} from '@/lib/queries/posts';
import { Post } from '@/lib/types/wordpress';
import {
  tokenizeQuery,
  calculateRelevanceScore,
  matchesAllTerms,
  matchesAnyTerm,
} from '@/lib/utils/search-helpers';
import { stripHtml } from '@/lib/utils/text-utils';

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
  /** Spelling suggestions shown only when no results found */
  suggestions?: string[];
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
 * Uses Fuse.js for typo-tolerant spell checking BEFORE database queries
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
  let searchTerms = tokenizeQuery(query);
  if (searchTerms.length === 0) {
    return {
      posts: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
  }

  try {
    // Use the query directly - browser handles spell checking visually,
    // and Fuse.js handles fuzzy matching for typo tolerance
    const searchQuery = query;

    // Use the primary term for database search (most significant word)
    const primaryTerm = searchTerms[0] || query;

    // Fetch both title matches and content matches in parallel
    const [titleResult, contentResult] = await Promise.all([
      getClient().query({
        query: SEARCH_POSTS_BY_TITLE,
        variables: {
          titleSearch: primaryTerm,
          first: Math.min(first + 5, 25),
          categoryName: categorySlug || null,
        },
        revalidate: REVALIDATE.DYNAMIC,
      }),
      getClient().query({
        query: SEARCH_POSTS,
        variables: {
          search: searchQuery,
          first: Math.min(first + 10, 30),
          categoryName: categorySlug || null,
        },
        revalidate: REVALIDATE.DYNAMIC,
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

    // Use MiniSearch for better fuzzy matching and relevance scoring
    if (allPosts.length > 0) {
      const miniSearch = new MiniSearch({
        fields: ['title', 'excerpt'],
        storeFields: ['title', 'excerpt'],
        searchOptions: {
          fuzzy: 0.2,
          prefix: true,
          boost: { title: 2 },
        },
      });

      miniSearch.addAll(allPosts.map((post, i) => ({
        ...post,
        id: post.id || String(i),
      })));

      const searchResults = miniSearch.search(query);

      if (searchResults.length > 0) {
        // Map results back to original posts
        const resultIds = new Set(searchResults.slice(0, first).map(r => r.id));
        const relevantPosts = allPosts.filter(p => resultIds.has(p.id));
        // Sort by MiniSearch result order
        relevantPosts.sort((a, b) => {
          const aIdx = searchResults.findIndex(r => r.id === a.id);
          const bIdx = searchResults.findIndex(r => r.id === b.id);
          return aIdx - bIdx;
        });

        return {
          posts: relevantPosts,
          pageInfo: {
            hasNextPage: searchResults.length > first,
            endCursor: titleResult.data?.posts?.pageInfo?.endCursor || null,
          },
        };
      }
    }

    // Fallback to custom scoring if MiniSearch finds nothing
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

    // Filter out posts with zero relevance
    const relevantPosts = scoredPosts
      .filter(s => s.relevanceScore > 0 || s.anyTermInTitle)
      .slice(0, first)
      .map(s => s.post);

    // If no results found, check for spelling suggestions
    let suggestions: string[] | undefined;
    if (relevantPosts.length === 0) {
      const { correctBlogSearchTerm } = await import('@/lib/search/search-index');
      const result = await correctBlogSearchTerm(query);
      if (result.suggestions.length > 0) {
        suggestions = result.suggestions;
      }
    }

    return {
      posts: relevantPosts,
      pageInfo: {
        hasNextPage: relevantPosts.length >= first,
        endCursor: titleResult.data?.posts?.pageInfo?.endCursor || null,
      },
      suggestions,
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
 * Resolve category slugs to their WordPress database IDs
 */
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

/**
 * Get blog posts with pagination
 * Used by blog pages for default listing
 */
export async function getBlogPosts(
  options: {
    first?: number;
    after?: string;
    categorySlug?: string;
    excludeCategorySlugs?: string[];
  } = {}
): Promise<BlogSearchResult> {
  const { first = 12, after, categorySlug, excludeCategorySlugs } = options;

  try {
    let query = GET_ALL_POSTS;
    let variables: Record<string, unknown> = { first, after };

    if (categorySlug) {
      query = GET_POSTS_BY_CATEGORY;
      variables = { categoryName: categorySlug, first, after };
    } else if (excludeCategorySlugs && excludeCategorySlugs.length > 0) {
      // Resolve category slugs to database IDs for exclusion
      const categoryIds = await resolveCategoryIds(excludeCategorySlugs);
      if (categoryIds.length > 0) {
        query = GET_POSTS_EXCLUDING_CATEGORIES;
        variables = { first, after, categoryNotIn: categoryIds };
      }
    }

    const { data } = await getClient().query({ query, variables });

    return {
      posts: data?.posts?.nodes || [],
      pageInfo: data?.posts?.pageInfo || {
        hasNextPage: false,
        endCursor: null,
      },
    };
  } catch (error) {
    console.error('Error fetching blog posts:', error);
    return { posts: [], pageInfo: { hasNextPage: false, endCursor: null } };
  }
}

/**
 * Get blog search suggestions for autocomplete
 * Uses Fuse.js for fuzzy matching and relevance scoring
 * Returns title matches first, then content matches sorted by relevance
 */
export async function getBlogSearchSuggestions(
  query: string,
  limit: number = 5
): Promise<{
  posts: BlogSearchSuggestion[];
  categories: BlogCategory[];
  suggestions?: string[];
}> {
  if (!query || query.length < 2) {
    return { posts: [], categories: [] };
  }

  // Use the query directly - browser handles spell checking visually,
  // and Fuse.js handles fuzzy matching for typo tolerance
  const searchQuery = query;

  // Tokenize the search query
  const searchTerms = tokenizeQuery(searchQuery);
  const primaryTerm = searchTerms.length > 0 ? searchTerms[0] : searchQuery;

  const results = await Promise.allSettled([
    getClient().query({
      query: SEARCH_POSTS_BY_TITLE,
      variables: { titleSearch: primaryTerm, first: limit + 3 },
      revalidate: REVALIDATE.DYNAMIC,
    }),
    getClient().query({
      query: SEARCH_POSTS,
      variables: { search: searchQuery, first: limit + 5 },
      revalidate: REVALIDATE.DYNAMIC,
    }),
    getClient().query({
      query: GET_ALL_CATEGORIES,
      revalidate: REVALIDATE.STATIC,
    }),
  ]);

  const titlePosts: Post[] = results[0].status === 'fulfilled' ? results[0].value.data?.posts?.nodes || [] : [];
  const contentPosts: Post[] = results[1].status === 'fulfilled' ? results[1].value.data?.posts?.nodes || [] : [];
  const allCategories: CategoryNode[] = results[2].status === 'fulfilled' ? results[2].value.data?.categories?.nodes || [] : [];

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
      ? stripHtml(post.excerpt).slice(0, 100)
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

  // If no results found, check for spelling suggestions
  let suggestions: string[] | undefined;
  if (postSuggestions.length === 0 && matchingCategories.length === 0) {
    const { correctBlogSearchTerm } = await import('@/lib/search/search-index');
    const result = await correctBlogSearchTerm(query);
    if (result.suggestions.length > 0) {
      suggestions = result.suggestions;
    }
  }

  return {
    posts: postSuggestions,
    categories: matchingCategories,
    suggestions,
  };
}

/**
 * Get all blog categories
 */
export async function getBlogCategories(): Promise<BlogCategory[]> {
  try {
    const { data } = await getClient().query({
      query: GET_ALL_CATEGORIES,
      revalidate: REVALIDATE.STATIC,
    });

    return (data?.categories?.nodes || []).map((cat: CategoryNode) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      count: cat.count,
    }));
  } catch (error) {
    console.error('Error fetching blog categories:', error);
    return [];
  }
}
