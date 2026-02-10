/**
 * Cleanup Titles Script
 * Removes junk () patterns from product titles, variation names, and descriptions
 * while preserving legitimate size, color, and product descriptor patterns.
 *
 * Usage:
 *   bun run scripts/cleanup-titles.ts --dry-run     # Preview changes without applying
 *   bun run scripts/cleanup-titles.ts --apply       # Apply changes to database
 */

// ==================== JUNK PATTERNS TO REMOVE ====================

// These patterns are distributor/inventory codes and should be removed
const JUNK_PATTERNS_EXACT = [
  // Distributor codes
  '(d)',
  '(wd)',
  '(cd)',
  '(bu)',
  '(net)',

  // Inventory/order markers
  '(bulk)',
  '(bulk only)',
  '(eaches)',
  '(boxed)',
  '(packaged)',
  '(disc)',
  '(asst)',

  // Packaging notes
  '(w/ retail box)',
  '(w/o retail box)',

  // Special order markers
  '(special order)',
];

// Patterns that match a regex (case-insensitive)
const JUNK_PATTERN_REGEXES = [
  // Stock status patterns like "(out Beg Dec)", "(out Until July)"
  /\(out\s+(?:beg|until|mid)?\s*\w+\)/gi,

  // Customer limit patterns like "(5 Per Customer)", "(max 10)"
  /\(\d+\s*(?:per|pc|pcs)?\s*(?:per)?\s*cust(?:omer)?\.?\)/gi,
  /\(max\s*\d+\)/gi,
  /\(\s*\d+\s*per\s*cust\.?\s*\)/gi,

  // Quantity patterns that are ordering info, not product size
  /\(\d+\s*(?:box|per pop display|per display)\)/gi,
  /\(\d+\s*of\s*each\s*product\)/gi,

  // Long descriptive junk (product line names that shouldn't be in title)
  /\(bam gee plus[^)]*\)/gi,
  /\(izzy roq roco[^)]*\)/gi,

  // Misc distributor notes
  /\((?:cheap thrills|liquid onyx|luv lace|red diamond|bedroom fantasy|universal cuffs|peekaboos)\)/gi,
  /\((?:non vibrating|clit clamp included|for vaginal or anal use|wavy line mesh)\)/gi,
  /\((?:the heart nosed one|pointy tongued one|eggplant to taco)\)/gi,
  /\((?:spanish|bass)\)/gi,
];

// ==================== DATABASE INTERACTION ====================

import { config } from './lib/db';

async function queryMySQL(sql: string): Promise<string> {
  const { $ } = await import('bun');
  const result = await $`mysql --socket="${config.socketPath}" -u ${config.user} -p${config.password} ${config.database} -e ${sql} 2>/dev/null`.text();
  return result;
}

function parseMySQLOutput(output: string): Record<string, string>[] {
  const lines = output.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split('\t');
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return rows;
}

// ==================== CLEANUP LOGIC ====================

interface CleanupResult {
  original: string;
  cleaned: string;
  patternsRemoved: string[];
}

