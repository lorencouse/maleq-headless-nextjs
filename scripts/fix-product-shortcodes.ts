#!/usr/bin/env bun

/**
 * Fix Product Shortcodes Script
 *
 * Finds product shortcodes in WordPress content, matches them to new products
 * by analyzing nearby product links, and updates the IDs.
 *
 * Usage:
 *   bun scripts/fix-product-shortcodes.ts [options]
 *
 * Options:
 *   --dry-run       Generate report without making changes
 *   --apply         Apply changes to database
 *   --post-id <id>  Process a specific post
 */

import { createConnection, Connection } from 'mysql2/promise';
import { writeFileSync } from 'fs';
import { join } from 'path';

const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';

interface ShortcodeMatch {
  postId: number;
  postTitle: string;
  shortcodeType: 'add_to_cart' | 'product';
  oldId: string;
  nearbyProductUrl: string | null;
  nearbyProductSlug: string | null;
  nearbyImageCaption: string | null;
  newProductId: number | null;
  newProductName: string | null;
  matchConfidence: number;
  matchMethod: string;
  position: number;
}

interface ProductLookup {
  id: number;
  name: string;
  slug: string;
  sku: string;
  type: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const minConfidenceIdx = args.indexOf('--min-confidence');
  return {
    dryRun: args.includes('--dry-run') || !args.includes('--apply'),
    apply: args.includes('--apply'),
    postId: args.includes('--post-id') ? parseInt(args[args.indexOf('--post-id') + 1], 10) : undefined,
    minConfidence: minConfidenceIdx !== -1 ? parseInt(args[minConfidenceIdx + 1], 10) : 100,
    updateUrls: args.includes('--update-urls'),
  };
}

/**
 * Extract product slug from URL
 */
