/**
 * Text Utility Functions
 *
 * Common text manipulation functions for formatting,
 * cleaning, and transforming text content.
 */

import DOMPurify from 'dompurify';

/** Words that should remain lowercase in title case (unless first word) */
const LOWERCASE_WORDS = [
  'the', 'a', 'an', 'and', 'but', 'or', 'for', 'nor',
  'on', 'at', 'to', 'from', 'by', 'of', 'in', 'with'
];

/**
 * Convert text to title case
 * Capitalizes first letter of major words.
 * Keeps articles, conjunctions, and prepositions lowercase (unless first word).
 *
 * @example
 * toTitleCase('the quick brown fox') // 'The Quick Brown Fox'
 * toTitleCase('a tale of two cities') // 'A Tale of Two Cities'
 */
export function toTitleCase(text: string): string {
  return text
    .toLowerCase()
    .split(' ')
    .map((word, index) => {
      // Always capitalize first word
      if (index === 0) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      // Lowercase articles, conjunctions, prepositions
      if (LOWERCASE_WORDS.includes(word)) {
        return word;
      }
      // Capitalize other words
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Generate a URL-safe slug from text
 *
 * @example
 * generateSlug('Hello World!') // 'hello-world'
 * generateSlug('Product Name (2024)') // 'product-name-2024'
 */
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Truncate text to a maximum length, adding ellipsis if truncated
 *
 * @example
 * truncateText('Hello World', 5) // 'Hello...'
 * truncateText('Hi', 10) // 'Hi'
 */
export function truncateText(text: string, maxLength: number, suffix = '...'): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - suffix.length).trim() + suffix;
}

/**
 * Remove excessive whitespace from text
 * Collapses multiple spaces/newlines into single spaces
 *
 * @example
 * normalizeWhitespace('hello   world\n\ntest') // 'hello world test'
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Remove HTML tags from text (with XSS protection)
 *
 * @example
 * stripHtml('<p>Hello <strong>World</strong></p>') // 'Hello World'
 */
export function stripHtml(html: string): string {
  // Use DOMPurify to safely strip HTML (prevents XSS)
  if (typeof window !== 'undefined') {
    return DOMPurify.sanitize(html, { ALLOWED_TAGS: [], RETURN_TRUSTED_TYPE: false }) as string;
  }
  // Server-side fallback - still safe as we're only stripping
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Sanitize HTML content while allowing safe tags
 * Use this when you need to render HTML but want XSS protection
 *
 * @example
 * sanitizeHtml('<p>Hello</p><script>alert("xss")</script>') // '<p>Hello</p>'
 */
export function sanitizeHtml(html: string, options?: {
  allowedTags?: string[];
  allowedAttributes?: Record<string, string[]>;
}): string {
  if (typeof window !== 'undefined') {
    const config: { ALLOWED_TAGS?: string[]; ALLOWED_ATTR?: string[]; RETURN_TRUSTED_TYPE?: boolean } = {
      RETURN_TRUSTED_TYPE: false,
    };

    if (options?.allowedTags) {
      config.ALLOWED_TAGS = options.allowedTags;
    }

    if (options?.allowedAttributes) {
      config.ALLOWED_ATTR = Object.values(options.allowedAttributes).flat();
    }

    return DOMPurify.sanitize(html, config) as string;
  }

  // Server-side: strip all HTML as fallback
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Clean HTML entities
 *
 * @example
 * decodeHtmlEntities('Hello&nbsp;World') // 'Hello World'
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Extract first N sentences from text
 *
 * @example
 * extractSentences('Hello. World. Test.', 2) // 'Hello. World.'
 */
export function extractSentences(text: string, count: number): string {
  const plainText = stripHtml(text);
  const sentences = plainText.match(/[^.!?]+[.!?]+/g) || [];

  if (sentences.length === 0) {
    return plainText;
  }

  return sentences
    .slice(0, count)
    .map(s => s.trim())
    .join(' ');
}

/**
 * Generate a short description from longer text
 * Extracts 2-3 sentences up to maxLength characters
 *
 * @example
 * generateShortDescription('First sentence. Second sentence. Third sentence.', 50)
 */
export function generateShortDescription(text: string, maxLength = 160): string {
  if (!text) return '';

  const plainText = stripHtml(text);
  const sentences = plainText.match(/[^.!?]+[.!?]+/g) || [];

  if (sentences.length === 0) {
    return truncateText(plainText, maxLength);
  }

  let result = '';
  for (let i = 0; i < Math.min(3, sentences.length); i++) {
    const sentence = sentences[i].trim();
    if ((result + sentence).length <= maxLength) {
      result += (result ? ' ' : '') + sentence;
    } else if (result) {
      break;
    } else {
      // First sentence is too long, truncate it
      return truncateText(sentence, maxLength);
    }
  }

  return result || truncateText(plainText, maxLength);
}

/**
 * Clean product name
 * Removes flags, excessive whitespace, trailing punctuation
 *
 * @example
 * cleanProductName('PRODUCT NAME RESTRICTED...') // 'Product Name'
 */
export function cleanProductName(name: string, maxLength = 200): string {
  return toTitleCase(
    name
      .replace(/RESTRICTED/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/\.+$/, '')
      .trim()
      .substring(0, maxLength)
  );
}

/**
 * Clean description text
 * Removes year markers, cleans entities, normalizes line breaks
 *
 * @example
 * cleanDescription('Product description 2024.') // 'Product description'
 */
export function cleanDescription(description: string): string {
  return description
    .replace(/20\d{2}\.?\s*$/g, '') // Remove year markers at end
    .replace(/\n\n+/g, '\n\n') // Normalize line breaks
    .replace(/&nbsp;/g, ' ') // Clean HTML entities
    .trim();
}

/**
 * Capitalize first letter of string
 *
 * @example
 * capitalize('hello world') // 'Hello world'
 */
export function capitalize(text: string): string {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Convert string to camelCase
 *
 * @example
 * toCamelCase('hello-world') // 'helloWorld'
 * toCamelCase('Hello World') // 'helloWorld'
 */
export function toCamelCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase());
}

/**
 * Convert string to kebab-case
 *
 * @example
 * toKebabCase('Hello World') // 'hello-world'
 * toKebabCase('helloWorld') // 'hello-world'
 */
export function toKebabCase(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/**
 * Count words in text
 *
 * @example
 * countWords('Hello world test') // 3
 */
export function countWords(text: string): number {
  const words = text.trim().split(/\s+/);
  return words[0] === '' ? 0 : words.length;
}

/**
 * Check if string is empty or whitespace only
 *
 * @example
 * isBlank('   ') // true
 * isBlank('hello') // false
 */
export function isBlank(text: string | null | undefined): boolean {
  return !text || text.trim().length === 0;
}
