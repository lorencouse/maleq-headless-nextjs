#!/usr/bin/env bun

/**
 * Cleanup Image + Text Above Shortcodes
 *
 * Removes product images and short text (e.g. "View on: MQ Store")
 * that appear directly above [add_to_cart] shortcodes in reusable blocks
 * and blog posts.
 *
 * Only deletes the image + text. Does NOT delete anything above the image.
 * Skips patterns where the paragraph text is too long (real content, not just a link).
 *
 * Usage:
 *   bun scripts/cleanup-image-text-above-shortcodes.ts --analyze
 *   bun scripts/cleanup-image-text-above-shortcodes.ts --dry-run
 *   bun scripts/cleanup-image-text-above-shortcodes.ts --apply
 */

import { getConnection } from './lib/db';
import * as path from 'path';
import * as fs from 'fs';

// Max character length for the text portion (excluding shortcode).
// Anything longer is real content, not just a "View on MQ Store" link.
const MAX_TEXT_LENGTH = 80;

interface MatchInfo {
  postId: number;
  postType: string;
  postTitle: string;
  shortcode: string;
  imageSrc: string;
  textContent: string;
}

interface ChangeRecord {
  postId: number;
  postType: string;
  postTitle: string;
  shortcode: string;
  imageSrc: string;
  textRemoved: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    analyze: args.includes('--analyze'),
    dryRun: args.includes('--dry-run'),
    apply: args.includes('--apply'),
  };
}

/**
 * Extract text content from the paragraph (excluding the shortcode)
 */
function extractTextFromParagraph(paragraphHtml: string, shortcode: string): string {
  let text = paragraphHtml.replace(shortcode, '');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/<!-- [^>]+ -->/g, '');
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * Check if text is short enough to be a "View on MQ Store" type link
 * (not a real content paragraph)
 */
function isShortLinkText(text: string): boolean {
  return text.length > 0 && text.length <= MAX_TEXT_LENGTH;
}

/**
 * Get image source URL from an image block
 */
function getImageSrc(imageBlock: string): string {
  const srcMatch = imageBlock.match(/src="([^"]+)"/);
  return srcMatch ? srcMatch[1] : 'unknown';
}

// Regex: image block immediately followed by a SINGLE paragraph block containing [add_to_cart].
// Uses <p>...</p> boundaries to prevent matching across multiple paragraph blocks.
const PATTERN = /(<!-- wp:image[^>]*-->[\s\S]*?<!-- \/wp:image -->)\s*\n*\s*(<!-- wp:paragraph[^>]*-->\s*<p[^>]*>([\s\S]*?)<\/p>\s*<!-- \/wp:paragraph -->)/g;

/**
 * Extract [add_to_cart ...] shortcode from paragraph inner HTML
 */
function extractShortcode(pInnerHtml: string): string | null {
  const m = pInnerHtml.match(/\[add_to_cart[^\]]+\]/);
  return m ? m[0] : null;
}

/**
 * Find all image+text+shortcode patterns in content
 */
function findPatterns(content: string, postId: number, postType: string, postTitle: string): MatchInfo[] {
  const matches: MatchInfo[] = [];
  const regex = new RegExp(PATTERN.source, PATTERN.flags);

  let match;
  while ((match = regex.exec(content)) !== null) {
    const imageBlock = match[1];
    const paragraphBlock = match[2];
    const pInnerHtml = match[3]; // content between <p> and </p>

    const shortcode = extractShortcode(pInnerHtml);
    if (!shortcode) continue;

    const textContent = extractTextFromParagraph(paragraphBlock, shortcode);

    if (!isShortLinkText(textContent)) continue;

    matches.push({
      postId,
      postType,
      postTitle,
      shortcode,
      imageSrc: getImageSrc(imageBlock),
      textContent,
    });
  }

  return matches;
}

/**
 * Apply cleanup to content - remove image blocks and short text above shortcodes.
 */
function cleanContent(content: string): { cleaned: string; count: number } {
  let count = 0;
  const regex = new RegExp(PATTERN.source, PATTERN.flags);

  const cleaned = content.replace(regex, (fullMatch, imageBlock, paragraphBlock, pInnerHtml) => {
    const shortcode = extractShortcode(pInnerHtml);
    if (!shortcode) return fullMatch;

    const textContent = extractTextFromParagraph(paragraphBlock, shortcode);

    if (!isShortLinkText(textContent)) return fullMatch;

    count++;
    return `<!-- wp:shortcode -->\n${shortcode}\n<!-- /wp:shortcode -->`;
  });

  return { cleaned: cleaned.replace(/\n{3,}/g, '\n\n'), count };
}

