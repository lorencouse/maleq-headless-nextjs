import {
  simpleStem,
  tokenizeQuery,
  levenshteinDistance,
  isFuzzyMatch,
  textContainsTerm,
  countMatchingTerms,
  calculateRelevanceScore,
  matchesAllTerms,
  matchesAnyTerm,
  generateSpellingVariants,
  getTopSpellingCorrections,
} from '@/lib/utils/search-helpers';

describe('Search Helpers', () => {
  describe('simpleStem', () => {
    it('should not stem very short words', () => {
      expect(simpleStem('cat')).toBe('cat');
      expect(simpleStem('go')).toBe('go');
    });

    it('should stem plurals ending in -ies', () => {
      expect(simpleStem('batteries')).toBe('battery');
      expect(simpleStem('puppies')).toBe('puppy');
    });

    it('should stem plurals ending in -es after ch/sh/x/s/z', () => {
      expect(simpleStem('peaches')).toBe('peach');
      expect(simpleStem('boxes')).toBe('box');
      expect(simpleStem('dishes')).toBe('dish');
    });

    it('should stem words ending in -ing', () => {
      expect(simpleStem('running')).toBe('runn');
      expect(simpleStem('pumping')).toBe('pump');
    });

    it('should stem words ending in -ed', () => {
      expect(simpleStem('played')).toBe('play');
      expect(simpleStem('worked')).toBe('work');
    });

    it('should stem simple plurals', () => {
      expect(simpleStem('pumps')).toBe('pump');
      expect(simpleStem('rabbits')).toBe('rabbit');
    });

    it('should not stem words ending in -ss', () => {
      expect(simpleStem('glass')).toBe('glass');
      expect(simpleStem('boss')).toBe('boss');
    });
  });

  describe('tokenizeQuery', () => {
    it('should split query into words', () => {
      expect(tokenizeQuery('red pump')).toEqual(['red', 'pump']);
    });

    it('should filter stop words', () => {
      expect(tokenizeQuery('the red pump')).toEqual(['red', 'pump']);
      expect(tokenizeQuery('a toy for kids')).toEqual(['toy', 'kids']);
    });

    it('should remove punctuation', () => {
      expect(tokenizeQuery('red, pump!')).toEqual(['red', 'pump']);
    });

    it('should filter very short words', () => {
      expect(tokenizeQuery('a b cd pump')).toEqual(['cd', 'pump']);
    });

    it('should lowercase all terms', () => {
      expect(tokenizeQuery('RED Pump')).toEqual(['red', 'pump']);
    });
  });

  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(levenshteinDistance('rabbit', 'rabbit')).toBe(0);
    });

    it('should return correct distance for single character difference', () => {
      expect(levenshteinDistance('rabit', 'rabbit')).toBe(1); // missing 'b'
      expect(levenshteinDistance('rabbbit', 'rabbit')).toBe(1); // extra 'b'
    });

    it('should return correct distance for substitution', () => {
      expect(levenshteinDistance('rabbet', 'rabbit')).toBe(1); // e->i
    });

    it('should return correct distance for transposition-like errors', () => {
      expect(levenshteinDistance('rabibt', 'rabbit')).toBe(2); // swap requires 2 ops
    });

    it('should handle empty strings', () => {
      expect(levenshteinDistance('', 'rabbit')).toBe(6);
      expect(levenshteinDistance('rabbit', '')).toBe(6);
    });

    it('should be case insensitive', () => {
      expect(levenshteinDistance('RABBIT', 'rabbit')).toBe(0);
    });
  });

  describe('isFuzzyMatch', () => {
    it('should match exact strings', () => {
      expect(isFuzzyMatch('rabbit', 'rabbit')).toBe(true);
    });

    it('should match stems', () => {
      expect(isFuzzyMatch('rabbits', 'rabbit')).toBe(true);
      expect(isFuzzyMatch('pumps', 'pump')).toBe(true);
    });

    it('should match partial/prefix strings', () => {
      expect(isFuzzyMatch('rabbit', 'rabb')).toBe(true);
      expect(isFuzzyMatch('rabb', 'rabbit')).toBe(true);
    });

    it('should match with typos (Levenshtein)', () => {
      expect(isFuzzyMatch('rabit', 'rabbit')).toBe(true); // 1 char missing
      expect(isFuzzyMatch('rabbt', 'rabbit')).toBe(true); // 1 char missing
    });

    it('should not match very different strings', () => {
      expect(isFuzzyMatch('cat', 'rabbit')).toBe(false);
      expect(isFuzzyMatch('dog', 'pump')).toBe(false);
    });

    it('should allow more edits for longer words', () => {
      // Short words (<=3 chars) allow 0 edits
      expect(isFuzzyMatch('cat', 'bat')).toBe(false); // 1 edit, not allowed
      // Medium words (4-5 chars) allow 1 edit
      expect(isFuzzyMatch('pump', 'pimp')).toBe(true); // 1 edit
      // Longer words (>5 chars) allow 2 edits
      expect(isFuzzyMatch('rabbitt', 'rabbit')).toBe(true); // 1 edit
    });
  });

  describe('textContainsTerm', () => {
    it('should find direct matches', () => {
      expect(textContainsTerm('A cute rabbit toy', 'rabbit')).toBe(true);
      expect(textContainsTerm('Red pump for sale', 'pump')).toBe(true);
    });

    it('should find stem matches', () => {
      expect(textContainsTerm('Two rabbits playing', 'rabbit')).toBe(true);
      expect(textContainsTerm('High quality pumps', 'pump')).toBe(true);
    });

    it('should find fuzzy matches (typos)', () => {
      expect(textContainsTerm('A cute rabbit toy', 'rabit')).toBe(true); // typo: missing 'b'
      expect(textContainsTerm('A cute rabbit toy', 'rabbt')).toBe(true); // typo: missing 'i'
    });

    it('should handle null/empty inputs', () => {
      expect(textContainsTerm(null, 'rabbit')).toBe(false);
      expect(textContainsTerm(undefined, 'rabbit')).toBe(false);
      expect(textContainsTerm('', 'rabbit')).toBe(false);
      expect(textContainsTerm('rabbit', '')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(textContainsTerm('RABBIT TOY', 'rabbit')).toBe(true);
      expect(textContainsTerm('rabbit toy', 'RABBIT')).toBe(true);
    });
  });

  describe('countMatchingTerms', () => {
    it('should count matching terms', () => {
      expect(countMatchingTerms('Red rabbit toy', ['red', 'rabbit'])).toBe(2);
      expect(countMatchingTerms('Blue pump', ['red', 'pump'])).toBe(1);
    });

    it('should return 0 for no matches', () => {
      expect(countMatchingTerms('Blue pump', ['red', 'green'])).toBe(0);
    });

    it('should handle empty inputs', () => {
      expect(countMatchingTerms(null, ['red'])).toBe(0);
      expect(countMatchingTerms('red toy', [])).toBe(0);
    });
  });

  describe('matchesAllTerms', () => {
    it('should return true when all terms match', () => {
      expect(matchesAllTerms('Red rabbit toy', ['red', 'rabbit'])).toBe(true);
    });

    it('should return false when some terms missing', () => {
      expect(matchesAllTerms('Red toy', ['red', 'rabbit'])).toBe(false);
    });

    it('should work with fuzzy matches', () => {
      expect(matchesAllTerms('A rabit toy', ['rabbit', 'toy'])).toBe(true); // typo in text
    });
  });

  describe('matchesAnyTerm', () => {
    it('should return true when any term matches', () => {
      expect(matchesAnyTerm('Red toy', ['red', 'rabbit'])).toBe(true);
    });

    it('should return false when no terms match', () => {
      expect(matchesAnyTerm('Blue pump', ['red', 'rabbit'])).toBe(false);
    });

    it('should work with fuzzy matches', () => {
      expect(matchesAnyTerm('A rabit toy', ['rabbit'])).toBe(true); // typo in text
    });
  });

  describe('calculateRelevanceScore', () => {
    it('should score title matches higher', () => {
      const product1 = { name: 'Rabbit Toy', description: 'A toy' };
      const product2 = { name: 'A Toy', description: 'For your rabbit' };

      const score1 = calculateRelevanceScore(product1, ['rabbit']);
      const score2 = calculateRelevanceScore(product2, ['rabbit']);

      expect(score1).toBeGreaterThan(score2);
    });

    it('should give bonus for title starting with term', () => {
      const product1 = { name: 'Rabbit Toy' };
      const product2 = { name: 'Cute Rabbit' };

      const score1 = calculateRelevanceScore(product1, ['rabbit']);
      const score2 = calculateRelevanceScore(product2, ['rabbit']);

      expect(score1).toBeGreaterThan(score2);
    });

    it('should give bonus for all terms in title', () => {
      const product1 = { name: 'Red Rabbit Toy' };
      const product2 = { name: 'Red Toy', description: 'For your rabbit' };

      const score1 = calculateRelevanceScore(product1, ['red', 'rabbit']);
      const score2 = calculateRelevanceScore(product2, ['red', 'rabbit']);

      expect(score1).toBeGreaterThan(score2);
    });
  });

  describe('Real-world typo scenarios', () => {
    it('should handle common typos', () => {
      // Missing letter
      expect(textContainsTerm('rabbit vibrator', 'rabit')).toBe(true);
      expect(textContainsTerm('silicone toy', 'silicne')).toBe(true);

      // Double letter
      expect(textContainsTerm('rabbit toy', 'rabbbit')).toBe(true);

      // Wrong letter
      expect(textContainsTerm('rabbit toy', 'rabbet')).toBe(true);
    });

    it('should handle plurals and stems in search', () => {
      expect(textContainsTerm('rabbit toy', 'rabbits')).toBe(true);
      expect(textContainsTerm('toys for adults', 'toy')).toBe(true);
    });
  });

  describe('generateSpellingVariants', () => {
    it('should generate variants with added letters', () => {
      const variants = generateSpellingVariants('rabit');
      // Should include 'rabbit' (adding 'b')
      expect(variants).toContain('rabbit');
    });

    it('should generate variants with removed letters', () => {
      const variants = generateSpellingVariants('rabbbit');
      // Should include 'rabbit' (removing extra 'b')
      expect(variants).toContain('rabbit');
    });

    it('should generate variants with replaced letters', () => {
      const variants = generateSpellingVariants('rabbet');
      // Should include 'rabbit' (replacing 'e' with 'i')
      expect(variants).toContain('rabbit');
    });

    it('should generate variants with swapped letters', () => {
      const variants = generateSpellingVariants('rabibt');
      // Should include 'rabbit' (swapping 'b' and 'i')
      expect(variants).toContain('rabbit');
    });

    it('should skip very short words', () => {
      const variants = generateSpellingVariants('ab');
      expect(variants).toHaveLength(0);
    });

    it('should return unique variants', () => {
      const variants = generateSpellingVariants('test');
      const uniqueVariants = [...new Set(variants)];
      expect(variants.length).toBe(uniqueVariants.length);
    });
  });

  describe('getTopSpellingCorrections', () => {
    it('should return limited number of corrections', () => {
      const corrections = getTopSpellingCorrections('rabit', 3);
      expect(corrections.length).toBeLessThanOrEqual(3);
    });

    it('should prioritize words with double consonants', () => {
      const corrections = getTopSpellingCorrections('rabit', 10);
      // 'rabbit' should be in top results because it has 'bb'
      expect(corrections).toContain('rabbit');
    });

    it('should include the correct spelling for common typos', () => {
      // Missing letter
      expect(getTopSpellingCorrections('rabit', 5)).toContain('rabbit');

      // Extra letter
      expect(getTopSpellingCorrections('rabbbit', 5)).toContain('rabbit');
    });

    it('should handle transposed letters', () => {
      // reveiw -> review (swapped 'e' and 'i')
      const corrections = generateSpellingVariants('reveiw');
      expect(corrections).toContain('review');
    });

    it('should handle vowel transpositions', () => {
      // teh -> the (common typo, swapped letters)
      expect(generateSpellingVariants('teh')).toContain('the');

      // freind -> friend (swapped 'i' and 'e')
      const friendVariants = generateSpellingVariants('freind');
      expect(friendVariants).toContain('friend');
    });
  });
});
