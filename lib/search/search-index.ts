/**
 * Search Index - Fuzzy suggestions using MiniSearch
 *
 * Replaces Fuse.js + simple-spellchecker with MiniSearch for:
 * - Smaller bundle (~5.8 kB vs ~23 kB)
 * - Faster search on large datasets (inverted index vs linear scan)
 * - Built-in fuzzy matching, prefix search, and typo tolerance
 */

import MiniSearch from 'minisearch';
import { getClient } from '@/lib/apollo/client';
import { gql } from 'graphql-request';

// ============================================================================
// Product Vocabulary Index (MiniSearch)
// ============================================================================

interface VocabularyItem {
  id: string;
  term: string;
  type: 'product' | 'brand' | 'category';
}

let searchIndex: MiniSearch<VocabularyItem> | null = null;
let vocabularyTimestamp = 0;
let vocabularyLoading: Promise<MiniSearch<VocabularyItem>> | null = null;
const VOCABULARY_TTL = 60 * 60 * 1000; // 1 hour (vocabulary changes rarely)

const GET_PRODUCT_NAMES_PAGE = gql`
  query GetProductNamesPage($first: Int = 500, $after: String) {
    products(first: $first, after: $after) {
      nodes {
        name
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const GET_TAXONOMY_VOCABULARY = gql`
  query GetTaxonomyVocabulary {
    productBrands(first: 500) {
      nodes {
        name
      }
    }
    productCategories(first: 500, where: { hideEmpty: true }) {
      nodes {
        name
      }
    }
  }