async function main() {
  const options = parseArgs();

  if (!options.analyze && !options.dryRun && !options.apply) {
    console.log('Usage:');
    console.log('  bun scripts/cleanup-image-text-above-shortcodes.ts --analyze   # Show what would be cleaned');
    console.log('  bun scripts/cleanup-image-text-above-shortcodes.ts --dry-run   # Preview changes');
    console.log('  bun scripts/cleanup-image-text-above-shortcodes.ts --apply     # Apply changes');
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  Cleanup Image + Text Above Shortcodes               ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const connection = await getConnection();
  console.log('Connected to MySQL\n');

  const [rows] = await connection.execute(`
    SELECT ID, post_type, post_title, post_content
    FROM wp_posts
    WHERE post_type IN ('post', 'wp_block', 'page')
    AND post_status IN ('publish', 'draft', 'pending', 'private')
    AND post_content LIKE '%add_to_cart%'
    AND post_content LIKE '%wp:image%'
    ORDER BY post_type, ID
  `);

  const posts = rows as Array<{
    ID: number;
    post_type: string;
    post_title: string;
    post_content: string;
  }>;

  console.log(`Found ${posts.length} posts/blocks with images + shortcodes\n`);

  let allMatches: MatchInfo[] = [];
  for (const post of posts) {
    allMatches.push(...findPatterns(post.post_content, post.ID, post.post_type, post.post_title));
  }

  console.log(`Found ${allMatches.length} image+short-text+shortcode patterns to clean\n`);

  if (options.analyze) {
    for (const m of allMatches) {
      const filename = m.imageSrc.substring(m.imageSrc.lastIndexOf('/') + 1);
      console.log(`  ${m.postType} #${m.postId} "${m.postTitle.substring(0, 45)}"`);
      console.log(`    Text:  "${m.textContent}" (${m.textContent.length} chars)`);
      console.log(`    Image: ${filename}`);
      console.log(`    Short: ${m.shortcode}`);
      console.log();
    }
    await connection.end();
    return;
  }

  if (allMatches.length === 0) {
    console.log('No patterns found to clean up.');
    await connection.end();
    return;
  }

  // Group by post for batch processing
  const matchesByPost = new Map<number, { post: typeof posts[0]; matches: MatchInfo[] }>();
  for (const m of allMatches) {
    const post = posts.find(p => p.ID === m.postId)!;
    if (!matchesByPost.has(m.postId)) {
      matchesByPost.set(m.postId, { post, matches: [] });
    }
    matchesByPost.get(m.postId)!.matches.push(m);
  }

  const changes: ChangeRecord[] = [];
  let postsUpdated = 0;

  for (const [postId, { post, matches }] of matchesByPost) {
    const { cleaned, count } = cleanContent(post.post_content);

    if (cleaned !== post.post_content && count > 0) {
      postsUpdated++;

      for (const m of matches) {
        changes.push({
          postId: m.postId,
          postType: m.postType,
          postTitle: m.postTitle,
          shortcode: m.shortcode,
          imageSrc: m.imageSrc.substring(m.imageSrc.lastIndexOf('/') + 1),
          textRemoved: m.textContent,
        });
      }

      if (options.dryRun) {
        console.log(`[DRY RUN] Would update: ${post.post_type} #${postId} "${post.post_title.substring(0, 50)}" (${count} patterns)`);
        for (const m of matches) {
          console.log(`  - Remove: "${m.textContent}" + image`);
          console.log(`  - Keep:   ${m.shortcode}`);
        }
      } else {
        await connection.execute(
          'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
          [cleaned, postId]
        );
        console.log(`Updated: ${post.post_type} #${postId} "${post.post_title.substring(0, 50)}" (${count} patterns)`);
        for (const m of matches) {
          console.log(`  - Removed: "${m.textContent}" + image`);
        }
      }
    }
  }

  await connection.end();

  console.log('\n=== SUMMARY ===');
  console.log(`Posts/blocks scanned:  ${posts.length}`);
  console.log(`Patterns found:        ${allMatches.length}`);
  console.log(`Posts ${options.dryRun ? 'to update' : 'updated'}: ${postsUpdated}`);

  if (options.dryRun) {
    console.log('\nRun with --apply to make changes.');
  }

  if (options.apply && changes.length > 0) {
    const changelog = {
      timestamp: new Date().toISOString(),
      totalPatternsRemoved: changes.length,
      totalPostsModified: postsUpdated,
      changes,
    };
    const outPath = path.join(process.cwd(), 'data', 'image-text-cleanup-changelog-v2.json');
    fs.writeFileSync(outPath, JSON.stringify(changelog, null, 2));
    console.log(`\nChangelog saved to: ${outPath}`);
  }
}

main().catch(console.error);
