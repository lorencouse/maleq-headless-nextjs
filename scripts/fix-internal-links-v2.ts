/**
 * fix-internal-links-v2.ts
 *
 * Comprehensive script to rewrite all internal links in WordPress post_content
 * and comment_content to use the V2 Next.js URL structure.
 *
 * Rewrites:
 *   /product-category/slug  → /sex-toys/slug
 *   /category/slug          → /guides/category/slug
 *   /tag/slug               → /guides/tag/slug
 *   /my-account/...         → /account/...
 *   /author/...             → /guides
 *   /bare-blog-slug         → /guides/bare-blog-slug   (validated against DB)
 *   /manufacturer/slug      → /brand/slug
 *   /stories/slug           → /guides/slug
 *   Absolute maleq.com URLs → relative paths
 *
 * Usage:
 *   bun run scripts/fix-internal-links-v2.ts             # dry-run (default)
 *   bun run scripts/fix-internal-links-v2.ts --apply     # apply changes
 *   bun run scripts/fix-internal-links-v2.ts --verbose   # show every replacement
 */

import { getConnection } from './lib/db';

// ─── Config ──────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

/** Known V2 app routes that should NOT be prefixed with /guides/ */
const V2_ROUTES = new Set([
  'account', 'forgot-password', 'reset-password', 'search', 'login', 'register',
  'about', 'contact', 'faq', 'terms', 'privacy', 'shipping-returns',
  'brands', 'brand', 'shop', 'guides', 'cart', 'checkout',
  'product', 'sex-toys', 'order-confirmation', 'track-order', 'admin',
  'api', 'graphql',
]);

