/**
 * Search Index - Pre-indexes product/blog names for typo-tolerant spell checking
 * Uses Fuse.js to correct search terms BEFORE database queries
 */

import Fuse from 'fuse.js';
import { getClient } from '@/lib/apollo/client';
import { gql } from '@apollo/client';

// Simple query to get all product names
const GET_ALL_PRODUCT_NAMES = gql`
  query GetAllProductNames {
    products(first: 1000) {
      nodes {
        name
      }
    }
  }
`;

// Simple query to get all post titles
const GET_ALL_POST_TITLES = gql`
  query GetAllPostTitles {
    posts(first: 500, where: { status: PUBLISH }) {
      nodes {
        title
      }
    }
  }
`;

interface NameItem {
  name: string;
}

// Cache for indexes - avoid rebuilding on every search
let productNameIndex: Fuse<NameItem> | null = null;
let postTitleIndex: Fuse<NameItem> | null = null;
let productNameIndexTimestamp = 0;
let postTitleIndexTimestamp = 0;

// Cache for 5 minutes
const CACHE_TTL = 5 * 60 * 1000;

// Fuse.js options for spell checking
// Lower threshold = stricter matching (0 = exact, 1 = match anything)
const SPELL_CHECK_OPTIONS = {
  keys: ['name'],
  threshold: 0.4, // Stricter to avoid false matches like "whtie" -> "tie"
  distance: 100,  // Allow matches anywhere in the string
  ignoreLocation: true,
  includeScore: true,
  minMatchCharLength: 2,
  shouldSort: true,
};

/**
 * Build or get cached product name index
 */
async function getProductNameIndex(): Promise<Fuse<NameItem>> {
  const now = Date.now();

  if (productNameIndex && (now - productNameIndexTimestamp) < CACHE_TTL) {
    return productNameIndex;
  }

  try {
    const { data } = await getClient().query({
      query: GET_ALL_PRODUCT_NAMES,
      fetchPolicy: 'no-cache',
    });

    const productNames: string[] = (data?.products?.nodes || [])
      .map((p: { name: string }) => p.name?.toLowerCase())
      .filter((name: string) => name);

    // Extract individual words from product names for better matching
    // This ensures "purrple" matches "purple", not "venus butterfly ii-purple"
    const words = new Set<string>();
    productNames.forEach(name => {
      // Split on spaces, hyphens, and other separators
      name.split(/[\s\-_,]+/).forEach(word => {
        const cleanWord = word.replace(/[^a-z0-9]/g, '');
        if (cleanWord.length >= 3) {
          words.add(cleanWord);
        }
      });
    });

    // Also add common search terms that might not be in product names
    const commonTerms = [
      'vibrator', 'dildo', 'toy', 'silicone', 'rabbit', 'prostate',
      'massage', 'ring', 'pump', 'sleeve', 'lubricant', 'lube',
      'purple', 'pink', 'black', 'blue', 'red', 'white', 'green',
      'small', 'medium', 'large', 'mini', 'xl', 'rechargeable',
      'waterproof', 'wireless', 'remote', 'control', 'beginner'
    ];
    commonTerms.forEach(term => words.add(term));

    const allTerms = Array.from(words).map(name => ({ name }));

    productNameIndex = new Fuse(allTerms, SPELL_CHECK_OPTIONS);
    productNameIndexTimestamp = now;

    return productNameIndex;
  } catch (error) {
    console.error('Failed to build product name index:', error);
    // Return empty index on failure
    return new Fuse([], SPELL_CHECK_OPTIONS);
  }
}

/**
 * Build or get cached post title index
 */
async function getPostTitleIndex(): Promise<Fuse<NameItem>> {
  const now = Date.now();

  if (postTitleIndex && (now - postTitleIndexTimestamp) < CACHE_TTL) {
    return postTitleIndex;
  }

  try {
    const { data } = await getClient().query({
      query: GET_ALL_POST_TITLES,
      fetchPolicy: 'no-cache',
    });

    const titles: NameItem[] = (data?.posts?.nodes || [])
      .map((p: { title: string }) => ({ name: p.title.toLowerCase() }))
      .filter((item: NameItem) => item.name);

    // Extract individual words from titles for better matching
    const words = new Set<string>();
    titles.forEach(item => {
      item.name.split(/\s+/).forEach(word => {
        if (word.length >= 3) {
          words.add(word.replace(/[^a-z]/g, ''));
        }
      });
    });

    // Also add common blog terms
    const commonTerms = [
      'review', 'guide', 'tips', 'how', 'best', 'top', 'comparison',
      'versus', 'beginner', 'advanced', 'complete', 'ultimate'
    ];
    commonTerms.forEach(term => words.add(term));

    const allTerms = Array.from(words).map(name => ({ name }));

    postTitleIndex = new Fuse(allTerms, SPELL_CHECK_OPTIONS);
    postTitleIndexTimestamp = now;

    return postTitleIndex;
  } catch (error) {
    console.error('Failed to build post title index:', error);
    return new Fuse([], SPELL_CHECK_OPTIONS);
  }
}

