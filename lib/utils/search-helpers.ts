/**
 * Search utility functions for improved relevance and fuzzy matching
 */

/**
 * Simple English stemmer for common word variations
 * Handles plurals, -ing, -ed suffixes
 */
export function simpleStem(word: string): string {
  const lower = word.toLowerCase();

  // Don't stem very short words
  if (lower.length <= 3) return lower;

  // Handle common suffixes (order matters - check longer suffixes first)
  if (lower.endsWith('ies') && lower.length > 4) {
    return lower.slice(0, -3) + 'y'; // batteries -> battery
  }
  if (lower.endsWith('es') && lower.length > 3) {
    // Don't remove 'es' from words like 'yes', 'goes'
    const stem = lower.slice(0, -2);
    if (stem.endsWith('ch') || stem.endsWith('sh') || stem.endsWith('x') || stem.endsWith('s') || stem.endsWith('z')) {
      return stem; // peaches -> peach, boxes -> box
    }
    return lower.slice(0, -1); // Just remove the 's' for other cases
  }
  if (lower.endsWith('ing') && lower.length > 5) {
    return lower.slice(0, -3); // running -> runn, pumping -> pump
  }
  if (lower.endsWith('ed') && lower.length > 4) {
    return lower.slice(0, -2); // played -> play
  }
  if (lower.endsWith('s') && lower.length > 3 && !lower.endsWith('ss')) {
    return lower.slice(0, -1); // pumps -> pump
  }

  return lower;
}

/**
 * Tokenize search query into individual terms
 * Filters out very short words and common stop words
 */
export function tokenizeQuery(query: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'is', 'it', 'as', 'be', 'are', 'was', 'were'
  ]);

  return query
    .toLowerCase()
    .split(/\s+/)
    .map(term => term.replace(/[^a-z0-9]/g, '')) // Remove punctuation
    .filter(term => term.length > 1 && !stopWords.has(term));
}

/**
 * Calculate Levenshtein distance between two strings
 * Returns the minimum number of single-character edits needed
 */
export function levenshteinDistance(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 0;
  if (aLower.length === 0) return bLower.length;
  if (bLower.length === 0) return aLower.length;

  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= bLower.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= aLower.length; j++) {
    matrix[0][j] = j;
  }

  // Fill the matrix
  for (let i = 1; i <= bLower.length; i++) {
    for (let j = 1; j <= aLower.length; j++) {
      const cost = aLower[j - 1] === bLower[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // Deletion
        matrix[i][j - 1] + 1,      // Insertion
        matrix[i - 1][j - 1] + cost // Substitution
      );
    }
  }

  return matrix[bLower.length][aLower.length];
}

/**
 * Check if two words are a fuzzy match based on Levenshtein distance
 * Allows more edits for longer words
 */
export function isFuzzyMatch(word1: string, word2: string, maxDistance?: number): boolean {
  const w1 = word1.toLowerCase();
  const w2 = word2.toLowerCase();

  // Exact match
  if (w1 === w2) return true;

  // Stem match
  if (simpleStem(w1) === simpleStem(w2)) return true;

  // One starts with the other (partial match)
  if (w1.startsWith(w2) || w2.startsWith(w1)) return true;

  // Calculate allowed distance based on word length
  const minLength = Math.min(w1.length, w2.length);
  const allowedDistance = maxDistance ?? (minLength <= 3 ? 0 : minLength <= 5 ? 1 : 2);

  // Check Levenshtein distance
  const distance = levenshteinDistance(w1, w2);
  return distance <= allowedDistance;
}

/**
 * Check if a text contains a search term (with fuzzy matching)
 * Returns true if the term or a fuzzy variant is found
 */
export function textContainsTerm(text: string | null | undefined, searchTerm: string): boolean {
  if (!text || !searchTerm) return false;

  const textLower = text.toLowerCase();
  const termLower = searchTerm.toLowerCase();
  const termStem = simpleStem(termLower);

  // Direct match
  if (textLower.includes(termLower)) return true;

  // Stem match - check if any word in text matches the stem
  const textWords = textLower.split(/\s+/);
  for (const word of textWords) {
    const cleanWord = word.replace(/[^a-z0-9]/g, '');
    if (simpleStem(cleanWord) === termStem) return true;
  }

  return false;
}

/**
 * Count how many search terms match in a text (with fuzzy matching)
 * Returns count of unique terms that match
 */
export function countMatchingTerms(
  text: string | null | undefined,
  searchTerms: string[]
): number {
  if (!text || searchTerms.length === 0) return 0;

  return searchTerms.filter(term => textContainsTerm(text, term)).length;
}

/**
 * Calculate a relevance score for a product/post based on search terms
 * Higher score = more relevant
 */
export function calculateRelevanceScore(
  item: {
    name?: string;
    title?: string;
    description?: string | null;
    shortDescription?: string | null;
    excerpt?: string | null;
  },
  searchTerms: string[]
): number {
  const title = item.name || item.title || '';
  const description = item.description || '';
  const shortDesc = item.shortDescription || item.excerpt || '';

  let score = 0;

  for (const term of searchTerms) {
    // Title matches are worth more (10 points)
    if (textContainsTerm(title, term)) {
      score += 10;
      // Bonus if title starts with the term
      if (title.toLowerCase().startsWith(term.toLowerCase())) {
        score += 5;
      }
    }

    // Short description matches (3 points)
    if (textContainsTerm(shortDesc, term)) {
      score += 3;
    }

    // Description matches (1 point per occurrence, max 5)
    if (description) {
      const termLower = term.toLowerCase();
      const matches = (description.toLowerCase().match(new RegExp(termLower, 'g')) || []).length;
      score += Math.min(matches, 5);
    }
  }

  // Bonus for matching all terms
  const titleTermsMatched = searchTerms.filter(t => textContainsTerm(title, t)).length;
  if (titleTermsMatched === searchTerms.length && searchTerms.length > 1) {
    score += 20; // All terms in title bonus
  }

  return score;
}

/**
 * Check if a text matches all search terms (with fuzzy matching)
 */
export function matchesAllTerms(
  text: string | null | undefined,
  searchTerms: string[]
): boolean {
  if (!text || searchTerms.length === 0) return false;
  return searchTerms.every(term => textContainsTerm(text, term));
}

/**
 * Check if a text matches any search term (with fuzzy matching)
 */
export function matchesAnyTerm(
  text: string | null | undefined,
  searchTerms: string[]
): boolean {
  if (!text || searchTerms.length === 0) return false;
  return searchTerms.some(term => textContainsTerm(text, term));
}