/** Domains that should be treated as internal and converted to relative paths */
const INTERNAL_DOMAINS = [
  'https://www.maleq.com',
  'http://www.maleq.com',
  'https://maleq.com',
  'http://maleq.com',
  'https://staging.maleq.com',
  'http://staging.maleq.com',
  'https://store.maleq.com',
  'http://store.maleq.com',
  'https://wp.maleq.com',
  'http://wp.maleq.com',
  'http://maleq-local.local',
  'https://maleq-local.local',
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface RewriteRule {
  pattern: RegExp;
  replacement: string | ((match: string, ...args: string[]) => string);
  description: string;
}

interface RewriteResult {
  postId: number;
  postType: string;
  title: string;
  table: string;
  changes: { from: string; to: string }[];
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔗 fix-internal-links-v2 — ${APPLY ? '⚡ APPLY MODE' : '🔍 DRY-RUN MODE'}\n`);

  const db = await getConnection();

  try {
    // 1. Load valid slugs from the database for validation
    console.log('Loading slugs from database...');

    const [postRows] = await db.query(
      `SELECT post_name FROM wp_posts WHERE post_status = 'publish' AND post_type = 'post'`
    ) as any[];
    const blogSlugs = new Set<string>((postRows as any[]).map(r => r.post_name));

    const [pageRows] = await db.query(
      `SELECT post_name FROM wp_posts WHERE post_status = 'publish' AND post_type = 'page'`
    ) as any[];
    const pageSlugs = new Set<string>((pageRows as any[]).map(r => r.post_name));

    const [catRows] = await db.query(
      `SELECT t.slug FROM wp_terms t
       JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
       WHERE tt.taxonomy = 'product_cat'`
    ) as any[];
    const categorySlugs = new Set<string>((catRows as any[]).map(r => r.slug));

    const [brandRows] = await db.query(
      `SELECT t.slug FROM wp_terms t
       JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
       WHERE tt.taxonomy = 'product_brand'`
    ) as any[];
    const brandSlugs = new Set<string>((brandRows as any[]).map(r => r.slug));

    const [productRows] = await db.query(
      `SELECT post_name FROM wp_posts WHERE post_status = 'publish' AND post_type = 'product'`
    ) as any[];
    const productSlugs = new Set<string>((productRows as any[]).map(r => r.post_name));

    console.log(`  Blog posts: ${blogSlugs.size}, Pages: ${pageSlugs.size}, Categories: ${categorySlugs.size}, Brands: ${brandSlugs.size}, Products: ${productSlugs.size}\n`);

    // 2. Build rewrite rules (order matters — more specific patterns first)
    const rules = buildRewriteRules(blogSlugs, pageSlugs, categorySlugs, brandSlugs, productSlugs);

    // 3. Process wp_posts
    console.log('Scanning wp_posts...');
    const postResults = await processTable(db, 'wp_posts', 'post_content', rules);

    // 4. Process wp_comments
    console.log('Scanning wp_comments...');
    const commentResults = await processComments(db, rules);

    // 5. Report
    const allResults = [...postResults, ...commentResults];
    printReport(allResults);

    if (allResults.length > 0 && !APPLY) {
      console.log('\n💡 Run with --apply to write changes to the database.');
    }
  } finally {
    await db.end();
  }
}

// ─── Rewrite Rules ───────────────────────────────────────────────────────────

function buildRewriteRules(
  blogSlugs: Set<string>,
  pageSlugs: Set<string>,
  categorySlugs: Set<string>,
  brandSlugs: Set<string>,
  productSlugs: Set<string>,
): RewriteRule[] {
  const rules: RewriteRule[] = [];

  // --- Pass 1: Convert absolute internal URLs to relative ---
  // Sort by longest domain first to avoid partial matches
  const sortedDomains = [...INTERNAL_DOMAINS].sort((a, b) => b.length - a.length);
  for (const domain of sortedDomains) {
    const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rules.push({
      pattern: new RegExp(`(href=["'])${escaped}(/[^"'<>\\s]*)`, 'gi'),
      replacement: '$1$2',
      description: `Strip domain: ${domain}`,
    });
  }

  // --- Pass 2: Rewrite known WordPress route patterns ---

  rules.push({
    pattern: /href=(["'])\/product-category\/([^"']+?)\/?["']/gi,
    replacement: 'href=$1/sex-toys/$2$1',
    description: '/product-category/ → /sex-toys/',
  });

  rules.push({
    pattern: /href=(["'])\/category\/([^"']+?)\/?["']/gi,
    replacement: 'href=$1/guides/category/$2$1',
    description: '/category/ → /guides/category/',
  });

  rules.push({
    pattern: /href=(["'])\/tag\/([^"']+?)\/?["']/gi,
    replacement: 'href=$1/guides/tag/$2$1',
    description: '/tag/ → /guides/tag/',
  });

  rules.push({
    pattern: /href=(["'])\/my-account(\/[^"']*)?\/?["']/gi,
    replacement: (_m: string, q: string) => `href=${q}/account${q}`,
    description: '/my-account/ → /account/',
  });

  rules.push({
    pattern: /href=(["'])\/author\/[^"']+?["']/gi,
    replacement: 'href=$1/guides$1',
    description: '/author/ → /guides',
  });

  rules.push({
    pattern: /href=(["'])\/stories\/([^"']+?)\/?["']/gi,
    replacement: 'href=$1/guides/$2$1',
    description: '/stories/ → /guides/',
  });

  rules.push({
    pattern: /href=(["'])\/manufacturer\/([^"']+?)\/?["']/gi,
    replacement: 'href=$1/brand/$2$1',
    description: '/manufacturer/ → /brand/',
  });

  rules.push({
    pattern: /href=(["'])\/members\/[^"']*["']/gi,
    replacement: 'href=$1/$1',
    description: '/members/ → /',
  });

  rules.push({
    pattern: /href=(["'])\/returns\/?["']/gi,
    replacement: 'href=$1/shipping-returns$1',
    description: '/returns → /shipping-returns',
  });

  // Date-based archive URLs: /2024/01/slug/ → /guides/slug
  rules.push({
    pattern: /href=(["'])\/\d{4}\/\d{2}\/([a-z0-9][a-z0-9-]*?)\/?["']/gi,
    replacement: 'href=$1/guides/$2$1',
    description: '/YYYY/MM/slug → /guides/slug',
  });

  rules.push({
    pattern: /href=(["'])\/\d{4}\/\d{2}\/\d{2}\/([a-z0-9][a-z0-9-]*?)\/?["']/gi,
    replacement: 'href=$1/guides/$2$1',
    description: '/YYYY/MM/DD/slug → /guides/slug',
  });

  // Feed URLs
  rules.push({
    pattern: /href=(["'])\/feed\/?[^"']*["']/gi,
    replacement: 'href=$1/$1',
    description: '/feed/ → /',
  });

  // --- Pass 3: Bare root-level blog slugs → /guides/slug ---
  // This must come LAST since it's the most general pattern
  rules.push({
    pattern: /href=(["'])\/([a-z0-9][a-z0-9-]*?)\/?["']/gi,
    replacement: (_match: string, quote: string, slug: string) => {
      const clean = slug.replace(/\/$/, '');
      const firstSegment = clean.split('/')[0].toLowerCase();

      // Skip known V2 routes
      if (V2_ROUTES.has(firstSegment)) {
        return `href=${quote}/${clean}${quote}`;
      }
      // Skip wp- prefixed paths
      if (firstSegment.startsWith('wp-')) {
        return `href=${quote}/${clean}${quote}`;
      }
      // Skip if it's a known product (already at /product/slug)
      if (productSlugs.has(clean)) {
        return `href=${quote}/product/${clean}${quote}`;
      }
      // Skip if it's a known category
      if (categorySlugs.has(clean)) {
        return `href=${quote}/sex-toys/${clean}${quote}`;
      }
      // Skip if it's a known brand
      if (brandSlugs.has(clean)) {
        return `href=${quote}/brand/${clean}${quote}`;
      }
      // If it matches a known blog slug, prefix with /guides/
      if (blogSlugs.has(clean)) {
        return `href=${quote}/guides/${clean}${quote}`;
      }
      // If it matches a known page slug, keep as-is (pages live at root)
      if (pageSlugs.has(clean)) {
        return `href=${quote}/${clean}${quote}`;
      }
      // Unknown slug — still prefix with /guides/ as the catch-all redirect
      // would do this anyway, but log it for review
      return `href=${quote}/guides/${clean}${quote}`;
    },
    description: 'Bare root slug → /guides/slug (validated)',
  });

  return rules;
}

// ─── Table Processing ────────────────────────────────────────────────────────

async function processTable(
  db: any,
  table: string,
  column: string,
  rules: RewriteRule[],
): Promise<RewriteResult[]> {
  // Find all posts that contain internal links (href="/ or href="https://...maleq...)
  const likeClauses = [
    `${column} LIKE '%href="/%'`,
    `${column} LIKE "%href='/%"`,
    ...INTERNAL_DOMAINS.map(d =>
      `${column} LIKE '%${d}%'`
    ),
  ];

  const [rows] = await db.query(
    `SELECT ID, post_title, post_type, ${column} AS content
     FROM ${table}
     WHERE post_status IN ('publish', 'draft')
       AND post_type IN ('post', 'page', 'wp_block')
       AND (${likeClauses.join(' OR ')})`
  ) as any[];

  const results: RewriteResult[] = [];

  for (const row of rows as any[]) {
    const original = row.content as string;
    let processed = original;
    const changes: { from: string; to: string }[] = [];

    for (const rule of rules) {
      processed = processed.replace(rule.pattern, (...args: any[]) => {
        const fullMatch = args[0] as string;
        const result = typeof rule.replacement === 'function'
          ? (rule.replacement as Function)(...args)
          : fullMatch.replace(rule.pattern, rule.replacement as string);

        // Reset lastIndex for global regexes
        rule.pattern.lastIndex = 0;

        if (result !== fullMatch) {
          changes.push({ from: fullMatch, to: result });
        }
        return result;
      });
      // Reset lastIndex after each rule
      rule.pattern.lastIndex = 0;
    }

    if (changes.length > 0) {
      results.push({
        postId: row.ID,
        postType: row.post_type,
        title: row.post_title,
        table,
        changes,
      });

      if (APPLY) {
        await db.query(
          `UPDATE ${table} SET ${column} = ? WHERE ID = ?`,
          [processed, row.ID]
        );
      }
    }
  }

  return results;
}

async function processComments(
  db: any,
  rules: RewriteRule[],
): Promise<RewriteResult[]> {
  const likeClauses = [
    `comment_content LIKE '%href="/%'`,
    `comment_content LIKE "%href='/%"`,
    ...INTERNAL_DOMAINS.map(d =>
      `comment_content LIKE '%${d}%'`
    ),
  ];

  const [rows] = await db.query(
    `SELECT comment_ID, comment_post_ID, comment_content
     FROM wp_comments
     WHERE comment_approved IN ('1', '0')
       AND (${likeClauses.join(' OR ')})`
  ) as any[];

  const results: RewriteResult[] = [];

  for (const row of rows as any[]) {
    const original = row.comment_content as string;
    let processed = original;
    const changes: { from: string; to: string }[] = [];

    for (const rule of rules) {
      processed = processed.replace(rule.pattern, (...args: any[]) => {
        const fullMatch = args[0] as string;
        const result = typeof rule.replacement === 'function'
          ? (rule.replacement as Function)(...args)
          : fullMatch.replace(rule.pattern, rule.replacement as string);
        rule.pattern.lastIndex = 0;

        if (result !== fullMatch) {
          changes.push({ from: fullMatch, to: result });
        }
        return result;
      });
      rule.pattern.lastIndex = 0;
    }

    if (changes.length > 0) {
      results.push({
        postId: row.comment_ID,
        postType: 'comment',
        title: `Comment on post #${row.comment_post_ID}`,
        table: 'wp_comments',
        changes,
      });

      if (APPLY) {
        await db.query(
          `UPDATE wp_comments SET comment_content = ? WHERE comment_ID = ?`,
          [processed, row.comment_ID]
        );
      }
    }
  }

  return results;
}

// ─── Reporting ───────────────────────────────────────────────────────────────

function printReport(results: RewriteResult[]) {
  const totalChanges = results.reduce((sum, r) => sum + r.changes.length, 0);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RESULTS: ${results.length} posts/comments with ${totalChanges} link rewrites`);
  console.log(`${'═'.repeat(60)}\n`);

  if (results.length === 0) {
    console.log('  ✅ No internal links need updating.\n');
    return;
  }

  // Summary by type
  const byType: Record<string, number> = {};
  for (const r of results) {
    byType[r.postType] = (byType[r.postType] || 0) + r.changes.length;
  }
  console.log('  Changes by content type:');
  for (const [type, count] of Object.entries(byType)) {
    console.log(`    ${type}: ${count} links`);
  }

  // Categorize changes
  const categories: Record<string, number> = {};
  for (const r of results) {
    for (const c of r.changes) {
      let cat = 'other';
      if (c.to.includes('/guides/')) cat = 'blog → /guides/';
      else if (c.to.includes('/sex-toys/')) cat = 'category → /sex-toys/';
      else if (c.to.includes('/brand/')) cat = 'brand → /brand/';
      else if (c.to.includes('/product/')) cat = 'product → /product/';
      else if (c.to.includes('/account')) cat = 'account → /account';
      else if (c.from.includes('maleq.com')) cat = 'domain → relative';
      categories[cat] = (categories[cat] || 0) + 1;
    }
  }
  console.log('\n  Changes by category:');
  for (const [cat, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat}: ${count}`);
  }

  // Verbose: show each change
  if (VERBOSE) {
    console.log('\n  Detailed changes:');
    for (const r of results) {
      console.log(`\n  [${r.postType}] #${r.postId}: ${r.title}`);
      for (const c of r.changes) {
        console.log(`    - ${c.from}`);
        console.log(`    + ${c.to}`);
      }
    }
  } else if (results.length > 0) {
    // Show a few samples
    console.log('\n  Sample changes (use --verbose for all):');
    let shown = 0;
    for (const r of results) {
      if (shown >= 10) break;
      for (const c of r.changes) {
        if (shown >= 10) break;
        console.log(`    [${r.postType} #${r.postId}] ${c.from} → ${c.to}`);
        shown++;
      }
    }
    if (totalChanges > 10) {
      console.log(`    ... and ${totalChanges - 10} more`);
    }
  }

  console.log('');
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