// Type for Fuse.js search results
interface FuseSearchResult {
  item: NameItem;
  score?: number;
  refIndex: number;
}

/**
 * Find the best match from Fuse results, preferring similar word lengths
 * This prevents "whtie" from matching "tie" instead of "white"
 */
function findBestMatch(
  word: string,
  results: FuseSearchResult[]
): NameItem | null {
  if (results.length === 0) return null;

  // Filter to only include results with valid scores that indicate a typo
  const validResults = results.filter(
    r => r.score !== undefined && r.score > 0.05 && r.score < 0.5
  );

  if (validResults.length === 0) return null;

  // Score each result by combining Fuse score with length similarity
  // Strongly prefer matches where word length is similar (within ±1 character)
  const scored = validResults.map(r => {
    const lengthDiff = Math.abs(r.item.name.length - word.length);
    // Penalize matches with different lengths more aggressively
    // This prevents "whtie" (5 chars) from matching "tie" (3 chars) over "white" (5 chars)
    let lengthPenalty = 0;
    if (lengthDiff > 1) {
      // Strong penalty for words more than 1 character different in length
      lengthPenalty = lengthDiff * 0.15;
    }
    const combinedScore = (r.score || 0) + lengthPenalty;
    return { item: r.item, combinedScore };
  });

  // Sort by combined score (lower is better)
  scored.sort((a, b) => a.combinedScore - b.combinedScore);

  // Only return if the best match has a reasonable combined score
  if (scored[0].combinedScore < 0.5) {
    return scored[0].item;
  }

  return null;
}

/**
 * Find the best matching product search term using Fuse.js
 * Returns the corrected term if a good match is found, otherwise returns original
 */
export async function correctProductSearchTerm(
  searchTerm: string
): Promise<{ correctedTerm: string; wasCorrect: boolean }> {
  const index = await getProductNameIndex();
  const term = searchTerm.toLowerCase().trim();

  // Search for each word in the query
  const words = term.split(/\s+/);
  const correctedWords: string[] = [];
  let anyCorrections = false;

  for (const word of words) {
    if (word.length < 3) {
      correctedWords.push(word);
      continue;
    }

    const results = index.search(word);
    const bestMatch = findBestMatch(word, results);

    if (bestMatch) {
      correctedWords.push(bestMatch.name);
      anyCorrections = true;
    } else {
      correctedWords.push(word);
    }
  }

  const correctedTerm = correctedWords.join(' ');

  return {
    correctedTerm: anyCorrections ? correctedTerm : searchTerm,
    wasCorrect: !anyCorrections,
  };
}

/**
 * Find the best matching blog search term using Fuse.js
 * Returns the corrected term if a good match is found, otherwise returns original
 */
export async function correctBlogSearchTerm(
  searchTerm: string
): Promise<{ correctedTerm: string; wasCorrect: boolean }> {
  const index = await getPostTitleIndex();
  const term = searchTerm.toLowerCase().trim();

  // Search for each word in the query
  const words = term.split(/\s+/);
  const correctedWords: string[] = [];
  let anyCorrections = false;

  for (const word of words) {
    if (word.length < 3) {
      correctedWords.push(word);
      continue;
    }

    const results = index.search(word);
    const bestMatch = findBestMatch(word, results);

    if (bestMatch) {
      correctedWords.push(bestMatch.name);
      anyCorrections = true;
    } else {
      correctedWords.push(word);
    }
  }

  const correctedTerm = correctedWords.join(' ');

  return {
    correctedTerm: anyCorrections ? correctedTerm : searchTerm,
    wasCorrect: !anyCorrections,
  };
}

/**
 * Clear cached indexes (useful for testing or after product updates)
 */
export function clearSearchIndexes(): void {
  productNameIndex = null;
  postTitleIndex = null;
  productNameIndexTimestamp = 0;
  postTitleIndexTimestamp = 0;
}
