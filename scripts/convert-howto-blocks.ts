/**
 * Convert plugin-specific HowTo blocks to standard Gutenberg blocks.
 *
 * Supported source formats:
 *
 * 1. Rank Math:
 *   <div class="wp-block-rank-math-howto-block">
 *     <div class="rank-math-howto-step">
 *       <div|h3|p class="rank-math-howto-title">...</div|h3|p>
 *       <div class="rank-math-howto-content">...</div>
 *     </div>
 *   </div>
 *
 * 2. Yoast:
 *   <div class="schema-how-to wp-block-yoast-how-to-block">
 *     <p class="schema-how-to-total-time">Time needed: 30 minutes.</p>
 *     <p class="schema-how-to-description">...</p>
 *     <ol class="schema-how-to-steps">
 *       <li class="schema-how-to-step">
 *         <strong class="schema-how-to-step-name">Title</strong>
 *         <p class="schema-how-to-step-text">Content</p>
 *       </li>
 *     </ol>
 *   </div>
 *
 * Output (standard Gutenberg):
 *   <!-- wp:group {"className":"howto-steps"} -->
 *   <div class="wp-block-group howto-steps">
 *     <!-- wp:group {"className":"howto-step"} -->
 *     <div class="wp-block-group howto-step">
 *       <!-- wp:heading {"level":3,"className":"howto-step-title"} -->
 *       <h3 class="wp-block-heading howto-step-title">...</h3>
 *       <!-- /wp:heading -->
 *       <!-- wp:html -->
 *       <div class="howto-step-content">...</div>
 *       <!-- /wp:html -->
 *     </div>
 *     <!-- /wp:group -->
 *   </div>
 *   <!-- /wp:group -->
 *
 * Usage:
 *   bun run scripts/convert-howto-blocks.ts --local --dry-run
 *   bun run scripts/convert-howto-blocks.ts --local --apply
 *   bun run scripts/convert-howto-blocks.ts --dry-run          # remote (needs SSH tunnel)
 */
import { getConnection } from './lib/db';

const isDryRun = !process.argv.includes('--apply');

interface PostRow {
  ID: number;
  post_title: string;
  post_content: string;
}

interface HowToStep {
  title: string;
  content: string;
}

interface HowToBlock {
  steps: HowToStep[];
  description?: string;
  timeNeeded?: string;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Find a matching closing tag by counting open/close depth.
 * Returns the index AFTER the closing tag, or -1 if not found.
 */
function findClosingTag(html: string, tag: string, startAfterOpen: number): number {
  let depth = 1;
  let pos = startAfterOpen;
  const openPattern = `<${tag}`;
  const closePattern = `</${tag}>`;

  while (depth > 0 && pos < html.length) {
    const nextOpen = html.indexOf(openPattern, pos);
    const nextClose = html.indexOf(closePattern, pos);

    if (nextClose === -1) return -1;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + openPattern.length;
    } else {
      depth--;
      if (depth === 0) return nextClose + closePattern.length;
      pos = nextClose + closePattern.length;
    }
  }
  return -1;
}

/**
 * Extract inner HTML from a tag, handling nested tags of the same type.
 */
function extractInnerHtml(html: string, tag: string, openTagEnd: number, blockEnd: number): string {
  const closeTag = `</${tag}>`;
  // Content starts right after the opening tag's >
  const innerStart = openTagEnd;
  // Content ends at the closing tag
  const innerEnd = blockEnd - closeTag.length;
  return html.substring(innerStart, innerEnd).trim();
}

/**
 * Parse Rank Math HowTo block.
 */
function parseRankMathBlock(blockHtml: string): HowToBlock {
  const steps: HowToStep[] = [];

  const stepBlocks = blockHtml.split(/<div\s+class="rank-math-howto-step">/);

  for (let i = 1; i < stepBlocks.length; i++) {
    const block = stepBlocks[i];

    // Extract title - may be <div>, <h3>, <p>, or <strong>
    const titleMatch = block.match(/<(?:div|h[2-6]|p|strong)\s+class="rank-math-howto-title">([\s\S]*?)<\/(?:div|h[2-6]|p|strong)>/);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Extract content using depth-counting for nested divs
    const contentStart = block.indexOf('<div class="rank-math-howto-content">');
    if (contentStart !== -1) {
      const openTagEnd = contentStart + '<div class="rank-math-howto-content">'.length;
      const blockEnd = findClosingTag(block, 'div', openTagEnd);
      if (blockEnd !== -1) {
        const content = extractInnerHtml(block, 'div', openTagEnd, blockEnd);
        if (title) steps.push({ title, content });
      }
    } else if (title) {
      steps.push({ title, content: '' });
    }
  }

  return { steps };
}

