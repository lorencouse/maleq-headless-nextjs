/**
 * Analyze Title Patterns Script
 * Extracts and analyzes () patterns in product titles, variation names, and descriptions
 *
 * Usage:
 *   bun run scripts/analyze-title-patterns.ts --analyze     # List all unique () patterns
 *   bun run scripts/analyze-title-patterns.ts --preview     # Show sample products with patterns
 *   bun run scripts/analyze-title-patterns.ts --dry-run     # Preview cleanup changes
 *   bun run scripts/analyze-title-patterns.ts --apply       # Apply cleanup to database
 */

// ==================== DATABASE INTERACTION ====================

const MYSQL_CONFIG = {
  socketPath: `${process.env.HOME}/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock`,
  user: 'root',
  password: 'root',
  database: 'local',
};

async function queryMySQL(sql: string): Promise<string> {
  const { $ } = await import('bun');
  const result = await $`mysql --socket="${MYSQL_CONFIG.socketPath}" -u ${MYSQL_CONFIG.user} -p${MYSQL_CONFIG.password} ${MYSQL_CONFIG.database} -e ${sql} 2>/dev/null`.text();
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

// ==================== PATTERN EXTRACTION ====================

interface PatternInfo {
  pattern: string;
  count: number;
  examples: string[];
}

interface ProductWithPatterns {
  id: number;
  title: string;
  type: string;
  patterns: string[];
}

function extractParenthesesPatterns(text: string): string[] {
  if (!text) return [];

  // Match all content within parentheses
  const regex = /\([^)]+\)/g;
  const matches = text.match(regex) || [];
  return matches;
}

// ==================== QUERIES ====================

async function fetchAllProductTitles(): Promise<{ id: number; title: string; type: string }[]> {
  const sql = `
    SELECT
      ID as id,
      post_title as title,
      post_type as type
    FROM wp_posts
    WHERE post_type IN ('product', 'product_variation')
    AND post_status = 'publish'
    ORDER BY post_type, post_title
  `;

  const output = await queryMySQL(sql);
  const rows = parseMySQLOutput(output);

  return rows.map(row => ({
    id: parseInt(row.id),
    title: row.title || '',
    type: row.type || '',
  }));
}

async function fetchProductDescriptions(): Promise<{ id: number; title: string; content: string; excerpt: string }[]> {
  const sql = `
    SELECT
      ID as id,
      post_title as title,
      post_content as content,
      post_excerpt as excerpt
    FROM wp_posts
    WHERE post_type = 'product'
    AND post_status = 'publish'
    AND (
      post_content LIKE '%(%)%'
      OR post_excerpt LIKE '%(%)%'
    )
    LIMIT 500
  `;

  const output = await queryMySQL(sql);
  const rows = parseMySQLOutput(output);

  return rows.map(row => ({
    id: parseInt(row.id),
    title: row.title || '',
    content: row.content || '',
    excerpt: row.excerpt || '',
  }));
}

// ==================== ANALYSIS ====================