function cleanupTitle(title: string): CleanupResult {
  let cleaned = title;
  const patternsRemoved: string[] = [];

  // First, remove exact match patterns (case-insensitive)
  for (const pattern of JUNK_PATTERNS_EXACT) {
    const regex = new RegExp(escapeRegex(pattern), 'gi');
    const matches = cleaned.match(regex);
    if (matches) {
      patternsRemoved.push(...matches);
      cleaned = cleaned.replace(regex, '');
    }
  }

  // Then, remove regex patterns
  for (const regex of JUNK_PATTERN_REGEXES) {
    const matches = cleaned.match(regex);
    if (matches) {
      patternsRemoved.push(...matches);
      cleaned = cleaned.replace(regex, '');
    }
  }

  // Clean up extra whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Remove trailing/leading hyphens or dashes that might be left over
  cleaned = cleaned.replace(/^[\s\-–—]+|[\s\-–—]+$/g, '').trim();

  // Fix double spaces
  cleaned = cleaned.replace(/\s{2,}/g, ' ');

  return {
    original: title,
    cleaned,
    patternsRemoved,
  };
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==================== DATABASE QUERIES ====================

interface ProductRecord {
  id: number;
  title: string;
  type: string;
  content: string;
  excerpt: string;
}

async function fetchProductsWithPatterns(): Promise<ProductRecord[]> {
  // Fetch all products and variations that have parentheses in the title
  const sql = `
    SELECT
      ID as id,
      post_title as title,
      post_type as type,
      post_content as content,
      post_excerpt as excerpt
    FROM wp_posts
    WHERE post_type IN ('product', 'product_variation')
    AND post_status = 'publish'
    AND post_title LIKE '%(%)%'
    ORDER BY post_type, ID
  `;

  const output = await queryMySQL(sql);
  const rows = parseMySQLOutput(output);

  return rows.map(row => ({
    id: parseInt(row.id),
    title: row.title || '',
    type: row.type || '',
    content: row.content || '',
    excerpt: row.excerpt || '',
  }));
}

async function updateProductTitle(id: number, newTitle: string): Promise<void> {
  const escapedTitle = newTitle.replace(/'/g, "''").replace(/\\/g, '\\\\');

  const sql = `
    UPDATE wp_posts
    SET post_title = '${escapedTitle}'
    WHERE ID = ${id}
  `;

  await queryMySQL(sql);
}

async function updateProductContent(id: number, newContent: string): Promise<void> {
  const escapedContent = newContent.replace(/'/g, "''").replace(/\\/g, '\\\\');

  const sql = `
    UPDATE wp_posts
    SET post_content = '${escapedContent}'
    WHERE ID = ${id}
  `;

  await queryMySQL(sql);
}

async function updateProductExcerpt(id: number, newExcerpt: string): Promise<void> {
  const escapedExcerpt = newExcerpt.replace(/'/g, "''").replace(/\\/g, '\\\\');

  const sql = `
    UPDATE wp_posts
    SET post_excerpt = '${escapedExcerpt}'
    WHERE ID = ${id}
  `;

  await queryMySQL(sql);
}

// ==================== COMMANDS ====================

async function runDryRun(): Promise<void> {
  console.log('DRY RUN - Preview changes without applying\n');
  console.log('Fetching products with parentheses patterns...\n');

  const products = await fetchProductsWithPatterns();
  console.log(`Found ${products.length} products/variations with parentheses\n`);

  let titleChanges = 0;
  let contentChanges = 0;
  let excerptChanges = 0;
  const changes: { id: number; type: string; field: string; before: string; after: string; removed: string[] }[] = [];

  for (const product of products) {
    // Check title
    const titleResult = cleanupTitle(product.title);
    if (titleResult.patternsRemoved.length > 0) {
      titleChanges++;
      changes.push({
        id: product.id,
        type: product.type,
        field: 'title',
        before: titleResult.original,
        after: titleResult.cleaned,
        removed: titleResult.patternsRemoved,
      });
    }

    // Check content (description)
    if (product.content) {
      const contentResult = cleanupTitle(product.content);
      if (contentResult.patternsRemoved.length > 0) {
        contentChanges++;
      }
    }

    // Check excerpt (short description)
    if (product.excerpt) {
      const excerptResult = cleanupTitle(product.excerpt);
      if (excerptResult.patternsRemoved.length > 0) {
        excerptChanges++;
      }
    }
  }

  // Display changes
  console.log('========================================');
  console.log('         TITLE CHANGES PREVIEW');
  console.log('========================================\n');

  const toShow = changes.slice(0, 50);
  for (const change of toShow) {
    const typeLabel = change.type === 'product' ? '[PRODUCT]' : '[VAR]';
    console.log(`${typeLabel} ID: ${change.id}`);
    console.log(`  BEFORE: ${change.before}`);
    console.log(`  AFTER:  ${change.after}`);
    console.log(`  REMOVED: ${change.removed.join(', ')}`);
    console.log('');
  }

  if (changes.length > 50) {
    console.log(`... and ${changes.length - 50} more title changes\n`);
  }

  // Summary
  console.log('========================================');
  console.log('              SUMMARY');
  console.log('========================================\n');
  console.log(`Products/variations scanned: ${products.length}`);
  console.log(`Titles to update: ${titleChanges}`);
  console.log(`Descriptions to update: ${contentChanges}`);
  console.log(`Short descriptions to update: ${excerptChanges}`);
  console.log(`\nTotal changes: ${titleChanges + contentChanges + excerptChanges}`);
  console.log('\nRun with --apply to make these changes');
}

async function runApply(): Promise<void> {
  console.log('APPLYING CHANGES to database\n');
  console.log('Fetching products with parentheses patterns...\n');

  const products = await fetchProductsWithPatterns();
  console.log(`Found ${products.length} products/variations with parentheses\n`);

  let titleUpdates = 0;
  let contentUpdates = 0;
  let excerptUpdates = 0;
  let processed = 0;

  for (const product of products) {
    processed++;

    // Update title
    const titleResult = cleanupTitle(product.title);
    if (titleResult.patternsRemoved.length > 0) {
      await updateProductTitle(product.id, titleResult.cleaned);
      titleUpdates++;
    }

    // Update content (description)
    if (product.content) {
      const contentResult = cleanupTitle(product.content);
      if (contentResult.patternsRemoved.length > 0) {
        await updateProductContent(product.id, contentResult.cleaned);
        contentUpdates++;
      }
    }

    // Update excerpt (short description)
    if (product.excerpt) {
      const excerptResult = cleanupTitle(product.excerpt);
      if (excerptResult.patternsRemoved.length > 0) {
        await updateProductExcerpt(product.id, excerptResult.cleaned);
        excerptUpdates++;
      }
    }

    // Progress indicator every 100 items
    if (processed % 100 === 0) {
      console.log(`  Processed ${processed} of ${products.length}...`);
    }
  }

  // Summary
  console.log('\n========================================');
  console.log('           APPLY COMPLETE');
  console.log('========================================\n');
  console.log(`Products/variations processed: ${processed}`);
  console.log(`Titles updated: ${titleUpdates}`);
  console.log(`Descriptions updated: ${contentUpdates}`);
  console.log(`Short descriptions updated: ${excerptUpdates}`);
  console.log(`\nTotal updates: ${titleUpdates + contentUpdates + excerptUpdates}`);
}

// ==================== MAIN ENTRY POINT ====================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || '--dry-run';

  console.log('Title Cleanup Script - Remove junk () patterns while preserving size/color info\n');

  switch (command) {
    case '--dry-run':
      await runDryRun();
      break;
    case '--apply':
      await runApply();
      break;
    default:
      console.log('Usage:');
      console.log('  bun run scripts/cleanup-titles.ts --dry-run   # Preview changes');
      console.log('  bun run scripts/cleanup-titles.ts --apply     # Apply changes to database');
  }
}

main().catch(console.error);