/**
 * Parse Yoast HowTo block.
 */
function parseYoastBlock(blockHtml: string): HowToBlock {
  const steps: HowToStep[] = [];

  // Extract description
  const descMatch = blockHtml.match(/<p\s+class="schema-how-to-description">([\s\S]*?)<\/p>/);
  const description = descMatch ? descMatch[1].trim() : undefined;

  // Extract time needed
  const timeMatch = blockHtml.match(/<p\s+class="schema-how-to-total-time">([\s\S]*?)<\/p>/);
  const timeNeeded = timeMatch ? timeMatch[1].replace(/<[^>]*>/g, '').trim() : undefined;

  // Extract steps from <li class="schema-how-to-step">
  const stepBlocks = blockHtml.split(/<li\s+class="schema-how-to-step"[^>]*>/);

  for (let i = 1; i < stepBlocks.length; i++) {
    const block = stepBlocks[i];

    // Title is in <strong class="schema-how-to-step-name">
    const titleMatch = block.match(/<strong\s+class="schema-how-to-step-name">([\s\S]*?)<\/strong>/);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Content is in <p class="schema-how-to-step-text">
    const contentMatch = block.match(/<p\s+class="schema-how-to-step-text">([\s\S]*?)<\/p>/);
    const content = contentMatch ? contentMatch[1].trim() : '';

    if (title) steps.push({ title, content });
  }

  return { steps, description, timeNeeded };
}

// ─── Conversion ──────────────────────────────────────────────────────────────

/**
 * Clean up step title: strip wrapping <strong> tags.
 */
function cleanTitle(html: string): string {
  return html
    .replace(/^<strong>\s*/i, '')
    .replace(/\s*<\/strong>$/i, '')
    .trim();
}

/**
 * Clean up step content HTML.
 */
