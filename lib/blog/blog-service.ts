import { getClient, REVALIDATE } from '@/lib/apollo/client';
import { getProductionImageUrl } from '@/lib/utils/image';
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

// ─── Helpers ───

async function isMySQLAvailable(): Promise<boolean> {
  if (process.env.DATA_SOURCE === 'graphql') return false;
  try {
    const { isMySQLReachable } = await import('@/lib/db/pool');
    return await isMySQLReachable();
  } catch {
    return false;
  }
}

/**
 * Resolve category slugs to their WordPress database IDs
 */
async function resolveCategoryIds(slugs: string[]): Promise<number[]> {
  // Try MySQL first
  if (await isMySQLAvailable()) {
    try {
      const { resolveBlogCategoryIds } = await import('@/lib/db/blog-loader');
      return await resolveBlogCategoryIds(slugs);
    } catch {}
  }

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
 * Search blog posts with relevance ranking
 * Uses MySQL for fetching, MiniSearch for fuzzy re-ranking
 */
export async function searchBlogPosts(
  query: string,
  options: {
    first?: number;
    categorySlug?: string;
  } = {}
): Promise<BlogSearchResult> {
  const { first = 20, categorySlug } = options;

  const searchTerms = tokenizeQuery(query);
  if (searchTerms.length === 0) {
    return {
      posts: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
  }

  try {
    const primaryTerm = searchTerms[0] || query;
    let allPosts: Post[] = [];

    // Try MySQL first
    if (await isMySQLAvailable()) {
      try {
        const { loadBlogPosts } = await import('@/lib/db/blog-loader');

        // Fetch both title matches and content matches in parallel
        const [titleResult, contentResult] = await Promise.all([
          loadBlogPosts({
            titleSearch: primaryTerm,
            first: Math.min(first + 5, 25),
            categorySlug: categorySlug || undefined,
          }),
          loadBlogPosts({
            search: query,
            first: Math.min(first + 10, 30),
            categorySlug: categorySlug || undefined,
          }),
        ]);

        // Combine and deduplicate
        const seenIds = new Set<string>();
        for (const post of [...titleResult.posts, ...contentResult.posts]) {
          if (!seenIds.has(post.id)) {
            seenIds.add(post.id);
            allPosts.push(post);
          }
        }
      } catch (e) {
        console.warn('searchBlogPosts: MySQL failed, falling back to GraphQL', e);
        allPosts = [];
      }
    }

    // Fall back to GraphQL if MySQL returned nothing
    if (allPosts.length === 0) {
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
            search: query,
            first: Math.min(first + 10, 30),
            categoryName: categorySlug || null,
          },
          revalidate: REVALIDATE.DYNAMIC,
        }),
      ]);

      const titlePosts: Post[] = titleResult.data?.posts?.nodes || [];
      const contentPosts: Post[] = contentResult.data?.posts?.nodes || [];

      const seenIds = new Set<string>();
      for (const post of [...titlePosts, ...contentPosts]) {
        if (!seenIds.has(post.id)) {
          seenIds.add(post.id);
          allPosts.push(post);
        }
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
        const resultIds = new Set(searchResults.slice(0, first).map(r => r.id));
        const relevantPosts = allPosts.filter(p => resultIds.has(p.id));
        relevantPosts.sort((a, b) => {
          const aIdx = searchResults.findIndex(r => r.id === a.id);
          const bIdx = searchResults.findIndex(r => r.id === b.id);
          return aIdx - bIdx;
        });

        return {
          posts: relevantPosts,
          pageInfo: {
            hasNextPage: searchResults.length > first,
            endCursor: null,
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

    scoredPosts.sort((a, b) => {
      if (a.allTermsInTitle && !b.allTermsInTitle) return -1;
      if (!a.allTermsInTitle && b.allTermsInTitle) return 1;
      if (a.anyTermInTitle && !b.anyTermInTitle) return -1;
      if (!a.anyTermInTitle && b.anyTermInTitle) return 1;
      return b.relevanceScore - a.relevanceScore;
    });

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
        endCursor: null,
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
 * Get blog posts with pagination
 * Uses MySQL for listing (no reusable block content needed for grid cards)
 */
export async function getBlogPosts(
  options: {
    first?: number;
    after?: string;
    categorySlug?: string;
    tagSlug?: string;
    excludeCategorySlugs?: string[];
  } = {}
): Promise<BlogSearchResult> {
  const { first = 12, after, categorySlug, tagSlug, excludeCategorySlugs } = options;

  // Try MySQL first
  if (await isMySQLAvailable()) {
    try {
      const { loadBlogPosts, resolveBlogCategoryIds } = await import('@/lib/db/blog-loader');

      let excludeCategoryIds: number[] | undefined;
      if (excludeCategorySlugs && excludeCategorySlugs.length > 0) {
        excludeCategoryIds = await resolveBlogCategoryIds(excludeCategorySlugs);
      }

      // Convert cursor-based 'after' to offset (cursor is base64-encoded offset)
      let offset = 0;
      if (after) {
        try {
          const decoded = Buffer.from(after, 'base64').toString();
          offset = parseInt(decoded.replace('offset:', ''), 10) || 0;
        } catch {}
      }

      const result = await loadBlogPosts({
        first,
        offset,
        categorySlug,
        tagSlug,
        excludeCategoryIds: excludeCategoryIds?.length ? excludeCategoryIds : undefined,
      });

      // Generate cursor for next page
      const nextOffset = offset + first;
      const endCursor = result.hasNextPage
        ? Buffer.from(`offset:${nextOffset}`).toString('base64')
        : null;

      return {
        posts: result.posts,
        pageInfo: {
          hasNextPage: result.hasNextPage,
          endCursor,
        },
      };
    } catch (e) {
      console.warn('getBlogPosts: MySQL failed, falling back to GraphQL', e);
    }
  }

  // GraphQL fallback
  try {
    let query = GET_ALL_POSTS;
    let variables: Record<string, unknown> = { first, after };

    if (categorySlug) {
      query = GET_POSTS_BY_CATEGORY;
      variables = { categoryName: categorySlug, first, after };
    } else if (excludeCategorySlugs && excludeCategorySlugs.length > 0) {
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

  const searchQuery = query;
  const searchTerms = tokenizeQuery(searchQuery);
  const primaryTerm = searchTerms.length > 0 ? searchTerms[0] : searchQuery;

  // Get categories (try SQL → GraphQL)
  let allCategories: CategoryNode[] = [];

  if (await isMySQLAvailable()) {
    try {
      const { loadBlogCategories } = await import('@/lib/db/blog-loader');
      const cats = await loadBlogCategories();
      allCategories = cats.map(c => ({
        id: c.id, name: c.name, slug: c.slug, count: c.count,
      }));
    } catch {}
  }

  // Fetch posts (try SQL first)
  const allPosts: Post[] = [];

  if (await isMySQLAvailable()) {
    try {
      const { loadBlogPosts } = await import('@/lib/db/blog-loader');
      const [titleResult, contentResult] = await Promise.all([
        loadBlogPosts({ titleSearch: primaryTerm, first: limit + 3 }),
        loadBlogPosts({ search: searchQuery, first: limit + 5 }),
      ]);
      const seenIds = new Set<string>();
      for (const post of [...titleResult.posts, ...contentResult.posts]) {
        if (!seenIds.has(post.id)) {
          seenIds.add(post.id);
          allPosts.push(post);
        }
      }
    } catch (e) {
      console.warn('getBlogSearchSuggestions: MySQL failed, falling back to GraphQL', e);
    }
  }

  // GraphQL fallback for posts
  if (allPosts.length === 0) {
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
      // Also fetch categories via GraphQL if we don't have them yet
      ...(allCategories.length === 0
        ? [getClient().query({ query: GET_ALL_CATEGORIES, revalidate: REVALIDATE.STATIC })]
        : []),
    ]);

    const titlePosts: Post[] = results[0].status === 'fulfilled' ? results[0].value.data?.posts?.nodes || [] : [];
    const contentPosts: Post[] = results[1].status === 'fulfilled' ? results[1].value.data?.posts?.nodes || [] : [];

    if (allCategories.length === 0 && results[2]?.status === 'fulfilled') {
      allCategories =
        (
          results[2] as PromiseFulfilledResult<{
            data?: { categories?: { nodes?: CategoryNode[] } };
          }>
        ).value.data?.categories?.nodes || [];
    }

    const seenIds = new Set<string>();
    for (const post of [...titlePosts, ...contentPosts]) {
      if (!seenIds.has(post.id)) {
        seenIds.add(post.id);
        allPosts.push(post);
      }
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

    return { post, allTermsInTitle, anyTermInTitle, relevanceScore };
  });

  scoredPosts.sort((a, b) => {
    if (a.allTermsInTitle && !b.allTermsInTitle) return -1;
    if (!a.allTermsInTitle && b.allTermsInTitle) return 1;
    if (a.anyTermInTitle && !b.anyTermInTitle) return -1;
    if (!a.anyTermInTitle && b.anyTermInTitle) return 1;
    return b.relevanceScore - a.relevanceScore;
  });

  const topPosts = scoredPosts
    .filter(s => s.relevanceScore > 0 || s.anyTermInTitle)
    .slice(0, limit)
    .map(s => s.post);

  // Filter matching categories
  const queryLower = query.toLowerCase();
  const matchingCategories = allCategories
    .filter((cat) => {
      const catLower = cat.name.toLowerCase();
      return (catLower.includes(queryLower) ||
              searchTerms.some(term => catLower.includes(term))) &&
             cat.count > 0;
    })
    .slice(0, 3)
    .map((cat) => ({ id: cat.id, name: cat.name, slug: cat.slug }));

  // Format posts for suggestions
  const postSuggestions = topPosts.map((post) => {
    const cleanExcerpt = post.excerpt ? stripHtml(post.excerpt).slice(0, 100) : '';
    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: cleanExcerpt,
      image: post.featuredImage?.node?.sourceUrl ? getProductionImageUrl(post.featuredImage.node.sourceUrl) : null,
      category: post.categories?.nodes?.[0]?.name || null,
    };
  });

  // Spelling suggestions when no results
  let suggestions: string[] | undefined;
  if (postSuggestions.length === 0 && matchingCategories.length === 0) {
    const { correctBlogSearchTerm } = await import('@/lib/search/search-index');
    const result = await correctBlogSearchTerm(query);
    if (result.suggestions.length > 0) {
      suggestions = result.suggestions;
    }
  }

  return { posts: postSuggestions, categories: matchingCategories, suggestions };
}

/**
 * Get all blog categories
 */
export async function getBlogCategories(): Promise<BlogCategory[]> {
  // Try MySQL first
  if (await isMySQLAvailable()) {
    try {
      const { loadBlogCategories } = await import('@/lib/db/blog-loader');
      const cats = await loadBlogCategories();
      if (cats.length > 0) {
        return cats.map(c => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          count: c.count,
        }));
      }
    } catch (e) {
      console.warn('getBlogCategories: MySQL failed, falling back to GraphQL', e);
    }
  }

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
