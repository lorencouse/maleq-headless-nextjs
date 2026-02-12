#!/usr/bin/env bun
/**
 * Fix old nested /sex-toys/ URLs in post content to flat /sex-toys/{slug}/ paths.
 *
 * Old maleq.com used nested paths like /sex-toys/male-sex-toys/cock-rings/cock-ring-trios/
 * New site uses flat /sex-toys/{slug}/ where slug is the WooCommerce category slug.
 *
 * Usage:
 *   bun scripts/fix-sex-toys-links.ts --dry-run   (preview changes)
 *   bun scripts/fix-sex-toys-links.ts --apply      (apply changes)
 */

import { getConnection } from './lib/db';

// Mapping: old full URL -> new relative path
// Built by matching last slug against WooCommerce product_cat terms,
// with manual resolution for renamed/missing categories.
const URL_MAPPING: Record<string, string> = {
  'https://www.maleq.com/sex-toys/male-sex-toys/': '/sex-toys/sextoys-for-men/',
  'https://www.maleq.com/sex-toys/male-sex-toys/cock-rings/': '/sex-toys/cock-rings/',
  'https://www.maleq.com/sex-toys/male-sex-toys/cock-rings/adjustable-versatile-cock-rings/': '/sex-toys/adjustable-versatile-cock-rings/',
  'https://www.maleq.com/sex-toys/male-sex-toys/cock-rings/classic-cock-rings/': '/sex-toys/classic-cock-rings/',
  'https://www.maleq.com/sex-toys/male-sex-toys/cock-rings/cock-ring-trios/': '/sex-toys/cock-ring-trios/',
  'https://www.maleq.com/sex-toys/male-sex-toys/cock-rings/cock-rings-gentlemens/': '/sex-toys/gentlemen-cock-rings/',
  'https://www.maleq.com/sex-toys/male-sex-toys/cock-rings/metal-cock-rings/': '/sex-toys/cock-rings/',
  'https://www.maleq.com/sex-toys/male-sex-toys/sex-dolls/': '/sex-toys/sex-dolls/',
  'https://www.maleq.com/sex-toys/male-sex-toys/anal-toys/anal-douches-enemas-hygiene/': '/sex-toys/anal-douches-enemas-hygiene/',
  'https://www.maleq.com/sex-toys/male-sex-toys/anal-douches-enemas-hygiene/lube-shooters/': '/sex-toys/anal-douches-enemas-hygiene/',
  'https://www.maleq.com/sex-toys/personal-lubricants/': '/sex-toys/lubricants/',
  'https://www.maleq.com/sex-toys/personal-lubricants/anal-lubes/': '/sex-toys/anal-lubes-lotions-sprays-creams/',
  'https://www.maleq.com/sex-toys/personal-lubricants/condoms/': '/sex-toys/condoms/',
  'https://www.maleq.com/sex-toys/female-sex-toys/ben-wa-balls-kegel-exercisers-extras-female-sex-toys/': '/sex-toys/ben-wa-balls/',
};

interface Replacement {
  postId: number;
  postTitle: string;
  oldUrl: string;
  newUrl: string;
}

async function main() {
  const mode = process.argv[2];
  if (mode !== '--dry-run' && mode !== '--apply') {
    console.log('Usage: bun scripts/fix-sex-toys-links.ts --dry-run|--apply');
    process.exit(1);
  }

  const dryRun = mode === '--dry-run';
  const conn = await getConnection();

  try {
    // Find all affected posts
    const [rows] = await conn.query<any[]>(`
      SELECT ID, post_title, post_content
      FROM wp_posts
      WHERE post_status IN ('publish', 'draft')
        AND post_type IN ('post', 'page')
        AND post_content LIKE '%maleq.com/sex-toys/%'
      ORDER BY ID
    `);

    console.log(`Found ${rows.length} posts with /sex-toys/ links\n`);

    const replacements: Replacement[] = [];
    let updatedCount = 0;

    for (const row of rows) {
      let content = row.post_content as string;
      let changed = false;
      const postReplacements: Replacement[] = [];

      // Apply each mapping — longest URLs first to avoid prefix conflicts
      const sortedEntries = Object.entries(URL_MAPPING).sort((a, b) => b[0].length - a[0].length);
      for (const [oldUrl, newUrl] of sortedEntries) {
        if (content.includes(oldUrl)) {
          // Replace the full URL with relative path
          const count = content.split(oldUrl).length - 1;
          content = content.replaceAll(oldUrl, newUrl);
          changed = true;

          for (let i = 0; i < count; i++) {
            postReplacements.push({
              postId: row.ID,
              postTitle: row.post_title,
              oldUrl,
              newUrl,
            });
          }
        }
      }

      if (changed) {
        if (dryRun) {
          console.log(`Post ${row.ID}: ${row.post_title}`);
          for (const r of postReplacements) {
            console.log(`  ${r.oldUrl}`);
            console.log(`  → ${r.newUrl}`);
          }
          console.log();
        } else {
          await conn.query('UPDATE wp_posts SET post_content = ? WHERE ID = ?', [content, row.ID]);
          console.log(`Updated post ${row.ID}: ${row.post_title} (${postReplacements.length} replacements)`);
        }

        updatedCount++;
        replacements.push(...postReplacements);
      }
    }

    // Summary
    console.log('---');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLIED'}`);
    console.log(`Posts updated: ${updatedCount}`);
    console.log(`Total replacements: ${replacements.length}`);

    // Check for any remaining unmatched URLs
    const [remaining] = await conn.query<any[]>(`
      SELECT ID, post_title
      FROM wp_posts
      WHERE post_status IN ('publish', 'draft')
        AND post_type IN ('post', 'page')
        AND post_content LIKE '%maleq.com/sex-toys/%'
      ORDER BY ID
    `);

    if (remaining.length > 0 && !dryRun) {
      console.log(`\nWARNING: ${remaining.length} posts still have /sex-toys/ URLs:`);
      for (const r of remaining) {
        console.log(`  Post ${r.ID}: ${r.post_title}`);
      }
    }
  } finally {
    await conn.end();
  }
}

main().catch(console.error);
