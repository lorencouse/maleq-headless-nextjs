#!/usr/bin/env bun
/**
 * Fix old maleq.com site-page, product, cart/checkout, and taxonomy URLs.
 *
 * Usage:
 *   bun scripts/fix-site-page-links.ts --dry-run   (preview changes)
 *   bun scripts/fix-site-page-links.ts --apply      (apply changes)
 */

import { getConnection } from './lib/db';

const URL_MAPPING: Record<string, string> = {
  // === Site pages ===
  'https://www.maleq.com/contact-us/': '/contact/',
  'https://www.maleq.com/contact-us': '/contact/',
  'https://maleq.com/contact-us': '/contact/',
  'https://www.maleq.com/male-q/sex/': '/guides/',
  'https://www.maleq.com/male-q/': '/shop/',

  // === Cart & Checkout ===
  'https://www.maleq.com/checkout/': '/checkout/',
  'https://www.maleq.com/cart/': '/cart/',

  // === Old store taxonomy link ===
  'http://store.maleq.com/category/36/Anal-Toys': '/sex-toys/anal-toys/',

  // === Old product pages -> closest current product ===
  'https://www.maleq.com/product/pros-enema-black/': '/sex-toys/anal-douches-enemas-hygiene/',
  'https://www.maleq.com/product/bulk-colt-anal-trainer-kit/': '/product/colt-anal-trainer-kit/',
};

interface Replacement {
  postId: number;
  postTitle: string;
  postType: string;
  oldUrl: string;
  newUrl: string;
}

async function main() {
  const mode = process.argv[2];
  if (mode !== '--dry-run' && mode !== '--apply') {
    console.log('Usage: bun scripts/fix-site-page-links.ts --dry-run|--apply');
    process.exit(1);
  }

  const dryRun = mode === '--dry-run';
  const conn = await getConnection();

  try {
    // Build search: find posts with any of the old URLs
    const searchPatterns = [
      "post_content LIKE '%maleq.com/contact-us%'",
      "post_content LIKE '%maleq.com/male-q/%'",
      "post_content LIKE '%maleq.com/checkout/%'",
      "post_content LIKE '%maleq.com/cart/%'",
      "post_content LIKE '%store.maleq.com/category/%'",
      "post_content LIKE '%maleq.com/product/pros-enema%'",
      "post_content LIKE '%maleq.com/product/bulk-colt%'",
    ];

    const [rows] = await conn.query<any[]>(`
      SELECT ID, post_title, post_type, post_content
      FROM wp_posts
      WHERE post_status IN ('publish', 'draft')
        AND post_type IN ('post', 'page', 'wp_block')
        AND (${searchPatterns.join(' OR ')})
      ORDER BY ID
    `);

    console.log(`Found ${rows.length} posts with site-page/product/cart URLs\n`);

    const replacements: Replacement[] = [];
    let updatedCount = 0;

    // Sort mappings longest-first
    const sortedEntries = Object.entries(URL_MAPPING).sort((a, b) => b[0].length - a[0].length);

    for (const row of rows) {
      let content = row.post_content as string;
      let changed = false;
      const postReplacements: Replacement[] = [];

      for (const [oldUrl, newUrl] of sortedEntries) {
        if (content.includes(oldUrl)) {
          const count = content.split(oldUrl).length - 1;
          content = content.replaceAll(oldUrl, newUrl);
          changed = true;

          for (let i = 0; i < count; i++) {
            postReplacements.push({
              postId: row.ID,
              postTitle: row.post_title,
              postType: row.post_type,
              oldUrl,
              newUrl,
            });
          }
        }
      }

      if (changed) {
        if (dryRun) {
          console.log(`[${row.post_type}] Post ${row.ID}: ${row.post_title}`);
          for (const r of postReplacements) {
            console.log(`  ${r.oldUrl}`);
            console.log(`  → ${r.newUrl}`);
          }
          console.log();
        } else {
          await conn.query('UPDATE wp_posts SET post_content = ? WHERE ID = ?', [content, row.ID]);
          console.log(`Updated [${row.post_type}] ${row.ID}: ${row.post_title} (${postReplacements.length} links)`);
        }

        updatedCount++;
        replacements.push(...postReplacements);
      }
    }

    console.log('---');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLIED'}`);
    console.log(`Posts/blocks updated: ${updatedCount}`);
    console.log(`Total link replacements: ${replacements.length}`);
  } finally {
    await conn.end();
  }
}

main().catch(console.error);