`;

function createSearchIndex(): MiniSearch<VocabularyItem> {
  return new MiniSearch<VocabularyItem>({
    fields: ['term'],
    storeFields: ['term', 'type'],
    searchOptions: {
      fuzzy: 0.2,
      prefix: true,
      boost: { term: 1 },
    },
  });
}

interface ProductNamesResponse {
  products: {
    nodes: { name: string }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

async function fetchAllProductNames(): Promise<string[]> {
  const names: string[] = [];
  let afterCursor: string | null = null;
  let hasNextPage = true;
  let pageCount = 0;
  const MAX_PAGES = 100; // Safety limit (~50K products max)

  while (hasNextPage && pageCount < MAX_PAGES) {
    const result: { data: ProductNamesResponse } = await getClient().query({
      query: GET_PRODUCT_NAMES_PAGE,
      variables: { first: 500, after: afterCursor },
    });

    const nodes = result.data?.products?.nodes || [];
    for (const p of nodes) {
      if (p.name) names.push(p.name);
    }

    hasNextPage = result.data?.products?.pageInfo?.hasNextPage ?? false;
    afterCursor = result.data?.products?.pageInfo?.endCursor ?? null;
    pageCount++;
  }

  return names;
}

async function getSearchIndex(): Promise<MiniSearch<VocabularyItem>> {
  const now = Date.now();

  if (searchIndex && (now - vocabularyTimestamp) < VOCABULARY_TTL) {
    return searchIndex;
  }

  if (vocabularyLoading) return vocabularyLoading;

  vocabularyLoading = (async () => {
    try {
      // Fetch all product names (paginated) and taxonomy terms in parallel
      const [productNames, taxonomyResult] = await Promise.all([
        fetchAllProductNames(),
        getClient().query({ query: GET_TAXONOMY_VOCABULARY }),
      ]);

      const index = createSearchIndex();
      const seen = new Set<string>();
      let idCounter = 0;

      // Extract unique words from product names
      for (const rawName of productNames) {
        const name = rawName.toLowerCase();
        if (!seen.has(name)) {
          seen.add(name);
          index.add({ id: String(idCounter++), term: name, type: 'product' });
        }
        // Also add individual significant words (3+ chars)
        const words = name.split(/[\s\-_,]+/);
        for (const word of words) {
          const clean = word.replace(/[^a-z]/g, '');
          if (clean.length >= 3 && !seen.has(clean)) {
            seen.add(clean);
            index.add({ id: String(idCounter++), term: clean, type: 'product' });
          }
        }
      }

      // Add brand names
      const brands = taxonomyResult.data?.productBrands?.nodes || [];
      for (const b of brands) {
        if (b.name) {
          const name = b.name.toLowerCase();
          if (!seen.has(name)) {
            seen.add(name);
            index.add({ id: String(idCounter++), term: name, type: 'brand' });
          }
        }
      }

      // Add category names
      const categories = taxonomyResult.data?.productCategories?.nodes || [];
      for (const c of categories) {
        if (c.name) {
          const name = c.name.toLowerCase();
          if (!seen.has(name)) {
            seen.add(name);
            index.add({ id: String(idCounter++), term: name, type: 'category' });
          }
        }
      }

      searchIndex = index;
      vocabularyTimestamp = now;
      vocabularyLoading = null;

      console.log(`[SpellCheck] Loaded ${idCounter} vocabulary terms from ${productNames.length} products into MiniSearch`);
      return index;
    } catch (error) {
      console.error('[SpellCheck] Failed to load vocabulary:', error);
      vocabularyLoading = null;
      return createSearchIndex(); // Return empty index
    }
  })();

  return vocabularyLoading;
}

// ============================================================================
// Combined Suggestions
// ============================================================================

/**
 * Get spelling suggestions using MiniSearch fuzzy matching against product vocabulary.
 * Handles multi-word queries by suggesting alternatives for each word.
 */
async function getSuggestions(searchTerm: string): Promise<string[]> {
  const term = searchTerm.toLowerCase().trim();
  const words = term.split(/\s+/);
  const suggestions: string[] = [];
  const seen = new Set<string>();

  try {
    const index = await getSearchIndex();

    // Single word query
    if (words.length === 1 && words[0].length >= 3) {
      const results = index.search(words[0], {
        fuzzy: 0.3,
        prefix: true,
      });

      for (const result of results.slice(0, 8)) {
        const suggestion = result.term;
        if (suggestion !== words[0] && !seen.has(suggestion)) {
          seen.add(suggestion);
          suggestions.push(suggestion);
        }
      }
    }
    // Multi-word query - get alternatives for each word
    else if (words.length > 1) {
      const wordAlternatives: Map<number, string[]> = new Map();

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (word.length < 3) continue;

        const alternatives: string[] = [];
        const results = index.search(word, {
          fuzzy: 0.3,
          prefix: true,
        });

        for (const result of results.slice(0, 3)) {
          const suggestion = result.term;
          if (suggestion !== word && !alternatives.includes(suggestion)) {
            alternatives.push(suggestion);
          }
        }

        if (alternatives.length > 0) {
          wordAlternatives.set(i, alternatives.slice(0, 3));
        }
      }

      // Build full phrase suggestions by replacing words with alternatives
      for (const [wordIndex, alternatives] of wordAlternatives) {
        for (const alt of alternatives) {
          const newPhrase = words.map((w, i) =>
            i === wordIndex ? alt : w
          ).join(' ');

          if (!seen.has(newPhrase) && newPhrase !== term) {
            seen.add(newPhrase);
            suggestions.push(newPhrase);
          }

          if (suggestions.length >= 5) break;
        }
        if (suggestions.length >= 5) break;
      }
    }
  } catch (error) {
    console.error('[SpellCheck] Error:', error);
  }

  return suggestions.slice(0, 5);
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Get spelling/fuzzy suggestions for a product search term
 */
export async function correctProductSearchTerm(
  searchTerm: string
): Promise<{ suggestions: string[]; wasCorrect: boolean }> {
  const suggestions = await getSuggestions(searchTerm);
  return {
    suggestions,
    wasCorrect: suggestions.length === 0,
  };
}

/**
 * Get spelling/fuzzy suggestions for a blog search term.
 * Uses same product/brand/category vocabulary since blog posts
 * often reference these terms.
 */
export async function correctBlogSearchTerm(
  searchTerm: string
): Promise<{ suggestions: string[]; wasCorrect: boolean }> {
  const suggestions = await getSuggestions(searchTerm);
  return {
    suggestions,
    wasCorrect: suggestions.length === 0,
  };
}

/**
 * Clear cached data
 */
export function clearSearchIndexes(): void {
  searchIndex = null;
  vocabularyTimestamp = 0;
  vocabularyLoading = null;
}