function cleanContent(html: string): string {
  return html
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Convert parsed HowTo data to Gutenberg block markup.
 */
function howToToGutenberg(data: HowToBlock): string {
  const parts: string[] = [];

  // Preserve description as a paragraph if present
  if (data.description) {
    parts.push(
      `<!-- wp:paragraph {"className":"howto-description"} -->`,
      `<p class="howto-description">${data.description}</p>`,
      `<!-- /wp:paragraph -->`,
      ''
    );
  }

  // Preserve time needed as a paragraph if present
  if (data.timeNeeded) {
    parts.push(
      `<!-- wp:paragraph {"className":"howto-time"} -->`,
      `<p class="howto-time">${data.timeNeeded}</p>`,
      `<!-- /wp:paragraph -->`,
      ''
    );
  }

  const stepBlocks = data.steps.map((step) => {
    const cleanedTitle = cleanTitle(step.title);
    const cleanedContent = cleanContent(step.content);

    const contentBlock = cleanedContent
      ? `<!-- wp:html -->\n<div class="howto-step-content">${cleanedContent}</div>\n<!-- /wp:html -->`
      : '';

    return [
      `<!-- wp:group {"className":"howto-step"} -->`,
      `<div class="wp-block-group howto-step">`,
      `<!-- wp:heading {"level":3,"className":"howto-step-title"} -->`,
      `<h3 class="wp-block-heading howto-step-title">${cleanedTitle}</h3>`,
      `<!-- /wp:heading -->`,
      contentBlock,
      `</div>`,
      `<!-- /wp:group -->`,
    ].filter(Boolean).join('\n');
  });

  parts.push(
    `<!-- wp:group {"className":"howto-steps"} -->`,
    `<div class="wp-block-group howto-steps">`,
    stepBlocks.join('\n\n'),
    `</div>`,
    `<!-- /wp:group -->`
  );

  return parts.join('\n');
}

// ─── Block detection & replacement ───────────────────────────────────────────

interface BlockMatch {
  start: number;
  end: number;
  type: 'rank-math' | 'yoast';
  html: string;
}

/**
 * Find all HowTo blocks (Rank Math or Yoast) in post content.
 */
function findHowToBlocks(content: string): BlockMatch[] {
  const blocks: BlockMatch[] = [];

  // Find Rank Math blocks: <div class="wp-block-rank-math-howto-block">
  const rmPattern = /<div\s+class="wp-block-rank-math-howto-block">/g;
  let match: RegExpExecArray | null;

  while ((match = rmPattern.exec(content)) !== null) {
    const openEnd = match.index + match[0].length;
    const blockEnd = findClosingTag(content, 'div', openEnd);
    if (blockEnd !== -1) {
      blocks.push({
        start: match.index,
        end: blockEnd,
        type: 'rank-math',
        html: content.substring(match.index, blockEnd),
      });
    }
  }

  // Find Yoast blocks: <div class="schema-how-to wp-block-yoast-how-to-block">
  const yoastPattern = /<div\s+class="schema-how-to wp-block-yoast-how-to-block">/g;

  while ((match = yoastPattern.exec(content)) !== null) {
    const openEnd = match.index + match[0].length;
    const blockEnd = findClosingTag(content, 'div', openEnd);
    if (blockEnd !== -1) {
      blocks.push({
        start: match.index,
        end: blockEnd,
        type: 'yoast',
        html: content.substring(match.index, blockEnd),
      });
    }
  }

  // Sort by position
  blocks.sort((a, b) => a.start - b.start);
  return blocks;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const db = await getConnection();

  try {
    const [rows] = await db.query<PostRow[]>(
      `SELECT ID, post_title, post_content
       FROM wp_posts
       WHERE (post_content LIKE '%rank-math-howto%'
              OR post_content LIKE '%wp-block-yoast-how-to%')
         AND post_status IN ('publish', 'draft')
       ORDER BY ID`
    );

    const posts = rows as PostRow[];
    console.log(`Found ${posts.length} posts with HowTo blocks\n`);

    if (posts.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    let converted = 0;

    for (const post of posts) {
      const blocks = findHowToBlocks(post.post_content);

      if (blocks.length === 0) {
        console.log(`--- Post ${post.ID}: "${post.post_title}" [NO BLOCKS FOUND] ---\n`);
        continue;
      }

      const types = [...new Set(blocks.map(b => b.type))].join(', ');
      console.log(`--- Post ${post.ID}: "${post.post_title}" [${types}] ---`);

      let newContent = post.post_content;
      const replacements: Array<{ start: number; end: number; replacement: string }> = [];

      for (const block of blocks) {
        const data = block.type === 'rank-math'
          ? parseRankMathBlock(block.html)
          : parseYoastBlock(block.html);

        if (data.steps.length > 0) {
          const gutenberg = howToToGutenberg(data);
          replacements.push({
            start: block.start,
            end: block.end,
            replacement: gutenberg,
          });

          console.log(`  ${block.type}: ${data.steps.length} steps`);
          if (data.description) console.log(`    Description: "${data.description}"`);
          if (data.timeNeeded) console.log(`    Time: "${data.timeNeeded}"`);
          data.steps.forEach((s, i) => console.log(`    ${i + 1}. ${cleanTitle(s.title)}`));
        } else {
          console.log(`  ${block.type}: parsing failed (0 steps)`);
        }
      }

      if (replacements.length === 0) {
        console.log('  No valid blocks parsed.\n');
        continue;
      }

      // Apply replacements in reverse order to preserve positions
      for (let i = replacements.length - 1; i >= 0; i--) {
        const r = replacements[i];
        newContent = newContent.substring(0, r.start) + r.replacement + newContent.substring(r.end);
      }

      // Remove plugin-specific Gutenberg block comments
      newContent = newContent.replace(/<!-- \/?wp:rank-math\/howto-block[^>]*-->\n?/g, '');
      newContent = newContent.replace(/<!-- \/?wp:yoast-seo\/how-to-block[^>]*-->\n?/g, '');
      newContent = newContent.replace(/<!-- \/?wp:yoast\/how-to-block[^>]*-->\n?/g, '');

      if (isDryRun) {
        console.log('\n  [DRY RUN] Would update post content.');
        const previewStart = newContent.indexOf('howto-steps');
        if (previewStart !== -1) {
          console.log('  Preview:');
          console.log(newContent.substring(Math.max(0, previewStart - 50), previewStart + 400));
        }
      } else {
        await db.query('UPDATE wp_posts SET post_content = ? WHERE ID = ?', [newContent, post.ID]);
        console.log('  Updated!');
      }

      converted++;
      console.log('');
    }

    console.log(`\n${isDryRun ? '[DRY RUN] ' : ''}${converted} posts ${isDryRun ? 'would be' : 'were'} converted.`);
    if (isDryRun) {
      console.log('Run with --apply to write changes.');
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
