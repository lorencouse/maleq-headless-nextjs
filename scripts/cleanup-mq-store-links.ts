#!/usr/bin/env bun

/**
 * Cleanup "View on MQ Store" Links Script
 *
 * Removes product images and "View on MQ Store" text above add_to_cart shortcodes.
 * Keeps only the shortcode in a clean format.
 *
 * Usage:
 *   bun scripts/cleanup-mq-store-links.ts --dry-run
 *   bun scripts/cleanup-mq-store-links.ts
 */

import { getConnection } from './lib/db';

interface CleanupOptions {
  dryRun: boolean;
}

function parseArgs(): CleanupOptions {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
  };
}

/**
 * Clean up the content by removing:
 * 1. Image blocks that link to products (directly before View on MQ Store paragraphs)
 * 2. "View on MQ Store" text and links (with variations)
 * 3. Extra whitespace
 *
 * Keep only the [add_to_cart] shortcode
 */
function cleanContent(content: string): { cleaned: string; changes: number } {
  let changes = 0;
  let cleaned = content;

  // Flexible pattern for "View on MQ Store" variations:
  // - "View on MQ Store"
  // - "View on: MQ Store"
  // - "View on&nbsp;MQ Store"
  // - With links around different parts
  const viewOnMQPattern = /View\s+on:?\s*(?:&nbsp;|\s)*(?:<[^>]*>)*\s*MQ\s*Store/gi;

  // Pattern 1: Image block followed by paragraph with "View on..." and add_to_cart
  const imageAndParagraphPattern = /<!-- wp:image[^>]*-->[\s\S]*?<figure[^>]*>[\s\S]*?<\/figure>\s*<!-- \/wp:image -->\s*\n*\s*<!-- wp:paragraph[^>]*-->\s*<p[^>]*>[\s\S]*?View\s+on[\s\S]*?MQ[\s\S]*?Store[\s\S]*?(\[add_to_cart[^\]]+\])[\s\S]*?<\/p>\s*<!-- \/wp:paragraph -->/gi;

  cleaned = cleaned.replace(imageAndParagraphPattern, (match, shortcode) => {
    changes++;
    return `<!-- wp:shortcode -->\n${shortcode}\n<!-- /wp:shortcode -->`;
  });

  // Pattern 2: Image block followed by paragraph with add_to_cart then "View on..."
  const imageAndParagraphPattern2 = /<!-- wp:image[^>]*-->[\s\S]*?<figure[^>]*>[\s\S]*?<\/figure>\s*<!-- \/wp:image -->\s*\n*\s*<!-- wp:paragraph[^>]*-->\s*<p[^>]*>[\s\S]*?(\[add_to_cart[^\]]+\])[\s\S]*?View\s+on[\s\S]*?MQ[\s\S]*?Store[\s\S]*?<\/p>\s*<!-- \/wp:paragraph -->/gi;

  cleaned = cleaned.replace(imageAndParagraphPattern2, (match, shortcode) => {
    changes++;
    return `<!-- wp:shortcode -->\n${shortcode}\n<!-- /wp:shortcode -->`;
  });

  // Pattern 3: Just paragraph with "View on..." and add_to_cart (no preceding image)
  const paragraphOnlyPattern = /<!-- wp:paragraph[^>]*-->\s*<p[^>]*>[\s\S]*?View\s+on[\s\S]*?MQ[\s\S]*?Store[\s\S]*?(\[add_to_cart[^\]]+\])[\s\S]*?<\/p>\s*<!-- \/wp:paragraph -->/gi;

  cleaned = cleaned.replace(paragraphOnlyPattern, (match, shortcode) => {
    changes++;
    return `<!-- wp:shortcode -->\n${shortcode}\n<!-- /wp:shortcode -->`;
  });

  // Pattern 4: Paragraph with add_to_cart then "View on..."
  const shortcodeFirstPattern = /<!-- wp:paragraph[^>]*-->\s*<p[^>]*>[\s\S]*?(\[add_to_cart[^\]]+\])[\s\S]*?View\s+on[\s\S]*?MQ[\s\S]*?Store[\s\S]*?<\/p>\s*<!-- \/wp:paragraph -->/gi;

  cleaned = cleaned.replace(shortcodeFirstPattern, (match, shortcode) => {
    changes++;
    return `<!-- wp:shortcode -->\n${shortcode}\n<!-- /wp:shortcode -->`;
  });

  // Clean up multiple consecutive newlines (more than 2)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return { cleaned, changes };
}

async function main() {
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  Cleanup "View on MQ Store" Links Script   ║');
  console.log('╚════════════════════════════════════════════╝\n');

  if (options.dryRun) {
    console.log('Mode: DRY RUN (no changes will be made)\n');
  }

  const connection = await getConnection();

  console.log('✓ Connected to MySQL\n');

  // Find all posts and reusable blocks with "View on" + "MQ" patterns
  const [rows] = await connection.execute(`
    SELECT ID, post_type, post_title, post_content
    FROM wp_posts
    WHERE post_type IN ('post', 'wp_block', 'page')
    AND post_status IN ('publish', 'draft', 'pending', 'private')
    AND post_content LIKE '%View on%MQ%Store%'
    ORDER BY post_type, ID
  `);

  const posts = rows as Array<{
    ID: number;
    post_type: string;
    post_title: string;
    post_content: string;
  }>;

  console.log(`Found ${posts.length} posts/blocks with "View on MQ Store"\n`);

  let totalChanges = 0;
  let postsUpdated = 0;
  const updatedList: Array<{ id: number; type: string; title: string; changes: number }> = [];

  for (const post of posts) {
    const { cleaned, changes } = cleanContent(post.post_content);

    if (changes > 0) {
      totalChanges += changes;
      postsUpdated++;

      updatedList.push({
        id: post.ID,
        type: post.post_type,
        title: post.post_title.substring(0, 50),
        changes,
      });

      if (options.dryRun) {
        console.log(`[DRY RUN] Would update: ${post.post_type} #${post.ID} - "${post.post_title.substring(0, 40)}..." (${changes} changes)`);
      } else {
        await connection.execute(
          `UPDATE wp_posts SET post_content = ? WHERE ID = ?`,
          [cleaned, post.ID]
        );
        console.log(`✓ Updated: ${post.post_type} #${post.ID} - "${post.post_title.substring(0, 40)}..." (${changes} changes)`);
      }
    }
  }

  await connection.end();

  console.log('\n=== SUMMARY ===');
  console.log(`Posts/blocks scanned: ${posts.length}`);
  console.log(`Posts/blocks ${options.dryRun ? 'to update' : 'updated'}: ${postsUpdated}`);
  console.log(`Total changes: ${totalChanges}`);

  if (options.dryRun && postsUpdated > 0) {
    console.log('\nRun without --dry-run to apply changes.');
  }
}

main().catch(console.error);
