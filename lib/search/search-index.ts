/**
 * Search Index - Spell checking and fuzzy suggestions
 *
 * Combines:
 * 1. simple-spellchecker for English word corrections
 * 2. Fuse.js for product-specific fuzzy matches (brands, product names)
 */

import SpellChecker, { Dictionary } from 'simple-spellchecker';
import Fuse from 'fuse.js';
import path from 'path';
import { getClient } from '@/lib/apollo/client';
import { gql } from '@apollo/client';

// ============================================================================
// Dictionary (English spell checking)
// ============================================================================

let dictionary: Dictionary | null = null;
let dictionaryLoading: Promise<Dictionary> | null = null;

async function getDictionary(): Promise<Dictionary> {
  if (dictionary) return dictionary;
  if (dictionaryLoading) return dictionaryLoading;

  const dictPath = path.join(process.cwd(), 'node_modules', 'simple-spellchecker', 'dict');

  dictionaryLoading = new Promise((resolve, reject) => {
    SpellChecker.getDictionary('en-US', dictPath, (err, dict) => {
      if (err || !dict) {
        console.error('[SpellCheck] Dictionary load error:', err);
        reject(err || new Error('Failed to load dictionary'));
        return;
      }
      dictionary = dict;
      resolve(dict);
    });
  });

  return dictionaryLoading;
}

// ============================================================================
// Product Vocabulary (Fuse.js fuzzy matching)
// ============================================================================

interface VocabularyItem {
  term: string;
  type: 'product' | 'brand' | 'category';
}

let productVocabulary: VocabularyItem[] | null = null;
let vocabularyTimestamp = 0;
let vocabularyLoading: Promise<VocabularyItem[]> | null = null;
const VOCABULARY_TTL = 10 * 60 * 1000; // 10 minutes

const GET_SEARCH_VOCABULARY = gql`
  query GetSearchVocabulary {
    products(first: 500) {
      nodes {
        name
      }
    }
    productBrands(first: 200) {
      nodes {
        name
      }
    }
    productCategories(first: 100, where: { hideEmpty: true }) {
      nodes {
        name
      }
    }
  }
`;

async function getProductVocabulary(): Promise<VocabularyItem[]> {
  const now = Date.now();

  if (productVocabulary && (now - vocabularyTimestamp) < VOCABULARY_TTL) {
    return productVocabulary;
  }

  if (vocabularyLoading) return vocabularyLoading;

  vocabularyLoading = (async () => {
    try {
      const { data } = await getClient().query({
        query: GET_SEARCH_VOCABULARY,
        fetchPolicy: 'no-cache',
      });

      const vocabulary: VocabularyItem[] = [];
      const seen = new Set<string>();

      // Extract unique words from product names
      const products = data?.products?.nodes || [];
      for (const p of products) {
        if (p.name) {
          // Add full product name
          const name = p.name.toLowerCase();
          if (!seen.has(name)) {
            seen.add(name);
            vocabulary.push({ term: name, type: 'product' });
          }
          // Also add individual significant words (3+ chars)
          const words = name.split(/[\s\-_,]+/);
          for (const word of words) {
            const clean = word.replace(/[^a-z]/g, '');
            if (clean.length >= 3 && !seen.has(clean)) {
              seen.add(clean);
              vocabulary.push({ term: clean, type: 'product' });
            }
          }
        }
      }

      // Add brand names
      const brands = data?.productBrands?.nodes || [];
      for (const b of brands) {
        if (b.name) {
          const name = b.name.toLowerCase();
          if (!seen.has(name)) {
            seen.add(name);
            vocabulary.push({ term: name, type: 'brand' });
          }
        }
      }

      // Add category names
      const categories = data?.productCategories?.nodes || [];
      for (const c of categories) {
        if (c.name) {
          const name = c.name.toLowerCase();
          if (!seen.has(name)) {
            seen.add(name);
            vocabulary.push({ term: name, type: 'category' });
          }
        }
      }

      productVocabulary = vocabulary;
      vocabularyTimestamp = now;
      vocabularyLoading = null;

      console.log(`[SpellCheck] Loaded ${vocabulary.length} vocabulary terms`);
      return vocabulary;
    } catch (error) {
      console.error('[SpellCheck] Failed to load vocabulary:', error);
      vocabularyLoading = null;
      return [];
    }
  })();

  return vocabularyLoading;
}

// ============================================================================
// Combined Suggestions
// ============================================================================

/**
 * Get spelling suggestions combining dictionary + product vocabulary
 * Handles multi-word queries by only correcting misspelled words
 */
