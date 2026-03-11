/**
 * Normalize Product Title Capitalization
 *
 * Converts product titles to title case:
 * - First letter of the title is always capitalized
 * - Major words are capitalized
 * - Minor words (the, of, in, and, etc.) are lowercase unless first word
 * - Preserves known acronyms/abbreviations (USB, LED, CBD, etc.)
 * - Preserves words that are already intentionally mixed-case (e.g. "iPhone")
 * - Lowercases standalone units after numbers (5 oz, 10 ml)
 * - Handles w/ and w/o prefixes attached to words (W/hemp → w/ Hemp)
 *
 * Usage:
 *   bun run scripts/normalize-title-caps.ts --local --dry-run
 *   bun run scripts/normalize-title-caps.ts --local
 *   bun run scripts/normalize-title-caps.ts              # remote (needs SSH tunnel)
 *
 * Flags:
 *   --local     Connect to local DB
 *   --dry-run   Preview changes without writing to DB
 *   --limit N   Process only N products (for testing)
 */

import { getConnection } from './lib/db';

const isDryRun = process.argv.includes('--dry-run');
const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : 0;

// Words that should remain lowercase (unless first word of the title)
const MINOR_WORDS = new Set([
  'a', 'an', 'the',           // articles
  'and', 'but', 'or', 'nor',  // conjunctions
  'for', 'yet', 'so',         // conjunctions
  'in', 'on', 'at', 'to',     // prepositions
  'of', 'by', 'up', 'as',     // prepositions
  'with', 'from', 'into',     // prepositions
  'per', 'via', 'vs',         // prepositions/misc
  'n',                         // informal "and" (e.g. "Sweet n Small")
]);

// Standalone units that should be lowercase when following a number
const UNITS = new Set([
  'oz', 'ml', 'mm', 'cm', 'm', 'ft', 'in',
  'lb', 'lbs', 'kg', 'mg', 'g',
  'pc', 'pcs', 'pk', 'ct', 'dsp',
]);

// Words/abbreviations that should always stay uppercase (explicit allowlist only)
const PRESERVE_UPPER = new Set([
  'USB', 'LED', 'XL', 'XXL', 'XXXL', 'XS', 'XXS',
  'CBD', 'THC', 'UV', 'IPX6', 'IPX7',
  'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII',
  'BMS', 'DJ', 'FX', 'HD', 'VR', 'AR', 'BBC',
  'O/S', 'Q/S', 'S/M', 'M/L', 'L/XL',
  'pH',
]);

/**
 * Check if a word is already intentionally mixed case (not all-upper or all-lower).
 * e.g. "iPhone", "McLaren" — these should be preserved.
 */
function isIntentionalMixedCase(word: string): boolean {
  if (word === word.toUpperCase()) return false;
  if (word === word.toLowerCase()) return false;
  if (word === word[0].toUpperCase() + word.slice(1).toLowerCase()) return false;
  return true;
}

/**
 * Convert a single word to title case, respecting special rules.
 */
function titleCaseWord(word: string, isFirstWord: boolean, prevWordIsNumber: boolean): string {
  if (!word) return word;

  const lowerWord = word.toLowerCase();
  const upperWord = word.toUpperCase();

  // Preserve known acronyms/abbreviations
  if (PRESERVE_UPPER.has(upperWord)) return upperWord;

  // Preserve already intentionally mixed-case words
  if (isIntentionalMixedCase(word)) return word;

  // Handle number+unit combos (e.g. "8IN" → "8in", "6OZ" → "6oz")
  if (/^\d+(\.\d+)?(in|oz|ml|mm|cm|m|ft|lb|lbs|pc|pcs|pk|ct|mg|kg|g)$/i.test(word)) {
    return word.toLowerCase();
  }

  // Standalone units after a number: "5 oz" → "5 oz" (not "5 Oz")
  if (prevWordIsNumber && UNITS.has(lowerWord)) {
    return lowerWord;
  }

  // Minor words: lowercase unless first word
  if (!isFirstWord && MINOR_WORDS.has(lowerWord)) {
    return lowerWord;
  }

  // Default: capitalize first letter, lowercase rest
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Convert a full title to proper title case.
 */
function toTitleCase(title: string): string {
  // Split on whitespace while preserving separators
  const parts = title.split(/(\s+)/);
  let isFirstWord = true;
  let prevWordIsNumber = false;

  const result = parts.map((part) => {
    // Whitespace — pass through
    if (/^\s+$/.test(part)) return part;

    // Handle w/ or w/o prefix attached to next word (e.g. "W/hemp" → "w/ Hemp")
    const wPrefixMatch = part.match(/^(w\/o?)(.)(.*)$/i);
    if (wPrefixMatch) {
      const [, prefix, firstChar, rest] = wPrefixMatch;
      if (firstChar && /[a-zA-Z]/.test(firstChar)) {
        // It's w/ attached to a word — split it
        const wordPart = firstChar + rest;
        const tcWord = titleCaseWord(wordPart, false, false);
        isFirstWord = false;
        prevWordIsNumber = false;
        return prefix.toLowerCase() + ' ' + tcWord;
      }
    }

    // Handle words with punctuation attached (e.g. "OUCH!" → "Ouch!")
    const match = part.match(/^([^a-zA-Z0-9]*)([a-zA-Z0-9/'.&-]*)([^a-zA-Z0-9]*)$/);
    if (!match) {
      isFirstWord = false;
      prevWordIsNumber = false;
      return part;
    }

    const [, leadPunct, word, trailPunct] = match;

    if (!word) {
      return part; // Pure punctuation
    }

    // Handle hyphenated words: capitalize each part
    let converted: string;
    if (word.includes('-')) {
      converted = word.split('-').map((sub, i) => {
        return titleCaseWord(sub, isFirstWord && i === 0, false);
      }).join('-');
    } else {
      converted = titleCaseWord(word, isFirstWord, prevWordIsNumber);
    }

    // Track state for next word
    isFirstWord = false;
    prevWordIsNumber = /^\d+(\.\d+)?$/.test(word);

    return leadPunct + converted + trailPunct;
  });

  return result.join('');
}

async function main() {
  const db = await getConnection();

  console.log(isDryRun ? '🔍 DRY RUN — no changes will be saved\n' : '✏️  LIVE RUN — changes will be saved to DB\n');

  const limitClause = limit > 0 ? `LIMIT ${limit}` : '';
  const [rows] = await db.execute(
    `SELECT ID, post_title FROM wp_posts
     WHERE post_type IN ('product', 'product_variation')
     AND post_status = 'publish'
     ${limitClause}`
  ) as any[];

  console.log(`Scanning ${rows.length} products/variations...\n`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const newTitle = toTitleCase(row.post_title);

    if (newTitle === row.post_title) {
      skipped++;
      continue;
    }

    updated++;

    if (isDryRun) {
      if (updated <= 50) {
        console.log(`  "${row.post_title}"`);
        console.log(`→ "${newTitle}"\n`);
      }
    } else {
      await db.execute('UPDATE wp_posts SET post_title = ? WHERE ID = ?', [newTitle, row.ID]);
    }
  }

  if (isDryRun && updated > 50) {
    console.log(`... and ${updated - 50} more changes\n`);
  }

  console.log(`✅ Done: ${updated} updated, ${skipped} unchanged`);

  await db.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
