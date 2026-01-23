#!/usr/bin/env bun

/**
 * Generate Product Link Mapping Report
 *
 * Creates a detailed document showing:
 * - Old links and their proposed new links/SKUs
 * - Unmatched links that need manual review
 * - Fuzzy match suggestions for unmatched items
 */

import mysql from 'mysql2/promise';
import { writeFileSync } from 'fs';

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two slugs (0-1, higher is better)
 */
function calculateSimilarity(searchSlug: string, productSlug: string): number {
  const search = searchSlug.toLowerCase();
  const product = productSlug.toLowerCase();

  // Exact match
  if (search === product) return 1;

  // Check if one contains the other (prefix/suffix match)
  if (product.includes(search) || search.includes(product)) {
    const longer = Math.max(search.length, product.length);
    const shorter = Math.min(search.length, product.length);
    return 0.7 + (shorter / longer) * 0.3;
  }

  // Token-based matching
  const searchTokens = search.split('-').filter(t => t.length > 2);
  const productTokens = product.split('-').filter(t => t.length > 2);

  let matchedTokens = 0;
  for (const st of searchTokens) {
    for (const pt of productTokens) {
      if (st === pt || pt.includes(st) || st.includes(pt)) {
        matchedTokens++;
        break;
      }
    }
  }

  const tokenScore = searchTokens.length > 0
    ? matchedTokens / searchTokens.length
    : 0;

  // Levenshtein-based similarity
  const maxLen = Math.max(search.length, product.length);
  const distance = levenshteinDistance(search, product);
  const levenshteinScore = 1 - distance / maxLen;

  // Combined score (weight token matching more heavily)
  return tokenScore * 0.6 + levenshteinScore * 0.4;
}

interface FuzzyMatch {
  slug: string;
  name: string;
  sku: string;
  score: number;
}

/**
 * Find top fuzzy matches for a given slug
 */