async function analyzePatterns(): Promise<void> {
  console.log('Fetching all product titles from database...\n');

  const products = await fetchAllProductTitles();
  console.log(`Found ${products.length} total products/variations\n`);

  const patternCounts = new Map<string, PatternInfo>();
  const productsWithPatterns: ProductWithPatterns[] = [];

  // Count products and variations
  const productCount = products.filter(p => p.type === 'product').length;
  const variationCount = products.filter(p => p.type === 'product_variation').length;

  console.log(`  - Products: ${productCount}`);
  console.log(`  - Variations: ${variationCount}\n`);

  // Extract patterns
  for (const product of products) {
    const patterns = extractParenthesesPatterns(product.title);

    if (patterns.length > 0) {
      productsWithPatterns.push({
        id: product.id,
        title: product.title,
        type: product.type,
        patterns,
      });

      for (const pattern of patterns) {
        // Normalize pattern (lowercase for grouping)
        const normalizedPattern = pattern.toLowerCase();

        if (!patternCounts.has(normalizedPattern)) {
          patternCounts.set(normalizedPattern, {
            pattern: pattern, // Keep original case for display
            count: 0,
            examples: [],
          });
        }

        const info = patternCounts.get(normalizedPattern)!;
        info.count++;
        if (info.examples.length < 3) {
          info.examples.push(product.title);
        }
      }
    }
  }

  // Sort by count (descending)
  const sortedPatterns = Array.from(patternCounts.entries())
    .sort((a, b) => b[1].count - a[1].count);

  console.log('========================================');
  console.log('     PARENTHESES PATTERNS FOUND');
  console.log('========================================\n');

  console.log(`Total products/variations with patterns: ${productsWithPatterns.length}\n`);

  // Group patterns by category
  const junkPatterns: [string, PatternInfo][] = [];
  const sizePatterns: [string, PatternInfo][] = [];
  const colorPatterns: [string, PatternInfo][] = [];
  const otherPatterns: [string, PatternInfo][] = [];

  const junkKeywords = ['net', 'bulk', 'special order', 'amazon', 'restricted', 'drop ship', 'dropship', 'discontinued', 'closeout', 'clearance', 'final sale', 'non-returnable', 'a', 'b', 'c', 'd', 'tester'];
  const sizeKeywords = ['oz', 'ml', 'inch', 'in', 'mm', 'cm', 'small', 'medium', 'large', 'xl', 'pack', 'count', 'ct', 'pc', 'piece'];
  const colorKeywords = ['black', 'white', 'red', 'blue', 'pink', 'purple', 'clear', 'flesh', 'brown', 'tan', 'color'];

  for (const [key, info] of sortedPatterns) {
    const lowerPattern = key.toLowerCase();
    const innerText = lowerPattern.replace(/[()]/g, '').trim();

    if (junkKeywords.some(kw => innerText === kw || innerText.includes(kw))) {
      junkPatterns.push([key, info]);
    } else if (sizeKeywords.some(kw => innerText.includes(kw)) || /^\d+(\.\d+)?$/.test(innerText)) {
      sizePatterns.push([key, info]);
    } else if (colorKeywords.some(kw => innerText.includes(kw))) {
      colorPatterns.push([key, info]);
    } else {
      otherPatterns.push([key, info]);
    }
  }

  // Display categorized patterns
  console.log('----------------------------------------');
  console.log('LIKELY JUNK PATTERNS (to remove):');
  console.log('----------------------------------------');
  for (const [key, info] of junkPatterns) {
    console.log(`  ${info.pattern.padEnd(30)} - ${info.count} occurrences`);
  }

  console.log('\n----------------------------------------');
  console.log('SIZE/QUANTITY PATTERNS (may keep):');
  console.log('----------------------------------------');
  for (const [key, info] of sizePatterns.slice(0, 30)) {
    console.log(`  ${info.pattern.padEnd(30)} - ${info.count} occurrences`);
  }
  if (sizePatterns.length > 30) {
    console.log(`  ... and ${sizePatterns.length - 30} more size patterns`);
  }

  console.log('\n----------------------------------------');
  console.log('COLOR PATTERNS (may keep):');
  console.log('----------------------------------------');
  for (const [key, info] of colorPatterns.slice(0, 20)) {
    console.log(`  ${info.pattern.padEnd(30)} - ${info.count} occurrences`);
  }
  if (colorPatterns.length > 20) {
    console.log(`  ... and ${colorPatterns.length - 20} more color patterns`);
  }

  console.log('\n----------------------------------------');
  console.log('OTHER PATTERNS (review):');
  console.log('----------------------------------------');
  for (const [key, info] of otherPatterns.slice(0, 50)) {
    console.log(`  ${info.pattern.padEnd(30)} - ${info.count} occurrences`);
    if (info.examples.length > 0) {
      console.log(`    Example: ${info.examples[0].substring(0, 70)}${info.examples[0].length > 70 ? '...' : ''}`);
    }
  }
  if (otherPatterns.length > 50) {
    console.log(`  ... and ${otherPatterns.length - 50} more patterns`);
  }

  // Summary
  console.log('\n========================================');
  console.log('              SUMMARY');
  console.log('========================================');
  console.log(`\nTotal unique patterns: ${sortedPatterns.length}`);
  console.log(`  - Likely junk: ${junkPatterns.length} patterns (${junkPatterns.reduce((sum, [, info]) => sum + info.count, 0)} occurrences)`);
  console.log(`  - Size/quantity: ${sizePatterns.length} patterns`);
  console.log(`  - Color: ${colorPatterns.length} patterns`);
  console.log(`  - Other: ${otherPatterns.length} patterns`);

  // Export junk patterns for reference
  console.log('\n\nJUNK PATTERNS TO REMOVE (copy for cleanup):');
  console.log('const JUNK_PATTERNS = [');
  for (const [key, info] of junkPatterns) {
    console.log(`  '${info.pattern.replace(/'/g, "\\'")}',`);
  }
  console.log('];');
}

async function previewProducts(): Promise<void> {
  console.log('Fetching sample products with parentheses patterns...\n');

  const products = await fetchAllProductTitles();
  const productsWithPatterns = products.filter(p => extractParenthesesPatterns(p.title).length > 0);

  console.log('========================================');
  console.log('    SAMPLE PRODUCTS WITH PATTERNS');
  console.log('========================================\n');

  // Show first 50 products
  const toShow = productsWithPatterns.slice(0, 50);

  for (const product of toShow) {
    const patterns = extractParenthesesPatterns(product.title);
    const typeLabel = product.type === 'product' ? '[PRODUCT]' : '[VARIATION]';
    console.log(`${typeLabel} ${product.title}`);
    console.log(`  Patterns: ${patterns.join(', ')}`);
    console.log('');
  }

  console.log(`\nShowing ${toShow.length} of ${productsWithPatterns.length} products with patterns`);
}

// ==================== MAIN ENTRY POINT ====================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || '--analyze';

  console.log('Title Pattern Analyzer - Find and categorize () patterns in product titles\n');

  switch (command) {
    case '--analyze':
      await analyzePatterns();
      break;
    case '--preview':
      await previewProducts();
      break;
    case '--dry-run':
      console.log('Dry-run mode not yet implemented. Use --analyze first to identify patterns.');
      break;
    case '--apply':
      console.log('Apply mode not yet implemented. Use --analyze first to identify patterns.');
      break;
    default:
      console.log('Usage:');
      console.log('  bun run scripts/analyze-title-patterns.ts --analyze   # List all unique () patterns');
      console.log('  bun run scripts/analyze-title-patterns.ts --preview   # Show sample products with patterns');
  }
}

main().catch(console.error);
