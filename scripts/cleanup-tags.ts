#!/usr/bin/env bun

/**
 * Tag Cleanup Script
 *
 * Normalizes and merges duplicate/similar tags in WordPress
 *
 * Usage:
 *   bun scripts/cleanup-tags.ts [options]
 *
 * Options:
 *   --dry-run    Show what would be changed without making changes
 *   --execute    Actually perform the changes
 */

import { getConnection } from './lib/db';

interface Tag {
  term_id: number;
  name: string;
  slug: string;
  count: number;
}

// Define tag merges: [tags to merge] -> target tag name
const TAG_MERGES: { sources: string[]; target: string }[] = [
  // Duplicates
  { sources: ['non-binary'], target: 'Non-Binary' }, // merge both into one with proper casing

  // Singular/Plural - keep plural
  { sources: ['Butt Plug'], target: 'Butt Plugs' },
  { sources: ['condoms'], target: 'Condoms' }, // standardize to plural with caps
  { sources: ['condom'], target: 'Condoms' },
  { sources: ['Cockring'], target: 'Cock Rings' },
  { sources: ['dildo'], target: 'Dildos' },
  { sources: ['Enema'], target: 'Enemas' },
  { sources: ['enemas'], target: 'Enemas' },
  { sources: ['Lube', 'Lubricants'], target: 'Lubes' },
  { sources: ['relationship'], target: 'Relationships' },
  { sources: ['Relationships'], target: 'Relationships' },

  // Typos and similar
  { sources: ['Reveiw', 'Review'], target: 'Reviews' },
  { sources: ['dex toys', 'sen toys'], target: 'Sex Toys' },
  { sources: ['Best'], target: 'The Best' },
];

// Tags to delete (spam or empty)
const TAGS_TO_DELETE = [
  'Legacies S01E05 Online',
  'Vi Keeland Hate Notes ebook',
  'gay sex toys', // 0 posts
  'sen toys', // 0 posts, typo
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  if (dryRun) {
    console.log('\n🔍 DRY RUN MODE - No changes will be made');
    console.log('   Run with --execute to apply changes\n');
  } else {
    console.log('\n⚠️  EXECUTE MODE - Changes will be applied!\n');
  }

  const connection = await getConnection();

  console.log('Connected to database\n');

  // Get all tags
  const [tags] = await connection.execute<any[]>(`
    SELECT t.term_id, t.name, t.slug, tt.count, tt.term_taxonomy_id
    FROM wp_terms t
    JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
    WHERE tt.taxonomy = 'post_tag'
    ORDER BY t.name
  `);

  console.log(`Found ${tags.length} tags\n`);

  // Build lookup by name (case-insensitive)
  const tagsByName = new Map<string, any>();
  const tagsBySlug = new Map<string, any>();
  for (const tag of tags) {
    tagsByName.set(tag.name.toLowerCase(), tag);
    tagsBySlug.set(tag.slug.toLowerCase(), tag);
  }

  // Process deletions
  console.log('=== DELETIONS ===\n');
  for (const tagName of TAGS_TO_DELETE) {
    const tag = tagsByName.get(tagName.toLowerCase());
    if (tag) {
      console.log(`DELETE: "${tag.name}" (${tag.count} posts) [id: ${tag.term_id}]`);
      if (!dryRun) {
        // Delete term relationships first
        await connection.execute(
          'DELETE FROM wp_term_relationships WHERE term_taxonomy_id = ?',
          [tag.term_taxonomy_id]
        );
        // Delete term taxonomy
        await connection.execute(
          'DELETE FROM wp_term_taxonomy WHERE term_id = ?',
          [tag.term_id]
        );
        // Delete term
        await connection.execute(
          'DELETE FROM wp_terms WHERE term_id = ?',
          [tag.term_id]
        );
        console.log(`  ✓ Deleted`);
      }
    } else {
      console.log(`SKIP: "${tagName}" not found`);
    }
  }

  // Process merges
  console.log('\n=== MERGES ===\n');
  for (const merge of TAG_MERGES) {
    const targetTag = tagsByName.get(merge.target.toLowerCase()) ||
                      tagsBySlug.get(merge.target.toLowerCase().replace(/\s+/g, '-'));

    if (!targetTag) {
      console.log(`TARGET NOT FOUND: "${merge.target}" - skipping this merge`);
      continue;
    }

    console.log(`MERGE INTO: "${targetTag.name}" [id: ${targetTag.term_id}]`);

    for (const sourceName of merge.sources) {
      const sourceTag = tagsByName.get(sourceName.toLowerCase()) ||
                        tagsBySlug.get(sourceName.toLowerCase().replace(/\s+/g, '-'));

      if (!sourceTag) {
        console.log(`  - "${sourceName}" not found, skipping`);
        continue;
      }

      if (sourceTag.term_id === targetTag.term_id) {
        console.log(`  - "${sourceName}" is the target, skipping`);
        continue;
      }

      console.log(`  - "${sourceTag.name}" (${sourceTag.count} posts) [id: ${sourceTag.term_id}]`);

      if (!dryRun) {
        // Update relationships to point to target
        await connection.execute(`
          UPDATE IGNORE wp_term_relationships
          SET term_taxonomy_id = ?
          WHERE term_taxonomy_id = ?
        `, [targetTag.term_taxonomy_id, sourceTag.term_taxonomy_id]);

        // Delete any remaining relationships (duplicates)
        await connection.execute(
          'DELETE FROM wp_term_relationships WHERE term_taxonomy_id = ?',
          [sourceTag.term_taxonomy_id]
        );

        // Delete source term taxonomy
        await connection.execute(
          'DELETE FROM wp_term_taxonomy WHERE term_id = ?',
          [sourceTag.term_id]
        );

        // Delete source term
        await connection.execute(
          'DELETE FROM wp_terms WHERE term_id = ?',
          [sourceTag.term_id]
        );

        console.log(`    ✓ Merged and deleted`);
      }
    }
    console.log('');
  }

  // Update counts for all tags
  if (!dryRun) {
    console.log('=== UPDATING COUNTS ===\n');
    await connection.execute(`
      UPDATE wp_term_taxonomy tt
      SET count = (
        SELECT COUNT(*) FROM wp_term_relationships tr
        WHERE tr.term_taxonomy_id = tt.term_taxonomy_id
      )
      WHERE tt.taxonomy = 'post_tag'
    `);
    console.log('✓ Tag counts updated\n');
  }

  // Show remaining tags
  const [remainingTags] = await connection.execute<any[]>(`
    SELECT t.term_id, t.name, t.slug, tt.count
    FROM wp_terms t
    JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
    WHERE tt.taxonomy = 'post_tag'
    ORDER BY t.name
  `);

  console.log(`\n=== REMAINING TAGS (${remainingTags.length}) ===\n`);
  remainingTags.forEach((tag: any) => {
    console.log(`"${tag.name}" (${tag.count} posts)`);
  });

  await connection.end();

  if (dryRun) {
    console.log('\n📋 This was a dry run. Run with --execute to apply changes.');
  } else {
    console.log('\n✅ Tag cleanup complete!');
  }
}

main().catch(console.error);
