/**
 * Move Embedded Images After Headings
 *
 * Restructures product descriptions so that <img> tags appear
 * immediately after their section heading, rather than after
 * the section content.
 *
 * Before: <h2>Heading</h2><p>content...</p><img .../>
 * After:  <h2>Heading</h2><img .../><p>content...</p>
 *
 * Usage:
 *   bun run scripts/move-images-after-headings.ts --local --dry-run
 *   bun run scripts/move-images-after-headings.ts --local
 *   bun run scripts/move-images-after-headings.ts              # remote (needs SSH tunnel)
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

/**
 * For each section (split at h2/h3 boundaries), find any <img> tags
 * that appear AFTER non-img content, and move them to right after the heading.
 */
function moveImagesAfterHeadings(html: string): string {
  // Split at heading boundaries, keeping the delimiter
  const sections = html.split(/(?=<h[23][^>]*>)/i);

  if (sections.length <= 1) return html;

  const result: string[] = [];

  for (const section of sections) {
    // Match: heading tag, then everything else
    const headingMatch = section.match(/^(<h[23][^>]*>.*?<\/h[23]>)([\s\S]*)$/i);

    if (!headingMatch) {
      // No heading in this section (e.g. intro content before first heading)
      result.push(section);
      continue;
    }

    const heading = headingMatch[1];
    let body = headingMatch[2];

    // Extract all <img .../> tags from the body
    const imgTags: string[] = [];
    body = body.replace(/\s*<img\s[^>]*\/?\s*>\s*/gi, (match) => {
      imgTags.push(match.trim());
      return '\n';
    });

    if (imgTags.length === 0) {
      // No images to move
      result.push(section);
      continue;
    }

    // Clean up extra blank lines left by removed images
    body = body.replace(/\n{3,}/g, '\n\n');

    // Reassemble: heading → images → body content
    result.push(heading + '\n' + imgTags.join('\n') + '\n' + body.trimStart());
  }

  return result.join('');
}

async function main() {
  const db = await getConnection();

  console.log(isDryRun ? '🔍 DRY RUN — no changes will be saved\n' : '✏️  LIVE RUN — changes will be saved to DB\n');

  const limitClause = limit > 0 ? `LIMIT ${limit}` : '';
  const [rows] = await db.execute(
    `SELECT ID, post_title, post_content FROM wp_posts
     WHERE post_type = 'product' AND post_status = 'publish'
     AND post_content LIKE '%<img%'
     AND post_content LIKE '%<h2%'
     ${limitClause}`
  ) as any[];

  console.log(`Found ${rows.length} products with embedded images and headings\n`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const newContent = moveImagesAfterHeadings(row.post_content);

    if (newContent === row.post_content) {
      skipped++;
      continue;
    }

    updated++;

    if (isDryRun) {
      if (updated <= 5) {
        console.log(`--- ${row.post_title} (ID: ${row.ID}) ---`);
        // Show first 500 chars of new content
        console.log(newContent.substring(0, 500));
        console.log('...\n');
      }
    } else {
      await db.execute('UPDATE wp_posts SET post_content = ? WHERE ID = ?', [newContent, row.ID]);
    }
  }

  console.log(`\n✅ Done: ${updated} updated, ${skipped} already correct (images already after headings or no change needed)`);

  await db.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