async function getCombinedSuggestions(searchTerm: string): Promise<string[]> {
  const term = searchTerm.toLowerCase().trim();
  const words = term.split(/\s+/);
  const suggestions: string[] = [];
  const seen = new Set<string>();

  try {
    const dict = await getDictionary();
    const vocabulary = await getProductVocabulary();

    // Build Fuse index for vocabulary
    const fuse = vocabulary.length > 0
      ? new Fuse(vocabulary, {
          keys: ['term'],
          threshold: 0.4,
          distance: 100,
          includeScore: true,
        })
      : null;

    // Single word query
    if (words.length === 1 && words[0].length >= 3) {
      const word = words[0];

      // Get dictionary suggestions
      const dictSuggestions = dict.getSuggestions(word, 5, 3);
      for (const s of dictSuggestions) {
        const lower = s.toLowerCase();
        if (lower !== word && !seen.has(lower)) {
          seen.add(lower);
          suggestions.push(lower);
        }
      }

      // Get Fuse.js suggestions
      if (fuse) {
        const fuseResults = fuse.search(word, { limit: 5 });
        for (const result of fuseResults) {
          const suggestion = result.item.term;
          if (suggestion !== word && !seen.has(suggestion)) {
            seen.add(suggestion);
            suggestions.push(suggestion);
          }
        }
      }
    }
    // Multi-word query - get alternatives for each word (even if spelled correctly)
    // Since we only run this when search has 0 results, suggest alternatives
    else if (words.length > 1) {
      const wordAlternatives: Map<number, string[]> = new Map();

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (word.length < 3) continue;

        const alternatives: string[] = [];

        // Get dictionary suggestions (these are similar words)
        const dictSuggestions = dict.getSuggestions(word, 4, 3);
        for (const s of dictSuggestions) {
          const lower = s.toLowerCase();
          if (lower !== word && !alternatives.includes(lower)) {
            alternatives.push(lower);
          }
        }

        // Get Fuse.js suggestions from product vocabulary
        if (fuse) {
          const fuseResults = fuse.search(word, { limit: 3 });
          for (const result of fuseResults) {
            const suggestion = result.item.term;
            if (suggestion !== word && !alternatives.includes(suggestion)) {
              alternatives.push(suggestion);
            }
          }
        }

        if (alternatives.length > 0) {
          wordAlternatives.set(i, alternatives.slice(0, 3));
        }
      }

      console.log('[SpellCheck] Word alternatives:', Object.fromEntries(wordAlternatives));

      // Build full phrase suggestions by replacing words with alternatives
      if (wordAlternatives.size > 0) {
        // Try alternatives for each word that has them
        for (const [wordIndex, alternatives] of wordAlternatives) {
          for (const alt of alternatives) {
            const newPhrase = words.map((w, i) =>
              i === wordIndex ? alt : w
            ).join(' ');

            if (!seen.has(newPhrase) && newPhrase !== term) {
              seen.add(newPhrase);
              suggestions.push(newPhrase);
            }

            // Stop if we have enough suggestions
            if (suggestions.length >= 5) break;
          }
          if (suggestions.length >= 5) break;
        }
      }
    }
  } catch (error) {
    console.error('[SpellCheck] Error:', error);
  }

  // Return top 5 unique suggestions
  const final = suggestions.slice(0, 5);
  console.log(`[SpellCheck] Suggestions for "${term}":`, final);
  return final;
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
  const suggestions = await getCombinedSuggestions(searchTerm);
  return {
    suggestions,
    wasCorrect: suggestions.length === 0,
  };
}

/**
 * Get spelling/fuzzy suggestions for a blog search term
 */
export async function correctBlogSearchTerm(
  searchTerm: string
): Promise<{ suggestions: string[]; wasCorrect: boolean }> {
  // Blog uses only dictionary suggestions (no product vocabulary)
  const suggestions: string[] = [];

  try {
    const dict = await getDictionary();
    const term = searchTerm.toLowerCase().trim();
    const words = term.split(/\s+/);

    if (words.length === 1 && words[0].length >= 3) {
      const dictSuggestions = dict.getSuggestions(words[0], 5, 3);
      for (const s of dictSuggestions) {
        const lower = s.toLowerCase();
        if (lower !== term && suggestions.length < 5) {
          suggestions.push(lower);
        }
      }
    }
  } catch (error) {
    console.error('[SpellCheck] Blog spell check error:', error);
  }

  return {
    suggestions,
    wasCorrect: suggestions.length === 0,
  };
}

/**
 * Clear cached data
 */
export function clearSearchIndexes(): void {
  dictionary = null;
  dictionaryLoading = null;
  productVocabulary = null;
  vocabularyTimestamp = 0;
  vocabularyLoading = null;
}
