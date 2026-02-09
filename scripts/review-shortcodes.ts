#!/usr/bin/env bun

/**
 * Manual Review Shortcodes Script
 *
 * Interactive review process for lower-confidence shortcode matches.
 * Generates a review file that can be executed to apply approved changes.
 *
 * Usage:
 *   bun scripts/review-shortcodes.ts [options]
 *
 * Options:
 *   --dry-run           Generate review report without prompts (default)
 *   --review            Interactive review mode
 *   --execute           Apply approved changes from review file
 *   --min-confidence    Minimum confidence to include (default: 0)
 *   --max-confidence    Maximum confidence to include (default: 89)
 *   --update-urls       Also update product URLs when executing
 */

import { createConnection, Connection } from 'mysql2/promise';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';

const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';

const REVIEW_FILE_PATH = join(process.cwd(), 'data', 'shortcode-review.json');
const REVIEW_REPORT_PATH = join(process.cwd(), 'data', 'shortcode-review-report.md');
const NEEDS_FIXING_PATH = join(process.cwd(), 'data', 'shortcode-needs-fixing.json');

interface ShortcodeMatch {
  postId: number;
  postTitle: string;
  postSlug: string;
  postType: string;
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

interface ReviewDecision {
  postId: number;
  postTitle: string;
  postUrl: string;           // URL to the WP post/page
  oldShortcode: string;
  newShortcode: string | null;
  oldId: string;
  oldUrl: string | null;     // Nearby product URL in content
  newUrl: string | null;
  nearbySlug: string | null;
  approvedProductId: number | null;
  approvedProductName: string | null;
  approvedProductSlug: string | null;
  originalConfidence: number;
  decision: 'approved' | 'rejected' | 'manual' | 'pending';
  reviewedAt: string | null;
  notes: string | null;
}

interface ReviewFile {
  createdAt: string;
  lastUpdatedAt: string;
  totalItems: number;
  reviewed: number;
  approved: number;
  rejected: number;
  pending: number;
  items: ReviewDecision[];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const getArgValue = (flag: string, defaultVal: number) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? parseInt(args[idx + 1], 10) : defaultVal;
  };

  return {
    dryRun: !args.includes('--review') && !args.includes('--execute'),
    review: args.includes('--review'),
    execute: args.includes('--execute'),
    minConfidence: getArgValue('--min-confidence', 0),
    maxConfidence: getArgValue('--max-confidence', 89),
    updateUrls: args.includes('--update-urls'),
    orphanedOnly: args.includes('--orphaned'),
  };
}

