#!/usr/bin/env bun

/**
 * Tag Capitalization Normalizer
 *
 * Normalizes tag names to Title Case while preserving acronyms and brand names
 *
 * Usage:
 *   bun scripts/normalize-tag-caps.ts [options]
 *
 * Options:
 *   --dry-run    Show what would be changed without making changes (default)
 *   --execute    Actually perform the changes
 */

import mysql from 'mysql2/promise';

// Local by Flywheel MySQL connection
const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

// Words that should stay uppercase (acronyms)
const UPPERCASE_WORDS = new Set([
  'bdsm',
  'hiv',
  'usa',
  'lgbtq',
  'lgbtq+',
  'sti',
  'q',  // For "Female Q"
]);

// Words that should stay lowercase (articles, prepositions, conjunctions)
const LOWERCASE_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor',
  'in', 'on', 'at', 'to', 'by', 'of', 'is',
]);

// Brand names with specific casing
const BRAND_NAMES: Record<string, string> = {
  'pjur': 'Pjur',
  'rogaine': 'Rogaine',
  'minoxidil': 'Minoxidil',
  'viagra': 'Viagra',
  'fleshlight': 'Fleshlight',
};

// Tags that should be left exactly as-is
const SKIP_TAGS = new Set([
  '男用套環',  // Chinese characters
]);

function toTitleCase(name: string): string {
  if (SKIP_TAGS.has(name)) {
    return name;
  }

  const words = name.split(/(\s+|-)/);  // Split by spaces or hyphens, keeping delimiters

  return words.map((word, index) => {
    const delimiter = /^(\s+|-)$/.test(word);
    if (delimiter) return word;

    const lowerWord = word.toLowerCase();

    // Check brand names first
    if (BRAND_NAMES[lowerWord]) {
      return BRAND_NAMES[lowerWord];
    }

    // Check acronyms (uppercase)
    if (UPPERCASE_WORDS.has(lowerWord)) {
      return word.toUpperCase();
    }

    // Check if it's a lowercase word (but capitalize if first word)
    if (index !== 0 && LOWERCASE_WORDS.has(lowerWord)) {
      return lowerWord;
    }

    // Standard title case: capitalize first letter
    return lowerWord.charAt(0).toUpperCase() + lowerWord.slice(1);
  }).join('');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  if (dryRun) {
    console.log('\n🔍 DRY RUN MODE - No changes will be made');
    console.log('   Run with --execute to apply changes\n');
  } else {
    console.log('\n⚠️  EXECUTE MODE - Changes will be applied!\n');
  }

  const connection = await mysql.createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });

  console.log('Connected to database\n');

  // Get all tags
  const [tags] = await connection.execute<any[]>(`
    SELECT t.term_id, t.name, t.slug, tt.count
    FROM wp_terms t
    JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
    WHERE tt.taxonomy = 'post_tag'
    ORDER BY t.name
  `);

  console.log(`Found ${tags.length} tags\n`);
  console.log('=== CAPITALIZATION CHANGES ===\n');

  let changeCount = 0;
  let skipCount = 0;

  for (const tag of tags) {
    const normalized = toTitleCase(tag.name);

    if (normalized !== tag.name) {
      changeCount++;
      console.log(`CHANGE: "${tag.name}" → "${normalized}" [id: ${tag.term_id}]`);

      if (!dryRun) {
        await connection.execute(
          'UPDATE wp_terms SET name = ? WHERE term_id = ?',
          [normalized, tag.term_id]
        );
        console.log('  ✓ Updated');
      }
    } else {
      skipCount++;
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Tags to change: ${changeCount}`);
  console.log(`Tags already correct: ${skipCount}`);
  console.log(`Total tags: ${tags.length}`);

  // Show final state
  if (!dryRun) {
    console.log('\n=== UPDATED TAGS ===\n');
    const [updatedTags] = await connection.execute<any[]>(`
      SELECT t.term_id, t.name, t.slug, tt.count
      FROM wp_terms t
      JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
      WHERE tt.taxonomy = 'post_tag'
      ORDER BY t.name
    `);

    updatedTags.forEach((tag: any) => {
      console.log(`"${tag.name}" (${tag.count} posts)`);
    });
  }

  await connection.end();

  if (dryRun) {
    console.log('\n📋 This was a dry run. Run with --execute to apply changes.');
  } else {
    console.log('\n✅ Tag capitalization normalized!');
  }
}

main().catch(console.error);
