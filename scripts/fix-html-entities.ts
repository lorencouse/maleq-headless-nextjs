/**
 * Fix HTML entity artifacts in product titles and taxonomy term names.
 *
 * Decodes entities like &amp; → &, &#039; → ', &quot; → ", etc.
 *
 * Usage:
 *   bun scripts/fix-html-entities.ts              # dry-run (local DB)
 *   bun scripts/fix-html-entities.ts --apply      # apply changes (local DB)
 *   bun scripts/fix-html-entities.ts --remote     # dry-run (production)
 *   bun scripts/fix-html-entities.ts --remote --apply
 */
import { getConnection } from './lib/db';
import type { RowDataPacket } from 'mysql2';

const dryRun = !process.argv.includes('--apply');

/** Decode common HTML entities */
function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#0*38;/g, '&')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

const ENTITY_PATTERN = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i;

async function main() {
  const db = await getConnection();

  console.log(dryRun ? '🔍 DRY RUN (pass --apply to commit changes)\n' : '🔧 APPLYING changes\n');

  // 1. Fix product titles (wp_posts)
  const [posts] = await db.query<RowDataPacket[]>(
    `SELECT ID, post_title FROM wp_posts
     WHERE post_type = 'product' AND post_status = 'publish'
       AND post_title REGEXP '&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);'`
  );

  console.log(`📦 Product titles with entities: ${posts.length}`);
  let titleCount = 0;
  for (const row of posts) {
    const decoded = decodeEntities(row.post_title);
    if (decoded !== row.post_title) {
      titleCount++;
      console.log(`  [${row.ID}] "${row.post_title}" → "${decoded}"`);
      if (!dryRun) {
        await db.execute('UPDATE wp_posts SET post_title = ? WHERE ID = ?', [decoded, row.ID]);
      }
    }
  }

  // 2. Fix taxonomy term names (wp_terms)
  const [terms] = await db.query<RowDataPacket[]>(
    `SELECT term_id, name FROM wp_terms
     WHERE name REGEXP '&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);'`
  );

  console.log(`\n🏷️  Taxonomy terms with entities: ${terms.length}`);
  let termCount = 0;
  for (const row of terms) {
    const decoded = decodeEntities(row.name);
    if (decoded !== row.name) {
      termCount++;
      console.log(`  [${row.term_id}] "${row.name}" → "${decoded}"`);
      if (!dryRun) {
        await db.execute('UPDATE wp_terms SET name = ? WHERE term_id = ?', [decoded, row.term_id]);
      }
    }
  }

  // 3. Fix product post_content and post_excerpt
  const [content] = await db.query<RowDataPacket[]>(
    `SELECT ID, post_title, post_content, post_excerpt FROM wp_posts
     WHERE post_type = 'product' AND post_status = 'publish'
       AND (post_content REGEXP '&amp;' OR post_excerpt REGEXP '&amp;')`
  );

  console.log(`\n📝 Product descriptions with &amp;: ${content.length}`);
  let descCount = 0;
  for (const row of content) {
    const newContent = row.post_content ? row.post_content.replace(/&amp;/gi, '&') : row.post_content;
    const newExcerpt = row.post_excerpt ? row.post_excerpt.replace(/&amp;/gi, '&') : row.post_excerpt;
    const contentChanged = newContent !== row.post_content;
    const excerptChanged = newExcerpt !== row.post_excerpt;
    if (contentChanged || excerptChanged) {
      descCount++;
      if (descCount <= 10) {
        console.log(`  [${row.ID}] "${row.post_title}" - ${contentChanged ? 'content' : ''}${contentChanged && excerptChanged ? ' + ' : ''}${excerptChanged ? 'excerpt' : ''}`);
      }
      if (!dryRun) {
        await db.execute('UPDATE wp_posts SET post_content = ?, post_excerpt = ? WHERE ID = ?', [newContent, newExcerpt, row.ID]);
      }
    }
  }
  if (descCount > 10) console.log(`  ... and ${descCount - 10} more`);

  console.log(`\n✅ Summary:`);
  console.log(`   Titles fixed: ${titleCount}`);
  console.log(`   Terms fixed: ${termCount}`);
  console.log(`   Descriptions fixed: ${descCount}`);
  if (dryRun) console.log(`\n   Run with --apply to commit changes.`);

  await db.end();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