function extractSlugFromUrl(url: string): string | null {
  const match = url.match(/\/product\/([^\/\?"]+)/);
  return match ? match[1] : null;
}

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

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function buildPostUrl(postType: string, postSlug: string, postId: number): string {
  // Return WP admin edit URL for easy access
  const wpAdminUrl = 'http://maleq-local.local/wp-admin/post.php';
  return `${wpAdminUrl}?post=${postId}&action=edit`;
}

interface NeedsFixingItem {
  postId: number;
  postTitle: string;
  postUrl: string;           // URL to the WP post where shortcode exists
  oldShortcode: string;      // The shortcode itself: [add_to_cart id="XXX"]
  productUrl: string | null; // The nearby product link (e.g., /product/slug/)
  nearbySlug: string | null; // Extracted slug from productUrl
  rejectedAt: string;
  reason: string;
}

interface NeedsFixingFile {
  items: NeedsFixingItem[];
  rejectedSlugs: string[];  // Slugs to skip in future runs
}

class ShortcodeReviewer {
  private connection: Connection;
  private products: ProductLookup[] = [];
  private productsById: Map<number, ProductLookup> = new Map();
  private productsBySlug: Map<string, ProductLookup> = new Map();
  private productsByNormalizedName: Map<string, ProductLookup[]> = new Map();
  private rl: readline.Interface | null = null;
  private needsFixing: NeedsFixingFile = { items: [], rejectedSlugs: [] };

  constructor(connection: Connection) {
    this.connection = connection;
    this.loadNeedsFixing();
  }

  private loadNeedsFixing(): void {
    if (existsSync(NEEDS_FIXING_PATH)) {
      try {
        this.needsFixing = JSON.parse(readFileSync(NEEDS_FIXING_PATH, 'utf-8'));
        console.log(`Loaded ${this.needsFixing.rejectedSlugs.length} previously rejected slugs\n`);
      } catch (e) {
        this.needsFixing = { items: [], rejectedSlugs: [] };
      }
    }
  }

  private saveNeedsFixing(): void {
    writeFileSync(NEEDS_FIXING_PATH, JSON.stringify(this.needsFixing, null, 2));
  }

  addToNeedsFixing(item: NeedsFixingItem): void {
    this.needsFixing.items.push(item);
    if (item.nearbySlug && !this.needsFixing.rejectedSlugs.includes(item.nearbySlug)) {
      this.needsFixing.rejectedSlugs.push(item.nearbySlug);
    }
    this.saveNeedsFixing();
  }

  isSlugRejected(slug: string | null): boolean {
    if (!slug) return false;
    return this.needsFixing.rejectedSlugs.includes(slug);
  }

  getProductById(id: number): ProductLookup | undefined {
    return this.productsById.get(id);
  }

  async loadProducts(): Promise<void> {
    console.log('Loading products and variations from database...');

    const [rows] = await this.connection.execute(`
      SELECT
        p.ID as id,
        p.post_title as name,
        p.post_name as slug,
        COALESCE(pm.meta_value, '') as sku,
        COALESCE(t.slug, CASE WHEN p.post_type = 'product_variation' THEN 'variation' ELSE 'simple' END) as type
      FROM wp_posts p
      LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key = '_sku'
      LEFT JOIN wp_term_relationships tr ON p.ID = tr.object_id
      LEFT JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id AND tt.taxonomy = 'product_type'
      LEFT JOIN wp_terms t ON tt.term_id = t.term_id
      WHERE p.post_type IN ('product', 'product_variation')
        AND p.post_status = 'publish'
    `);

    this.products = rows as ProductLookup[];
    console.log(`  Found ${this.products.length} products/variations, building index...`);

    for (const product of this.products) {
      this.productsById.set(product.id, product);
      this.productsBySlug.set(product.slug.toLowerCase(), product);

      const normalized = normalizeForComparison(product.name);
      if (!this.productsByNormalizedName.has(normalized)) {
        this.productsByNormalizedName.set(normalized, []);
      }
      this.productsByNormalizedName.get(normalized)!.push(product);
    }

    console.log(`✓ Loaded ${this.products.length} products/variations\n`);
  }

  findProductBySlug(slug: string): { product: ProductLookup | null; confidence: number; method: string } {
    const normalizedSlug = slug.toLowerCase();

    // 1. Exact match
    if (this.productsBySlug.has(normalizedSlug)) {
      return {
        product: this.productsBySlug.get(normalizedSlug)!,
        confidence: 100,
        method: 'exact_slug'
      };
    }

    // Common color/size suffixes to strip for matching
    const colorSuffixes = [
      'red', 'blue', 'black', 'white', 'pink', 'purple', 'green', 'yellow', 'orange',
      'clear', 'smoke', 'grey', 'gray', 'brown', 'gold', 'silver', 'red-velvet',
      'periwinkle', 'vanilla', 'chocolate', 'flesh', 'nude', 'natural', 'teal',
      'violet', 'lavender', 'coral', 'aqua', 'navy', 'midnight', 'ice', 'frost'
    ];
    const sizeSuffixes = [
      'small', 'medium', 'large', 'xl', 'xxl', 'xs', 'sm', 'md', 'lg',
      '1-oz', '2-oz', '4-oz', '8-oz', '16-oz', 'oz', 'ml', 'pack', 'count', 'net'
    ];
    const variantWords = ['select', 'deluxe', 'premium', 'pro', 'plus', 'mini', 'max', 'ultra'];

    // Function to strip suffixes and variant words
    const stripVariants = (s: string): string => {
      let result = s;
      // Remove trailing color suffixes
      for (const color of colorSuffixes) {
        result = result.replace(new RegExp(`-${color}$`, 'i'), '');
      }
      // Remove trailing size suffixes
      for (const size of sizeSuffixes) {
        result = result.replace(new RegExp(`-${size}$`, 'i'), '');
      }
      // Remove variant words from anywhere
      for (const word of variantWords) {
        result = result.replace(new RegExp(`-${word}-`, 'gi'), '-');
        result = result.replace(new RegExp(`-${word}$`, 'gi'), '');
        result = result.replace(new RegExp(`^${word}-`, 'gi'), '');
      }
      // Remove trailing numbers (like model numbers)
      result = result.replace(/-\d+$/, '');
      // Clean up double dashes
      result = result.replace(/--+/g, '-').replace(/^-|-$/g, '');
      return result;
    };

    // 2. Try simple variations
    const simpleVariations = [
      normalizedSlug.replace(/-\d+(-oz|-ml|-pack|-count)?$/, ''),
      normalizedSlug.replace(/^(the-|a-|an-)/, ''),
      normalizedSlug.replace(/-net$/, ''),
    ];

    for (const variant of simpleVariations) {
      if (this.productsBySlug.has(variant)) {
        return {
          product: this.productsBySlug.get(variant)!,
          confidence: 95,
          method: 'slug_variant'
        };
      }
    }

    // 3. Try matching with color/variant stripped from both sides
    const strippedSlug = stripVariants(normalizedSlug);

    for (const [productSlug, product] of this.productsBySlug) {
      const strippedProductSlug = stripVariants(productSlug);
      if (strippedSlug === strippedProductSlug) {
        return {
          product,
          confidence: 90,
          method: 'stripped_match'
        };
      }
    }

    // 4. Check if core product words match (ignoring colors/variants)
    const slugWords = normalizedSlug.split('-').filter(w =>
      !colorSuffixes.includes(w) &&
      !sizeSuffixes.includes(w) &&
      !variantWords.includes(w) &&
      w.length > 2
    );

    let bestWordMatch: ProductLookup | null = null;
    let bestWordMatchCount = 0;

    for (const [productSlug, product] of this.productsBySlug) {
      const productWords = productSlug.split('-').filter(w =>
        !colorSuffixes.includes(w) &&
        !sizeSuffixes.includes(w) &&
        !variantWords.includes(w) &&
        w.length > 2
      );

      // Count matching words
      const matchingWords = slugWords.filter(w => productWords.includes(w));
      const matchRatio = matchingWords.length / Math.max(slugWords.length, productWords.length);

      // Require at least 60% word overlap and minimum 3 matching words
      if (matchingWords.length >= 3 && matchRatio > 0.6 && matchingWords.length > bestWordMatchCount) {
        bestWordMatchCount = matchingWords.length;
        bestWordMatch = product;
      }
    }

    if (bestWordMatch && bestWordMatchCount >= 3) {
      return {
        product: bestWordMatch,
        confidence: Math.min(85, 70 + bestWordMatchCount * 3),
        method: 'word_match'
      };
    }

    // 5. Fuzzy similarity matching (lowered threshold to 0.6)
    let bestMatch: ProductLookup | null = null;
    let bestSimilarity = 0;

    for (const [productSlug, product] of this.productsBySlug) {
      // Try similarity on both full slug and stripped versions
      const sim1 = similarity(normalizedSlug, productSlug);
      const sim2 = similarity(strippedSlug, stripVariants(productSlug));
      const sim = Math.max(sim1, sim2);

      if (sim > bestSimilarity && sim >= 0.6) {
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

    return { product: null, confidence: 0, method: 'no_match' };
  }

  searchProducts(query: string): ProductLookup[] {
    const normalized = normalizeForComparison(query);
    const results: { product: ProductLookup; score: number }[] = [];

    for (const product of this.products) {
      const nameNorm = normalizeForComparison(product.name);
      const slugNorm = product.slug.toLowerCase();

      // Exact name contains
      if (nameNorm.includes(normalized)) {
        results.push({ product, score: 100 });
        continue;
      }

      // Slug contains
      if (slugNorm.includes(query.toLowerCase().replace(/\s+/g, '-'))) {
        results.push({ product, score: 90 });
        continue;
      }

      // Fuzzy match
      const sim = Math.max(
        similarity(normalized, nameNorm),
        similarity(query.toLowerCase(), slugNorm)
      );
      if (sim >= 0.6) {
        results.push({ product, score: Math.round(sim * 80) });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(r => r.product);
  }

  extractShortcodesWithContext(
    content: string,
    postId: number,
    postTitle: string,
    postSlug: string,
    postType: string
  ): ShortcodeMatch[] {
    const matches: ShortcodeMatch[] = [];
    const shortcodeRegex = /\[(add_to_cart|product)\s+id="(\d+)"\]/g;
    let match;

    while ((match = shortcodeRegex.exec(content)) !== null) {
      const shortcodeType = match[1] as 'add_to_cart' | 'product';
      const oldId = match[2];
      const position = match.index;

      const contextBefore = content.substring(Math.max(0, position - 2000), position);
      const urlMatches = [...contextBefore.matchAll(/href="([^"]*\/product\/[^"]+)"/g)];
      const nearbyProductUrl = urlMatches.length > 0 ? urlMatches[urlMatches.length - 1][1] : null;
      const nearbyProductSlug = nearbyProductUrl ? extractSlugFromUrl(nearbyProductUrl) : null;

      const captionMatch = contextBefore.match(/<figcaption[^>]*>([^<]+)<\/figcaption>\s*$/);
      const nearbyImageCaption = captionMatch ? captionMatch[1].trim() : null;

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
        postSlug,
        postType,
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

  async findShortcodes(minConfidence: number, maxConfidence: number): Promise<ShortcodeMatch[]> {
    console.log('Querying posts with shortcodes...');
    const [rows] = await this.connection.execute(`
      SELECT ID, post_title, post_name, post_content, post_type
      FROM wp_posts
      WHERE (post_content LIKE '%[add_to_cart%' OR post_content LIKE '%[product id=%')
        AND post_status = 'publish'
        AND post_type IN ('post', 'page', 'wp_block')
    `);

    const posts = rows as { ID: number; post_title: string; post_name: string; post_content: string; post_type: string }[];
    console.log(`  Found ${posts.length} posts, extracting shortcodes...`);
    const allMatches: ShortcodeMatch[] = [];

    for (const post of posts) {
      const matches = this.extractShortcodesWithContext(
        post.post_content,
        post.ID,
        post.post_title,
        post.post_name,
        post.post_type
      );
      for (const match of matches) {
        if (match.matchConfidence >= minConfidence && match.matchConfidence <= maxConfidence) {
          allMatches.push(match);
        }
      }
    }

    console.log(`  Filtered to ${allMatches.length} shortcodes in range ${minConfidence}%-${maxConfidence}%`);
    return allMatches;
  }

  async findOrphanedShortcodes(): Promise<ShortcodeMatch[]> {
    console.log('Finding orphaned shortcodes (IDs not in products database)...');

    // Get all valid product IDs
    const [products] = await this.connection.execute(
      "SELECT ID FROM wp_posts WHERE post_type = 'product' AND post_status = 'publish'"
    );
    const validIds = new Set((products as any[]).map(p => String(p.ID)));
    console.log(`  Found ${validIds.size} valid product IDs`);

    const [rows] = await this.connection.execute(`
      SELECT ID, post_title, post_name, post_content, post_type
      FROM wp_posts
      WHERE (post_content LIKE '%[add_to_cart%' OR post_content LIKE '%[product id=%')
        AND post_status = 'publish'
        AND post_type IN ('post', 'page', 'wp_block')
    `);

    const posts = rows as { ID: number; post_title: string; post_name: string; post_content: string; post_type: string }[];
    console.log(`  Found ${posts.length} posts with shortcodes`);

    const orphanedMatches: ShortcodeMatch[] = [];

    for (const post of posts) {
      const matches = this.extractShortcodesWithContext(
        post.post_content,
        post.ID,
        post.post_title,
        post.post_name,
        post.post_type
      );
      for (const match of matches) {
        // Only include if the current shortcode ID is NOT a valid product
        if (!validIds.has(match.oldId)) {
          orphanedMatches.push(match);
        }
      }
    }

    console.log(`  Found ${orphanedMatches.length} orphaned shortcodes`);
    return orphanedMatches;
  }

  private async prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      if (!this.rl) {
        this.rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
      }

      this.rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  closeReadline(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  async interactiveReview(matches: ShortcodeMatch[]): Promise<ReviewFile> {
    // Load existing review file if it exists
    let reviewFile: ReviewFile;
    if (existsSync(REVIEW_FILE_PATH)) {
      reviewFile = JSON.parse(readFileSync(REVIEW_FILE_PATH, 'utf-8'));
      console.log(`Loaded existing review file with ${reviewFile.items.length} items\n`);
    } else {
      reviewFile = {
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        totalItems: matches.length,
        reviewed: 0,
        approved: 0,
        rejected: 0,
        pending: matches.length,
        items: matches.map(m => {
          const productSlug = m.newProductId
            ? [...this.productsBySlug.values()].find(p => p.id === m.newProductId)?.slug || null
            : null;
          return {
            postId: m.postId,
            postTitle: m.postTitle,
            postUrl: buildPostUrl(m.postType, m.postSlug, m.postId),
            oldShortcode: `[${m.shortcodeType} id="${m.oldId}"]`,
            newShortcode: m.newProductId ? `[add_to_cart id="${m.newProductId}"]` : null,
            oldId: m.oldId,
            oldUrl: m.nearbyProductUrl,
            newUrl: productSlug ? `/product/${productSlug}/` : null,
            nearbySlug: m.nearbyProductSlug,
            approvedProductId: m.newProductId,
            approvedProductName: m.newProductName,
            approvedProductSlug: productSlug,
            originalConfidence: m.matchConfidence,
            decision: 'pending' as const,
            reviewedAt: null,
            notes: null,
          };
        }),
      };
    }

    // Build pattern maps for auto-applying decisions
    // Key: nearbySlug -> approved product mapping
    const approvedPatterns = new Map<string, { productId: number; productName: string; productSlug: string }>();
    const rejectedPatterns = new Set<string>();

    // Load existing patterns from already-reviewed items
    for (const item of reviewFile.items) {
      if (item.nearbySlug) {
        if ((item.decision === 'approved' || item.decision === 'manual') && item.approvedProductId) {
          approvedPatterns.set(item.nearbySlug, {
            productId: item.approvedProductId,
            productName: item.approvedProductName || '',
            productSlug: item.approvedProductSlug || '',
          });
        } else if (item.decision === 'rejected') {
          rejectedPatterns.add(item.nearbySlug);
        }
      }
    }

    const pendingItems = reviewFile.items.filter(item => item.decision === 'pending');

    // First pass: auto-apply known patterns
    let autoApplied = 0;
    for (const item of pendingItems) {
      if (item.nearbySlug) {
        if (approvedPatterns.has(item.nearbySlug)) {
          const pattern = approvedPatterns.get(item.nearbySlug)!;
          item.approvedProductId = pattern.productId;
          item.approvedProductName = pattern.productName;
          item.approvedProductSlug = pattern.productSlug;
          item.newShortcode = `[add_to_cart id="${pattern.productId}"]`;
          item.newUrl = `/product/${pattern.productSlug}/`;
          item.decision = 'approved';
          item.reviewedAt = new Date().toISOString();
          item.notes = 'Auto-applied from pattern';
          reviewFile.approved++;
          reviewFile.pending--;
          reviewFile.reviewed++;
          autoApplied++;
        } else if (rejectedPatterns.has(item.nearbySlug)) {
          item.decision = 'rejected';
          item.approvedProductId = null;
          item.approvedProductName = null;
          item.approvedProductSlug = null;
          item.newShortcode = null;
          item.newUrl = null;
          item.reviewedAt = new Date().toISOString();
          item.notes = 'Auto-rejected from pattern';
          reviewFile.rejected++;
          reviewFile.pending--;
          reviewFile.reviewed++;
          autoApplied++;
        }
      }
    }

    if (autoApplied > 0) {
      console.log(`\n✓ Auto-applied ${autoApplied} items based on previously approved patterns`);
      reviewFile.lastUpdatedAt = new Date().toISOString();
      writeFileSync(REVIEW_FILE_PATH, JSON.stringify(reviewFile, null, 2));
    }

    // Get remaining pending items after auto-apply
    const remainingItems = reviewFile.items.filter(item => item.decision === 'pending');
    console.log(`\n${remainingItems.length} items pending review`);

    if (remainingItems.length === 0) {
      console.log('All items have been reviewed!');
      return reviewFile;
    }

    console.log('');
    console.log('Commands:');
    console.log('  y       = approve suggested match (auto-applies to same slugs)');
    console.log('  n       = reject/discontinued (logs to needs-fixing, skips in future)');
    console.log('  s       = search for different product');
    console.log('  <ID>    = enter product ID directly (e.g., 195685)');
    console.log('  skip    = skip for now');
    console.log('  q       = quit and save progress');
    console.log('');
    console.log('='.repeat(70));

    let reviewed = 0;
    for (const item of remainingItems) {
      // Check if slug was previously rejected (from needs-fixing file)
      if (this.isSlugRejected(item.nearbySlug)) {
        item.decision = 'rejected';
        item.approvedProductId = null;
        item.approvedProductName = null;
        item.approvedProductSlug = null;
        item.newShortcode = null;
        item.newUrl = null;
        item.reviewedAt = new Date().toISOString();
        item.notes = 'Previously rejected (needs-fixing)';
        reviewFile.rejected++;
        reviewFile.pending--;
        reviewFile.reviewed++;
        continue; // Skip silently
      }

      // Check if pattern was approved/rejected in this session
      if (item.nearbySlug) {
        if (approvedPatterns.has(item.nearbySlug)) {
          const pattern = approvedPatterns.get(item.nearbySlug)!;
          item.approvedProductId = pattern.productId;
          item.approvedProductName = pattern.productName;
          item.approvedProductSlug = pattern.productSlug;
          item.newShortcode = `[add_to_cart id="${pattern.productId}"]`;
          item.newUrl = `/product/${pattern.productSlug}/`;
          item.decision = 'approved';
          item.reviewedAt = new Date().toISOString();
          item.notes = 'Auto-applied from pattern';
          reviewFile.approved++;
          reviewFile.pending--;
          reviewFile.reviewed++;
          console.log(`\n  → Auto-approved: ${item.oldShortcode} → ${item.newShortcode}`);
          continue;
        } else if (rejectedPatterns.has(item.nearbySlug)) {
          item.decision = 'rejected';
          item.approvedProductId = null;
          item.approvedProductName = null;
          item.approvedProductSlug = null;
          item.newShortcode = null;
          item.newUrl = null;
          item.reviewedAt = new Date().toISOString();
          item.notes = 'Auto-rejected from pattern';
          reviewFile.rejected++;
          reviewFile.pending--;
          reviewFile.reviewed++;
          console.log(`\n  → Auto-rejected: ${item.nearbySlug}`);
          continue;
        }
      }

      console.log('');
      console.log(`[${reviewed + 1}/${remainingItems.length}] Post: ${item.postTitle} (ID: ${item.postId})`);
      console.log(`  Shortcode: ${item.oldShortcode}`);
      console.log(`  Old URL: ${item.oldUrl || 'none'}`);
      console.log(`  Nearby Slug: ${item.nearbySlug || 'none'}`);

      if (item.approvedProductId) {
        console.log(`\n  Suggested Match (${item.originalConfidence}%):`);
        console.log(`    ID: ${item.approvedProductId}`);
        console.log(`    Name: ${item.approvedProductName}`);
        console.log(`    Slug: ${item.approvedProductSlug}`);
      } else {
        console.log(`\n  No automatic match found`);
      }

      let validDecision = false;
      while (!validDecision) {
        const answer = await this.prompt('\n>>> Decision (y/n/s/<ID>/skip/q): ');

        if (answer.toLowerCase() === 'q') {
          console.log('\nSaving progress and exiting...');
          // Save and exit
          reviewFile.lastUpdatedAt = new Date().toISOString();
          writeFileSync(REVIEW_FILE_PATH, JSON.stringify(reviewFile, null, 2));
          return reviewFile;
        }

        if (answer.toLowerCase() === 'skip') {
          console.log('  → Skipped');
          reviewed++;
          validDecision = true;
          continue;
        }

        if (answer.toLowerCase() === 'y' && item.approvedProductId) {
          item.newShortcode = `[add_to_cart id="${item.approvedProductId}"]`;
          item.newUrl = item.approvedProductSlug ? `/product/${item.approvedProductSlug}/` : null;
          item.decision = 'approved';
          item.reviewedAt = new Date().toISOString();
          reviewFile.approved++;
          reviewFile.pending--;
          reviewFile.reviewed++;
          reviewed++;
          validDecision = true;

          // Save pattern for auto-apply
          if (item.nearbySlug && item.approvedProductSlug) {
            approvedPatterns.set(item.nearbySlug, {
              productId: item.approvedProductId,
              productName: item.approvedProductName || '',
              productSlug: item.approvedProductSlug,
            });

            // Count how many more will be auto-applied
            const moreMatches = remainingItems.filter(
              i => i.decision === 'pending' && i.nearbySlug === item.nearbySlug
            ).length;
            if (moreMatches > 0) {
              console.log(`  → Approved: ${item.oldShortcode} → ${item.newShortcode}`);
              console.log(`    (will auto-apply to ${moreMatches} more with same slug)`);
            } else {
              console.log(`  → Approved: ${item.oldShortcode} → ${item.newShortcode}`);
            }
          } else {
            console.log(`  → Approved: ${item.oldShortcode} → ${item.newShortcode}`);
          }
        } else if (answer.toLowerCase() === 'n') {
          item.decision = 'rejected';
          item.approvedProductId = null;
          item.approvedProductName = null;
          item.approvedProductSlug = null;
          item.newShortcode = null;
          item.newUrl = null;
          item.reviewedAt = new Date().toISOString();
          reviewFile.rejected++;
          reviewFile.pending--;
          reviewFile.reviewed++;
          reviewed++;
          validDecision = true;

          // Log to needs-fixing file
          this.addToNeedsFixing({
            postId: item.postId,
            postTitle: item.postTitle,
            postUrl: item.postUrl,                 // WP admin edit URL
            oldShortcode: item.oldShortcode,       // The shortcode: [add_to_cart id="XXX"]
            productUrl: item.oldUrl,               // The nearby product link
            nearbySlug: item.nearbySlug,
            rejectedAt: new Date().toISOString(),
            reason: 'Product discontinued or not found',
          });

          // Save pattern for auto-reject
          if (item.nearbySlug) {
            rejectedPatterns.add(item.nearbySlug);

            // Count how many more will be auto-rejected
            const moreMatches = remainingItems.filter(
              i => i.decision === 'pending' && i.nearbySlug === item.nearbySlug
            ).length;
            if (moreMatches > 0) {
              console.log(`  → Rejected: ${item.oldShortcode} (logged to needs-fixing)`);
              console.log(`    (will auto-reject ${moreMatches} more with same slug)`);
            } else {
              console.log(`  → Rejected: ${item.oldShortcode} (logged to needs-fixing)`);
            }
          } else {
            console.log(`  → Rejected: ${item.oldShortcode} (logged to needs-fixing)`);
          }
        } else if (/^\d+$/.test(answer)) {
          // User entered a product ID directly
          const productId = parseInt(answer, 10);
          const product = this.getProductById(productId);

          if (product) {
            item.approvedProductId = product.id;
            item.approvedProductName = product.name;
            item.approvedProductSlug = product.slug;
            item.newShortcode = `[add_to_cart id="${product.id}"]`;
            item.newUrl = `/product/${product.slug}/`;
            item.decision = 'manual';
            item.reviewedAt = new Date().toISOString();
            reviewFile.approved++;
            reviewFile.pending--;
            reviewFile.reviewed++;
            reviewed++;
            validDecision = true;

            // Save pattern for auto-apply
            if (item.nearbySlug) {
              approvedPatterns.set(item.nearbySlug, {
                productId: product.id,
                productName: product.name,
                productSlug: product.slug,
              });

              const moreMatches = remainingItems.filter(
                i => i.decision === 'pending' && i.nearbySlug === item.nearbySlug
              ).length;
              if (moreMatches > 0) {
                console.log(`  → ID ${productId}: ${product.name}`);
                console.log(`    ${item.oldShortcode} → ${item.newShortcode}`);
                console.log(`    (will auto-apply to ${moreMatches} more with same slug)`);
              } else {
                console.log(`  → ID ${productId}: ${product.name}`);
                console.log(`    ${item.oldShortcode} → ${item.newShortcode}`);
              }
            } else {
              console.log(`  → ID ${productId}: ${product.name}`);
              console.log(`    ${item.oldShortcode} → ${item.newShortcode}`);
            }
          } else {
            console.log(`  → Product ID ${productId} not found in database. Try again.`);
            // Don't set validDecision, will re-prompt
          }
        } else if (answer.toLowerCase() === 's') {
          const searchQuery = await this.prompt('  Search for product: ');
          const results = this.searchProducts(searchQuery);

          if (results.length === 0) {
            console.log('  No products found. Try a different search term.');
            // Don't set validDecision, will re-prompt
            continue;
          }

          console.log('\n  Search Results:');
          for (let i = 0; i < results.length; i++) {
            console.log(`    ${i + 1}. [${results[i].id}] ${results[i].name}`);
            console.log(`       Slug: ${results[i].slug}`);
          }

          const selection = await this.prompt('\n  Select number (1-10), or press Enter to cancel: ');
          const idx = parseInt(selection, 10) - 1;

          if (idx >= 0 && idx < results.length) {
            const selected = results[idx];
            item.approvedProductId = selected.id;
            item.approvedProductName = selected.name;
            item.approvedProductSlug = selected.slug;
            item.newShortcode = `[add_to_cart id="${selected.id}"]`;
            item.newUrl = `/product/${selected.slug}/`;
            item.decision = 'manual';
            item.reviewedAt = new Date().toISOString();
            reviewFile.approved++;
            reviewFile.pending--;
            reviewFile.reviewed++;
            reviewed++;
            validDecision = true;

            // Save pattern for auto-apply
            if (item.nearbySlug) {
              approvedPatterns.set(item.nearbySlug, {
                productId: selected.id,
                productName: selected.name,
                productSlug: selected.slug,
              });

              const moreMatches = remainingItems.filter(
                i => i.decision === 'pending' && i.nearbySlug === item.nearbySlug
              ).length;
              if (moreMatches > 0) {
                console.log(`  → Manually selected: ${item.oldShortcode} → ${item.newShortcode}`);
                console.log(`    (will auto-apply to ${moreMatches} more with same slug)`);
              } else {
                console.log(`  → Manually selected: ${item.oldShortcode} → ${item.newShortcode}`);
              }
            } else {
              console.log(`  → Manually selected: ${item.oldShortcode} → ${item.newShortcode}`);
            }
          } else {
            console.log('  → Selection cancelled, try again.');
            // Don't set validDecision, will re-prompt
          }
        } else {
          console.log('  → Invalid input. Enter y, n, s, a product ID, skip, or q.');
          // Don't set validDecision, will re-prompt
        }
      } // end while loop

      // Save progress after each review
      reviewFile.lastUpdatedAt = new Date().toISOString();
      writeFileSync(REVIEW_FILE_PATH, JSON.stringify(reviewFile, null, 2));
    }

    return reviewFile;
  }

  async executeApproved(reviewFile: ReviewFile, updateUrls: boolean): Promise<void> {
    const approvedItems = reviewFile.items.filter(
      item => (item.decision === 'approved' || item.decision === 'manual') && item.approvedProductId
    );

    if (approvedItems.length === 0) {
      console.log('No approved items to execute.');
      return;
    }

    console.log(`\nApplying ${approvedItems.length} approved changes...\n`);

    // Group by post
    const byPost = new Map<number, typeof approvedItems>();
    for (const item of approvedItems) {
      if (!byPost.has(item.postId)) {
        byPost.set(item.postId, []);
      }
      byPost.get(item.postId)!.push(item);
    }

    let updated = 0;
    let urlsUpdated = 0;
    const changelog: any[] = [];

    for (const [postId, items] of byPost) {
      const [rows] = await this.connection.execute(
        'SELECT post_content, post_title FROM wp_posts WHERE ID = ?',
        [postId]
      );

      let content = (rows as any[])[0]?.post_content;
      const postTitle = (rows as any[])[0]?.post_title;
      if (!content) continue;

      let contentModified = false;

      for (const item of items) {
        const newShortcode = `[add_to_cart id="${item.approvedProductId}"]`;

        if (content.includes(item.oldShortcode)) {
          content = content.replace(item.oldShortcode, newShortcode);
          contentModified = true;
          updated++;

          const newUrl = item.approvedProductSlug ? `/product/${item.approvedProductSlug}/` : null;

          changelog.push({
            postId,
            postTitle,
            oldShortcode: item.oldShortcode,
            newShortcode,
            oldUrl: item.oldUrl,
            newUrl,
            decision: item.decision,
          });

          console.log(`  ✓ ${item.oldShortcode} → ${newShortcode}`);

          // Update URL if requested
          if (updateUrls && item.oldUrl && newUrl && item.oldUrl !== newUrl) {
            if (content.includes(item.oldUrl)) {
              content = content.split(item.oldUrl).join(newUrl);
              urlsUpdated++;
              console.log(`    URL: ${item.oldUrl} → ${newUrl}`);
            }
          }
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

    console.log(`\nShortcodes updated: ${updated}`);
    console.log(`URLs updated: ${urlsUpdated}`);

    // Save changelog
    const changelogPath = join(process.cwd(), 'data', 'shortcode-review-changelog.json');
    writeFileSync(changelogPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      totalUpdated: updated,
      urlsUpdated,
      changes: changelog,
    }, null, 2));
    console.log(`\nChangelog saved to: ${changelogPath}`);

    // Mark executed items in review file
    for (const item of approvedItems) {
      item.notes = `Executed at ${new Date().toISOString()}`;
    }
    reviewFile.lastUpdatedAt = new Date().toISOString();
    writeFileSync(REVIEW_FILE_PATH, JSON.stringify(reviewFile, null, 2));
  }
}

function generateReport(matches: ShortcodeMatch[]): void {
  const lines: string[] = [];
  lines.push('# Shortcode Review Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');

  const byConfidence = {
    '80-89%': matches.filter(m => m.matchConfidence >= 80 && m.matchConfidence < 90),
    '70-79%': matches.filter(m => m.matchConfidence >= 70 && m.matchConfidence < 80),
    '0% (no match)': matches.filter(m => m.matchConfidence === 0),
  };

  lines.push('| Confidence | Count |');
  lines.push('|------------|-------|');
  for (const [range, items] of Object.entries(byConfidence)) {
    lines.push(`| ${range} | ${items.length} |`);
  }
  lines.push('');

  // List items needing review
  lines.push('## Items Needing Review');
  lines.push('');

  // Group by post
  const byPost = new Map<number, ShortcodeMatch[]>();
  for (const match of matches) {
    if (!byPost.has(match.postId)) {
      byPost.set(match.postId, []);
    }
    byPost.get(match.postId)!.push(match);
  }

  for (const [postId, postMatches] of byPost) {
    const title = postMatches[0].postTitle;
    lines.push(`### Post ${postId}: ${title}`);
    lines.push('');
    lines.push('| Old Shortcode | Nearby Slug | Suggested Match | Confidence |');
    lines.push('|---------------|-------------|-----------------|------------|');

    for (const m of postMatches) {
      const suggested = m.newProductName ? `${m.newProductName} (ID: ${m.newProductId})` : 'No match';
      lines.push(`| \`[${m.shortcodeType} id="${m.oldId}"]\` | ${m.nearbyProductSlug || 'none'} | ${suggested} | ${m.matchConfidence}% |`);
    }
    lines.push('');
  }

  writeFileSync(REVIEW_REPORT_PATH, lines.join('\n'));
  console.log(`\nReport saved to: ${REVIEW_REPORT_PATH}`);
}

async function main() {
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Manual Shortcode Review Script        ║');
  console.log('╚════════════════════════════════════════╝\n');

  if (options.dryRun) {
    console.log('Mode: DRY RUN (generate report only)');
  } else if (options.review) {
    console.log('Mode: INTERACTIVE REVIEW');
  } else if (options.execute) {
    console.log('Mode: EXECUTE APPROVED CHANGES');
  }
  console.log(`Confidence range: ${options.minConfidence}% - ${options.maxConfidence}%\n`);

  const connection = await createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: 'root',
    password: 'root',
    database: 'local',
  });

  console.log('✓ Connected to database\n');

  const reviewer = new ShortcodeReviewer(connection);

  try {
    await reviewer.loadProducts();

    if (options.execute) {
      // Execute mode - apply approved changes from review file
      if (!existsSync(REVIEW_FILE_PATH)) {
        console.log('No review file found. Run with --review first.');
        return;
      }

      const reviewFile: ReviewFile = JSON.parse(readFileSync(REVIEW_FILE_PATH, 'utf-8'));
      console.log(`Review file: ${reviewFile.approved} approved, ${reviewFile.rejected} rejected, ${reviewFile.pending} pending\n`);

      await reviewer.executeApproved(reviewFile, options.updateUrls);

    } else if (options.review) {
      // Interactive review mode
      console.log('Starting interactive review mode...\n');
      const matches = options.orphanedOnly
        ? await reviewer.findOrphanedShortcodes()
        : await reviewer.findShortcodes(options.minConfidence, options.maxConfidence);
      console.log(`\nFound ${matches.length} shortcodes to review`);

      if (matches.length === 0) {
        console.log('No shortcodes in specified confidence range.');
        return;
      }

      console.log('Initializing review interface...\n');
      const reviewFile = await reviewer.interactiveReview(matches);

      // Save CSV summary of approved items
      const csvPath = join(process.cwd(), 'data', 'shortcode-review-approved.csv');
      const approvedItems = reviewFile.items.filter(i => i.decision === 'approved' || i.decision === 'manual');
      if (approvedItems.length > 0) {
        const csvHeader = 'Post ID,Post Title,Old Shortcode,New Shortcode,Old URL,New URL,Decision\n';
        const csvRows = approvedItems.map(i =>
          `${i.postId},"${(i.postTitle || '').replace(/"/g, '""')}","${i.oldShortcode}","${i.newShortcode || ''}","${i.oldUrl || ''}","${i.newUrl || ''}",${i.decision}`
        ).join('\n');
        writeFileSync(csvPath, csvHeader + csvRows);
        console.log(`\nCSV of approved items saved to: ${csvPath}`);
      }

      console.log(`\nReview progress saved to: ${REVIEW_FILE_PATH}`);
      console.log(`  Approved: ${reviewFile.approved}`);
      console.log(`  Rejected: ${reviewFile.rejected}`);
      console.log(`  Pending: ${reviewFile.pending}`);
      console.log('\nRun with --execute --update-urls to apply approved changes.');

    } else {
      // Dry run - just generate report
      const matches = options.orphanedOnly
        ? await reviewer.findOrphanedShortcodes()
        : await reviewer.findShortcodes(options.minConfidence, options.maxConfidence);
      const rangeDesc = options.orphanedOnly
        ? 'orphaned (ID not in products)'
        : `confidence range ${options.minConfidence}%-${options.maxConfidence}%`;
      console.log(`Found ${matches.length} shortcodes (${rangeDesc})\n`);

      generateReport(matches);

      console.log('\nTo start interactive review, run:');
      console.log(`  bun scripts/review-shortcodes.ts --review --min-confidence ${options.minConfidence} --max-confidence ${options.maxConfidence}`);
    }

  } finally {
    reviewer.closeReadline();
    await connection.end();
    console.log('\n✓ Done');
  }
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