function findFuzzyMatches(
  searchSlug: string,
  productBySlug: Map<string, any>,
  limit: number = 3,
  minScore: number = 0.3
): FuzzyMatch[] {
  const matches: FuzzyMatch[] = [];

  for (const [slug, product] of productBySlug) {
    // Skip products with very short slugs (likely false positives)
    if (slug.length < 4) continue;
    // Skip products without names
    if (!product.name || product.name.trim() === '') continue;

    const score = calculateSimilarity(searchSlug, slug);
    if (score >= minScore) {
      matches.push({
        slug,
        name: product.name,
        sku: product.sku || 'N/A',
        score,
      });
    }
  }

  // Sort by score descending and take top results
  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

interface MatchedUrl {
  postId: number;
  postTitle: string;
  postType: string;
  oldUrl: string;
  oldSlug: string;
  newUrl: string;
  productName: string;
  sku: string;
}

interface UnmatchedUrl {
  postId: number;
  postTitle: string;
  postType: string;
  oldUrl: string;
  oldSlug: string;
}

interface MatchedShortcode {
  postId: number;
  postTitle: string;
  postType: string;
  oldShortcode: string;
  oldProductId: number;
  newShortcode: string;
  productName: string;
  sku: string;
  newUrl: string;
}

interface UnmatchedShortcode {
  postId: number;
  postTitle: string;
  postType: string;
  oldShortcode: string;
  oldProductId: number;
}

interface MigratedUrl {
  postId: number;
  postTitle: string;
  newUrl: string;
  slug: string;
  productName: string;
  sku: string;
}

interface MigratedShortcode {
  postId: number;
  postTitle: string;
  newShortcode: string;
  sku: string;
  productName: string;
  productSlug: string;
}

async function main() {
  const connection = await mysql.createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });

  console.log('Loading products...');

  // Get all products with SKUs
  const [products] = await connection.execute(`
    SELECT
      p.ID as id,
      p.post_name as slug,
      p.post_title as name,
      MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) as sku
    FROM wp_posts p
    LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
    WHERE p.post_type IN ('product', 'product_variation')
    AND p.post_status = 'publish'
    GROUP BY p.ID
  `) as [any[], any];

  const productBySlug = new Map<string, any>();
  const productById = new Map<number, any>();

  for (const p of products) {
    if (p.slug) {
      productBySlug.set(p.slug.toLowerCase(), p);
    }
    productById.set(p.id, p);
  }

  console.log(`Loaded ${products.length} products`);

  // Build SKU to product map
  const productBySku = new Map<string, any>();
  for (const p of products) {
    if (p.sku) {
      productBySku.set(p.sku, p);
    }
  }

  // Get posts with links (both old and new format)
  const [posts] = await connection.execute(`
    SELECT ID, post_title, post_type, post_content
    FROM wp_posts
    WHERE post_type IN ('post', 'wp_block')
    AND post_status = 'publish'
    AND (
      post_content LIKE '%maleq%/product/%'
      OR post_content LIKE '%/shop/product/%'
      OR post_content LIKE '%add_to_cart%'
    )
  `) as [any[], any];

  console.log(`Processing ${posts.length} posts...`);

  const matchedUrls: MatchedUrl[] = [];
  const unmatchedUrls: UnmatchedUrl[] = [];
  const matchedShortcodes: MatchedShortcode[] = [];
  const unmatchedShortcodes: UnmatchedShortcode[] = [];
  const migratedUrls: MigratedUrl[] = [];
  const migratedShortcodes: MigratedShortcode[] = [];

  for (const post of posts) {
    const content = post.post_content || '';

    // Extract URLs
    const urlRegex = /https?:\/\/[^"'\s<>]*(?:maleq[^"'\s<>]*|maleq-local\.local)\/product\/([^"'\s<>\/\?#]+)[^"'\s<>]*/gi;
    let match;
    while ((match = urlRegex.exec(content)) !== null) {
      const oldUrl = match[0];
      const slug = match[1].toLowerCase();
      const product = productBySlug.get(slug);

      if (product) {
        matchedUrls.push({
          postId: post.ID,
          postTitle: post.post_title,
          postType: post.post_type,
          oldUrl,
          oldSlug: slug,
          newUrl: `/shop/product/${product.slug}`,
          productName: product.name,
          sku: product.sku || 'N/A',
        });
      } else {
        unmatchedUrls.push({
          postId: post.ID,
          postTitle: post.post_title,
          postType: post.post_type,
          oldUrl,
          oldSlug: slug,
        });
      }
    }

    // Extract shortcodes
    const scRegex = /\[add_to_cart\s+id="?(\d+)"?\]/gi;
    while ((match = scRegex.exec(content)) !== null) {
      const oldShortcode = match[0];
      const productId = parseInt(match[1], 10);
      const product = productById.get(productId);

      if (product) {
        matchedShortcodes.push({
          postId: post.ID,
          postTitle: post.post_title,
          postType: post.post_type,
          oldShortcode,
          oldProductId: productId,
          newShortcode: product.sku
            ? `[add_to_cart sku="${product.sku}"]`
            : `<a href="/shop/product/${product.slug}">View Product</a>`,
          productName: product.name,
          sku: product.sku || 'N/A',
          newUrl: `/shop/product/${product.slug}`,
        });
      } else {
        unmatchedShortcodes.push({
          postId: post.ID,
          postTitle: post.post_title,
          postType: post.post_type,
          oldShortcode,
          oldProductId: productId,
        });
      }
    }

    // Extract migrated URLs (new format: /shop/product/{slug})
    const newUrlRegex = /\/shop\/product\/([^"'\s<>\/\?#]+)/gi;
    while ((match = newUrlRegex.exec(content)) !== null) {
      const slug = match[1].toLowerCase();
      const product = productBySlug.get(slug);
      if (product) {
        migratedUrls.push({
          postId: post.ID,
          postTitle: post.post_title,
          newUrl: match[0],
          slug,
          productName: product.name,
          sku: product.sku || 'N/A',
        });
      }
    }

    // Extract migrated shortcodes (new format: [add_to_cart sku="..."])
    const newScRegex = /\[add_to_cart\s+sku="([^"]+)"\]/gi;
    while ((match = newScRegex.exec(content)) !== null) {
      const sku = match[1];
      const product = productBySku.get(sku);
      if (product) {
        migratedShortcodes.push({
          postId: post.ID,
          postTitle: post.post_title,
          newShortcode: match[0],
          sku,
          productName: product.name,
          productSlug: product.slug,
        });
      }
    }
  }

  // Generate markdown report
  const lines: string[] = [];

  lines.push('# Product Link Migration Status');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Migration Summary');
  lines.push('');
  lines.push('The product link migration has been executed. URLs and shortcodes that could be');
  lines.push('matched to existing products have been converted to the new format.');
  lines.push('');
  lines.push('### Completed');
  lines.push('- URLs converted from `maleq.com/product/{slug}` to `/shop/product/{slug}`');
  lines.push('- Shortcodes converted from `[add_to_cart id="..."]` to `[add_to_cart sku="..."]`');
  lines.push('');
  // Deduplicate migrated URLs by slug
  const uniqueMigratedUrls = new Map<string, MigratedUrl>();
  for (const item of migratedUrls) {
    if (!uniqueMigratedUrls.has(item.slug)) {
      uniqueMigratedUrls.set(item.slug, item);
    }
  }

  // Deduplicate migrated shortcodes by SKU
  const uniqueMigratedSc = new Map<string, MigratedShortcode>();
  for (const item of migratedShortcodes) {
    if (!uniqueMigratedSc.has(item.sku)) {
      uniqueMigratedSc.set(item.sku, item);
    }
  }

  lines.push('### Successfully Migrated');
  lines.push(`- **${migratedUrls.length}** URLs converted (${uniqueMigratedUrls.size} unique products)`);
  lines.push(`- **${migratedShortcodes.length}** shortcodes converted (${uniqueMigratedSc.size} unique products)`);
  lines.push('');
  lines.push('### Remaining Issues');
  lines.push(`- **${unmatchedUrls.length}** URLs reference discontinued products`);
  lines.push(`- **${unmatchedShortcodes.length}** shortcodes reference discontinued products`);
  lines.push('');

  // Deduplicate matched URLs by slug
  const uniqueMatchedUrls = new Map<string, MatchedUrl>();
  for (const item of matchedUrls) {
    if (!uniqueMatchedUrls.has(item.oldSlug)) {
      uniqueMatchedUrls.set(item.oldSlug, item);
    }
  }

  // Deduplicate matched shortcodes by product ID
  const uniqueMatchedSc = new Map<number, MatchedShortcode>();
  for (const item of matchedShortcodes) {
    if (!uniqueMatchedSc.has(item.oldProductId)) {
      uniqueMatchedSc.set(item.oldProductId, item);
    }
  }

  // Migrated URLs section
  if (uniqueMigratedUrls.size > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Successfully Migrated URLs');
    lines.push('');
    lines.push('These URLs have been converted to the new `/shop/product/{slug}` format:');
    lines.push('');
    lines.push('| Product Slug | Product Name | SKU | Posts Count |');
    lines.push('|--------------|--------------|-----|-------------|');

    // Count posts per slug
    const postCountBySlug = new Map<string, number>();
    for (const item of migratedUrls) {
      postCountBySlug.set(item.slug, (postCountBySlug.get(item.slug) || 0) + 1);
    }

    for (const [slug, item] of uniqueMigratedUrls) {
      const name =
        item.productName.length > 40
          ? item.productName.substring(0, 40) + '...'
          : item.productName;
      const count = postCountBySlug.get(slug) || 1;
      lines.push(`| ${slug} | ${name} | ${item.sku} | ${count} |`);
    }
    lines.push('');
  }

  // Migrated Shortcodes section
  if (uniqueMigratedSc.size > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Successfully Migrated Shortcodes');
    lines.push('');
    lines.push('These shortcodes have been converted to SKU-based format:');
    lines.push('');
    lines.push('| SKU | New Shortcode | Product Name | Product Slug | Posts Count |');
    lines.push('|-----|---------------|--------------|--------------|-------------|');

    // Count posts per SKU
    const postCountBySku = new Map<string, number>();
    for (const item of migratedShortcodes) {
      postCountBySku.set(item.sku, (postCountBySku.get(item.sku) || 0) + 1);
    }

    for (const [sku, item] of uniqueMigratedSc) {
      const name =
        item.productName.length > 30
          ? item.productName.substring(0, 30) + '...'
          : item.productName;
      const count = postCountBySku.get(sku) || 1;
      lines.push(`| ${sku} | ${item.newShortcode} | ${name} | ${item.productSlug} | ${count} |`);
    }
    lines.push('');
  }

  // Only show matched sections if there are items (pre-migration)
  if (uniqueMatchedUrls.size > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Matched URLs - Ready to Update');
    lines.push('');
    lines.push('These URLs have been matched to existing products and can be updated:');
    lines.push('');
    lines.push('| Old Slug | New URL | Product Name | SKU |');
    lines.push('|----------|---------|--------------|-----|');

    for (const item of uniqueMatchedUrls.values()) {
      const name =
        item.productName.length > 40
          ? item.productName.substring(0, 40) + '...'
          : item.productName;
      lines.push(`| ${item.oldSlug} | ${item.newUrl} | ${name} | ${item.sku} |`);
    }
    lines.push('');
  }

  if (uniqueMatchedSc.size > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Matched Shortcodes - Ready to Update');
    lines.push('');
    lines.push('These shortcodes have been matched to existing products:');
    lines.push('');
    lines.push('| Old Product ID | Old Shortcode | New Shortcode | Product Name | SKU |');
    lines.push('|----------------|---------------|---------------|--------------|-----|');

    for (const item of uniqueMatchedSc.values()) {
      const name =
        item.productName.length > 30
          ? item.productName.substring(0, 30) + '...'
          : item.productName;
      const newSc =
        item.sku !== 'N/A'
          ? `[add_to_cart sku="${item.sku}"]`
          : `Link: ${item.newUrl}`;
      lines.push(
        `| ${item.oldProductId} | ${item.oldShortcode} | ${newSc} | ${name} | ${item.sku} |`
      );
    }
    lines.push('');
  }

  // Unmatched URLs section
  lines.push('---');
  lines.push('');
  lines.push('## Unmatched URLs - Need Manual Review');
  lines.push('');
  lines.push(
    'These product slugs do not exist in the current database. The products may have been discontinued or renamed.'
  );
  lines.push('');
  lines.push('| Old Slug | Posts Using This Link |');
  lines.push('|----------|----------------------|');

  // Group by slug
  const unmatchedUrlsBySlug = new Map<string, UnmatchedUrl[]>();
  for (const item of unmatchedUrls) {
    if (!unmatchedUrlsBySlug.has(item.oldSlug)) {
      unmatchedUrlsBySlug.set(item.oldSlug, []);
    }
    unmatchedUrlsBySlug.get(item.oldSlug)!.push(item);
  }

  for (const [slug, items] of unmatchedUrlsBySlug) {
    const postList = items
      .slice(0, 3)
      .map((i) => `${i.postId}`)
      .join(', ');
    const more = items.length > 3 ? ` (+${items.length - 3} more)` : '';
    lines.push(`| ${slug} | Post IDs: ${postList}${more} |`);
  }

  lines.push('');

  // Fuzzy Match Suggestions section
  console.log('Generating fuzzy match suggestions...');
  lines.push('---');
  lines.push('');
  lines.push('## Fuzzy Match Suggestions');
  lines.push('');
  lines.push('Check the box next to the correct replacement product, then run:');
  lines.push('```bash');
  lines.push('bun scripts/apply-fuzzy-matches.ts');
  lines.push('```');
  lines.push('');

  let fuzzyMatchCount = 0;
  for (const [slug] of unmatchedUrlsBySlug) {
    const matches = findFuzzyMatches(slug, productBySlug, 3, 0.35);
    if (matches.length > 0) {
      fuzzyMatchCount++;
      lines.push(`### \`${slug}\``);
      lines.push('');
      for (const match of matches) {
        const name = match.name.length > 50
          ? match.name.substring(0, 50) + '...'
          : match.name;
        const scorePercent = Math.round(match.score * 100);
        // Format: - [ ] old-slug -> new-slug (Product Name) [SKU] {score%}
        lines.push(`- [ ] \`${slug}\` → \`${match.slug}\` — ${name} (${scorePercent}%)`);
      }
      lines.push('- [ ] **REMOVE** - Delete all links to `' + slug + '`');
      lines.push('');
    }
  }

  if (fuzzyMatchCount === 0) {
    lines.push('No fuzzy matches found for unmatched URLs.');
    lines.push('');
  } else {
    console.log(`Found fuzzy matches for ${fuzzyMatchCount} unmatched slugs`);
  }

  // Unmatched Shortcodes section
  lines.push('---');
  lines.push('');
  lines.push('## Unmatched Shortcodes - Need Manual Review');
  lines.push('');
  lines.push('These product IDs do not exist in the current database:');
  lines.push('');
  lines.push('| Old Product ID | Posts Using This |');
  lines.push('|----------------|------------------|');

  // Group by product ID
  const unmatchedScById = new Map<number, UnmatchedShortcode[]>();
  for (const item of unmatchedShortcodes) {
    if (!unmatchedScById.has(item.oldProductId)) {
      unmatchedScById.set(item.oldProductId, []);
    }
    unmatchedScById.get(item.oldProductId)!.push(item);
  }

  for (const [productId, items] of unmatchedScById) {
    const postList = items
      .slice(0, 3)
      .map((i) => `${i.postId}`)
      .join(', ');
    const more = items.length > 3 ? ` (+${items.length - 3} more)` : '';
    lines.push(`| ${productId} | Post IDs: ${postList}${more} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Next Steps');
  lines.push('');
  if (uniqueMatchedUrls.size > 0 || uniqueMatchedSc.size > 0) {
    lines.push(
      '1. **For matched items:** Run `bun scripts/update-product-links-v2.ts --execute` to apply changes'
    );
  }
  lines.push(
    '1. **For unmatched URLs:** Either find replacement products or remove the broken links'
  );
  lines.push(
    '2. **For unmatched shortcodes:** Either find replacement products or convert to text/remove'
  );
  lines.push('');
  lines.push('### Options for Unmatched Items');
  lines.push('');
  lines.push('- **Remove:** Delete the link/shortcode from the post content');
  lines.push('- **Replace:** Find a similar product and update the link manually');
  lines.push('- **Archive:** If the entire post is about discontinued products, consider unpublishing');
  lines.push('');

  const reportPath =
    '/Volumes/Mac Mini M4 -2TB/MacMini-Data/Documents/web-dev/maleq-headless/docs/product-link-mapping.md';
  writeFileSync(reportPath, lines.join('\n'));

  console.log(`\nReport saved to: ${reportPath}`);
  console.log(
    `\nMigrated: ${uniqueMigratedUrls.size} unique URLs, ${uniqueMigratedSc.size} unique shortcodes`
  );
  console.log(
    `Unmatched: ${unmatchedUrlsBySlug.size} unique URL slugs, ${unmatchedScById.size} unique shortcode IDs`
  );

  await connection.end();
}

main().catch(console.error);
