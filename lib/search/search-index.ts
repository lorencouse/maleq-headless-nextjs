/**
 * Search Index - Fuzzy suggestions using MiniSearch
 *
 * Builds vocabulary from the in-memory product index (SQL-backed).
 * No GraphQL or static JSON cache needed.
 */

import MiniSearch from 'minisearch';

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

function buildIndexFromVocabulary(
  productNames: string[],
  brandNames: string[],
  categoryNames: string[],
): MiniSearch<VocabularyItem> {
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
  for (const b of brandNames) {
    const name = b.toLowerCase();
    if (!seen.has(name)) {
      seen.add(name);
      index.add({ id: String(idCounter++), term: name, type: 'brand' });
    }
  }

  // Add category names
  for (const c of categoryNames) {
    const name = c.toLowerCase();
    if (!seen.has(name)) {
      seen.add(name);
      index.add({ id: String(idCounter++), term: name, type: 'category' });
    }
  }

  console.log(`[SpellCheck] Loaded ${idCounter} vocabulary terms from ${productNames.length} products into MiniSearch`);
  return index;
}

async function getSearchIndex(): Promise<MiniSearch<VocabularyItem>> {
  const now = Date.now();

  if (searchIndex && (now - vocabularyTimestamp) < VOCABULARY_TTL) {
    return searchIndex;
  }

  if (vocabularyLoading) return vocabularyLoading;

  vocabularyLoading = (async () => {
    try {
      // Build vocabulary from the in-memory product index (SQL-backed)
      const { getAllIndexEntries } = await import('@/lib/products/product-index');
      const entries = await getAllIndexEntries();

      const productNames = entries.map(e => e.name);
      const brandSet = new Set<string>();
      const categorySet = new Set<string>();

      for (const entry of entries) {
        if (entry.brandName) brandSet.add(entry.brandName);
        for (const catName of entry.categoryNames) {
          categorySet.add(catName);
        }
      }

      const index = buildIndexFromVocabulary(
        productNames,
        Array.from(brandSet),
        Array.from(categorySet),
      );
      searchIndex = index;
      vocabularyTimestamp = now;
      vocabularyLoading = null;
      console.log('[SpellCheck] Built vocabulary from product index');
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