function extractSlugFromUrl(url: string): string | null {
  // Match /product/slug/ or /product/slug patterns
  const match = url.match(/\/product\/([^\/\?"]+)/);
  return match ? match[1] : null;
}

/**
 * Calculate string similarity (Levenshtein distance based)
 */
function similarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshtein(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshtein(s1: string, s2: string): number {
  const costs: number[] = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

/**
 * Normalize text for comparison
 */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

class ShortcodeFixer {
  private connection: Connection;
  private products: ProductLookup[] = [];
  private productsBySlug: Map<string, ProductLookup> = new Map();
  private productsBySku: Map<string, ProductLookup> = new Map();
  private productsByNormalizedName: Map<string, ProductLookup[]> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Load all products for matching
   */
  async loadProducts(): Promise<void> {
    console.log('Loading products from database...');

    const [rows] = await this.connection.execute(`
      SELECT
        p.ID as id,
        p.post_title as name,
        p.post_name as slug,
        COALESCE(pm.meta_value, '') as sku,
        COALESCE(t.slug, 'simple') as type
      FROM wp_posts p
      LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key = '_sku'
      LEFT JOIN wp_term_relationships tr ON p.ID = tr.object_id
      LEFT JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id AND tt.taxonomy = 'product_type'
      LEFT JOIN wp_terms t ON tt.term_id = t.term_id
      WHERE p.post_type = 'product'
        AND p.post_status = 'publish'
    `);

    this.products = rows as ProductLookup[];

    // Build lookup maps
    for (const product of this.products) {
      // By slug
      this.productsBySlug.set(product.slug.toLowerCase(), product);

      // By SKU
      if (product.sku) {
        this.productsBySku.set(product.sku.toLowerCase(), product);
      }

      // By normalized name
      const normalized = normalizeForComparison(product.name);
      if (!this.productsByNormalizedName.has(normalized)) {
        this.productsByNormalizedName.set(normalized, []);
      }
      this.productsByNormalizedName.get(normalized)!.push(product);
    }

    console.log(`✓ Loaded ${this.products.length} products`);
    console.log(`  - ${this.productsBySlug.size} unique slugs`);
    console.log(`  - ${this.productsBySku.size} products with SKUs`);
  }

  /**
   * Find product by slug with fuzzy matching
   */
  findProductBySlug(slug: string): { product: ProductLookup | null; confidence: number; method: string } {
    const normalizedSlug = slug.toLowerCase();

    // Exact match
    if (this.productsBySlug.has(normalizedSlug)) {
      return {
        product: this.productsBySlug.get(normalizedSlug)!,
        confidence: 100,
        method: 'exact_slug'
      };
    }

    // Try without common suffixes/prefixes
    const variations = [
      normalizedSlug.replace(/-\d+(-oz|-ml|-pack|-count)?$/, ''),
      normalizedSlug.replace(/^(the-|a-|an-)/, ''),
      normalizedSlug.replace(/-net$/, ''),
    ];

    for (const variant of variations) {
      if (this.productsBySlug.has(variant)) {
        return {
          product: this.productsBySlug.get(variant)!,
          confidence: 95,
          method: 'slug_variant'
        };
      }
    }

    // Fuzzy match on slug
    let bestMatch: ProductLookup | null = null;
    let bestSimilarity = 0;

    for (const [productSlug, product] of this.productsBySlug) {
      const sim = similarity(normalizedSlug, productSlug);
      if (sim > bestSimilarity && sim >= 0.8) {
        bestSimilarity = sim;
        bestMatch = product;
      }
    }

    if (bestMatch) {
      return {
        product: bestMatch,
        confidence: Math.round(bestSimilarity * 100),
        method: 'fuzzy_slug'
      };
    }

    // Try matching by normalized name from slug
    const nameFromSlug = normalizedSlug.replace(/-/g, '');
    for (const [normalizedName, products] of this.productsByNormalizedName) {
      const sim = similarity(nameFromSlug, normalizedName);
      if (sim > bestSimilarity && sim >= 0.75) {
        bestSimilarity = sim;
        bestMatch = products[0];
      }
    }

    if (bestMatch) {
      return {
        product: bestMatch,
        confidence: Math.round(bestSimilarity * 100),
        method: 'fuzzy_name'
      };
    }

    return { product: null, confidence: 0, method: 'no_match' };
  }

  /**
   * Extract shortcodes and their context from content
   */
  extractShortcodesWithContext(content: string, postId: number, postTitle: string): ShortcodeMatch[] {
    const matches: ShortcodeMatch[] = [];

    // Find all shortcodes
    const shortcodeRegex = /\[(add_to_cart|product)\s+id="(\d+)"\]/g;
    let match;

    while ((match = shortcodeRegex.exec(content)) !== null) {
      const shortcodeType = match[1] as 'add_to_cart' | 'product';
      const oldId = match[2];
      const position = match.index;

      // Look for nearby product URL (within 2000 chars before the shortcode)
      const contextBefore = content.substring(Math.max(0, position - 2000), position);

      // Find the closest product URL before the shortcode
      const urlMatches = [...contextBefore.matchAll(/href="([^"]*\/product\/[^"]+)"/g)];
      const nearbyProductUrl = urlMatches.length > 0 ? urlMatches[urlMatches.length - 1][1] : null;
      const nearbyProductSlug = nearbyProductUrl ? extractSlugFromUrl(nearbyProductUrl) : null;

      // Look for image caption near the shortcode
      const captionMatch = contextBefore.match(/<figcaption[^>]*>([^<]+)<\/figcaption>\s*$/);
      const nearbyImageCaption = captionMatch ? captionMatch[1].trim() : null;

      // Try to find matching product
      let newProductId: number | null = null;
      let newProductName: string | null = null;
      let matchConfidence = 0;
      let matchMethod = 'no_match';

      if (nearbyProductSlug) {
        const result = this.findProductBySlug(nearbyProductSlug);
        if (result.product) {
          newProductId = result.product.id;
          newProductName = result.product.name;
          matchConfidence = result.confidence;
          matchMethod = result.method;
        }
      }

      matches.push({
        postId,
        postTitle,
        shortcodeType,
        oldId,
        nearbyProductUrl,
        nearbyProductSlug,
        nearbyImageCaption,
        newProductId,
        newProductName,
        matchConfidence,
        matchMethod,
        position,
      });
    }

    return matches;
  }

  /**
   * Find all posts with shortcodes and extract matches
   */
  async findAllShortcodes(postId?: number): Promise<ShortcodeMatch[]> {
    let query = `
      SELECT ID, post_title, post_content, post_type
      FROM wp_posts
      WHERE (post_content LIKE '%[add_to_cart%' OR post_content LIKE '%[product id=%')
        AND post_status = 'publish'
        AND post_type IN ('post', 'page', 'wp_block')
    `;

    const params: any[] = [];
    if (postId) {
      query += ' AND ID = ?';
      params.push(postId);
    }

    const [rows] = await this.connection.execute(query, params);
    const posts = rows as { ID: number; post_title: string; post_content: string }[];

    console.log(`\nFound ${posts.length} posts with shortcodes\n`);

    const allMatches: ShortcodeMatch[] = [];

    for (const post of posts) {
      const matches = this.extractShortcodesWithContext(post.post_content, post.ID, post.post_title);
      allMatches.push(...matches);
    }

    return allMatches;
  }

  /**
   * Apply changes to database
   */
  async applyChanges(
    matches: ShortcodeMatch[],
    minConfidence: number,
    updateUrls: boolean
  ): Promise<{ updated: number; urlsUpdated: number; skipped: number; changelog: any[] }> {
    let updated = 0;
    let urlsUpdated = 0;
    let skipped = 0;
    const changelog: any[] = [];

    // Group by post
    const byPost = new Map<number, ShortcodeMatch[]>();
    for (const match of matches) {
      if (!byPost.has(match.postId)) {
        byPost.set(match.postId, []);
      }
      byPost.get(match.postId)!.push(match);
    }

    for (const [postId, postMatches] of byPost) {
      // Get current content
      const [rows] = await this.connection.execute(
        'SELECT post_content, post_title FROM wp_posts WHERE ID = ?',
        [postId]
      );

      let content = (rows as any[])[0]?.post_content;
      const postTitle = (rows as any[])[0]?.post_title;
      if (!content) continue;

      let contentModified = false;

      for (const match of postMatches) {
        // Update if confidence meets threshold
        if (match.matchConfidence >= minConfidence && match.newProductId) {
          // Old shortcode (could be [product id="..."] or [add_to_cart id="..."])
          const oldShortcode = `[${match.shortcodeType} id="${match.oldId}"]`;
          // Always use add_to_cart format for new shortcode
          const newShortcode = `[add_to_cart id="${match.newProductId}"]`;

          if (content.includes(oldShortcode)) {
            content = content.replace(oldShortcode, newShortcode);
            contentModified = true;
            updated++;

            // Get new product info for URL
            const newProduct = [...this.productsBySlug.values()].find(p => p.id === match.newProductId);
            const newUrl = newProduct ? `/product/${newProduct.slug}/` : null;

            // Record change
            const changeRecord = {
              postId,
              postTitle,
              oldShortcode,
              newShortcode,
              oldUrl: match.nearbyProductUrl,
              newUrl,
              oldProductSlug: match.nearbyProductSlug,
              newProductSlug: newProduct?.slug,
              newProductName: match.newProductName,
              confidence: match.matchConfidence,
              method: match.matchMethod,
            };
            changelog.push(changeRecord);

            console.log(`  ✓ ${oldShortcode} → ${newShortcode} (${match.matchConfidence}%)`);

            // Also update the product URL if requested
            if (updateUrls && match.nearbyProductUrl && newUrl && match.nearbyProductUrl !== newUrl) {
              if (content.includes(match.nearbyProductUrl)) {
                content = content.split(match.nearbyProductUrl).join(newUrl);
                urlsUpdated++;
                console.log(`    URL: ${match.nearbyProductUrl} → ${newUrl}`);
              }
            }
          }
        } else {
          skipped++;
        }
      }

      if (contentModified) {
        await this.connection.execute(
          'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
          [content, postId]
        );
        console.log(`  → Saved post ${postId}: ${postTitle}\n`);
      }
    }

    return { updated, urlsUpdated, skipped, changelog };
  }

  // Expose productsBySlug for URL updates
  get products_by_slug() {
    return this.productsBySlug;
  }
}

async function main() {
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Fix Product Shortcodes Script         ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log(`Mode: ${options.apply ? 'APPLY CHANGES' : 'DRY RUN (report only)'}`);
  console.log(`Min Confidence: ${options.minConfidence}%`);
  console.log(`Update URLs: ${options.updateUrls}\n`);

  const connection = await createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: 'root',
    password: 'root',
    database: 'local',
  });

  console.log('✓ Connected to database\n');

  const fixer = new ShortcodeFixer(connection);
  await fixer.loadProducts();

  const matches = await fixer.findAllShortcodes(options.postId);

  console.log(`Found ${matches.length} shortcodes to process\n`);

  // Generate report
  const report = {
    timestamp: new Date().toISOString(),
    totalShortcodes: matches.length,
    matched100: matches.filter(m => m.matchConfidence === 100).length,
    matched90plus: matches.filter(m => m.matchConfidence >= 90 && m.matchConfidence < 100).length,
    matched80plus: matches.filter(m => m.matchConfidence >= 80 && m.matchConfidence < 90).length,
    noMatch: matches.filter(m => m.matchConfidence === 0).length,
    matches: matches.map(m => ({
      postId: m.postId,
      postTitle: m.postTitle,
      shortcode: `[${m.shortcodeType} id="${m.oldId}"]`,
      nearbyUrl: m.nearbyProductUrl,
      nearbySlug: m.nearbyProductSlug,
      imageCaption: m.nearbyImageCaption,
      newId: m.newProductId,
      newName: m.newProductName,
      confidence: m.matchConfidence,
      method: m.matchMethod,
    })),
  };

  // Print summary by confidence level
  console.log('=== MATCH SUMMARY ===');
  console.log(`100% matches (will update): ${report.matched100}`);
  console.log(`90-99% matches (review): ${report.matched90plus}`);
  console.log(`80-89% matches (review): ${report.matched80plus}`);
  console.log(`No match found: ${report.noMatch}`);
  console.log();

  // Show samples
  console.log('=== SAMPLE MATCHES ===\n');

  const samples = matches.slice(0, 10);
  for (const m of samples) {
    console.log(`Post: ${m.postTitle} (ID: ${m.postId})`);
    console.log(`  Old: [${m.shortcodeType} id="${m.oldId}"]`);
    console.log(`  URL: ${m.nearbyProductUrl || 'none found'}`);
    console.log(`  Slug: ${m.nearbyProductSlug || 'none'}`);
    if (m.nearbyImageCaption) {
      console.log(`  Caption: ${m.nearbyImageCaption}`);
    }
    if (m.newProductId) {
      console.log(`  → New ID: ${m.newProductId} (${m.newProductName})`);
      console.log(`  → Confidence: ${m.matchConfidence}% (${m.matchMethod})`);
    } else {
      console.log(`  → NO MATCH FOUND`);
    }
    console.log();
  }

  // Save full report
  const reportPath = join(process.cwd(), 'data', 'shortcode-mapping-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Full report saved to: ${reportPath}`);

  // Apply changes if requested
  if (options.apply) {
    console.log('\n=== APPLYING CHANGES ===\n');
    const { updated, urlsUpdated, skipped, changelog } = await fixer.applyChanges(
      matches,
      options.minConfidence,
      options.updateUrls
    );
    console.log(`\nShortcodes updated: ${updated}`);
    console.log(`URLs updated: ${urlsUpdated}`);
    console.log(`Skipped: ${skipped} (confidence < ${options.minConfidence}%)`);

    // Save changelog
    const changelogPath = join(process.cwd(), 'data', 'shortcode-changelog.json');
    const changelogData = {
      timestamp: new Date().toISOString(),
      minConfidence: options.minConfidence,
      updateUrls: options.updateUrls,
      totalUpdated: updated,
      urlsUpdated,
      skipped,
      changes: changelog,
    };
    writeFileSync(changelogPath, JSON.stringify(changelogData, null, 2));
    console.log(`\nChangelog saved to: ${changelogPath}`);

    // Also save as CSV for easy review
    const csvPath = join(process.cwd(), 'data', 'shortcode-changelog.csv');
    const csvHeader = 'Post ID,Post Title,Old Shortcode,New Shortcode,Old URL,New URL,Confidence,Method\n';
    const csvRows = changelog.map(c =>
      `${c.postId},"${c.postTitle?.replace(/"/g, '""') || ''}","${c.oldShortcode}","${c.newShortcode}","${c.oldUrl || ''}","${c.newUrl || ''}",${c.confidence},${c.method}`
    ).join('\n');
    writeFileSync(csvPath, csvHeader + csvRows);
    console.log(`CSV changelog saved to: ${csvPath}`);
  } else {
    console.log('\nRun with --apply to update the database');
    console.log('Options:');
    console.log('  --min-confidence <n>  Set minimum confidence (default: 100)');
    console.log('  --update-urls         Also update product URLs in content');
  }

  await connection.end();
  console.log('\n✓ Done');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
