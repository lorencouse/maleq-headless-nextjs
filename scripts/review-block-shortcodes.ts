#!/usr/bin/env bun

/**
 * Review Reusable Block Shortcodes
 *
 * Interactive review for reusable blocks with broken shortcodes (missing products).
 * Similar to review-shortcodes.ts but specifically for wp_block post types.
 *
 * Usage:
 *   bun scripts/review-block-shortcodes.ts --review     # Interactive review
 *   bun scripts/review-block-shortcodes.ts --execute    # Apply approved changes
 */

import { createConnection, Connection } from 'mysql2/promise';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';

const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const REVIEW_FILE_PATH = join(process.cwd(), 'data', 'block-shortcode-review.json');

interface ProductLookup {
  id: number;
  name: string;
  slug: string;
}

interface BlockShortcode {
  blockId: number;
  blockTitle: string;
  oldShortcodeId: string;
  oldShortcode: string;
  suggestedProductId: number | null;
  suggestedProductName: string | null;
  suggestedProductSlug: string | null;
  matchConfidence: number;
}

interface ReviewDecision {
  blockId: number;
  blockTitle: string;
  oldShortcode: string;
  oldShortcodeId: string;
  newShortcode: string | null;
  approvedProductId: number | null;
  approvedProductName: string | null;
  approvedProductSlug: string | null;
  decision: 'approved' | 'rejected' | 'manual' | 'pending';
  reviewedAt: string | null;
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
  return {
    review: args.includes('--review'),
    execute: args.includes('--execute'),
    dryRun: !args.includes('--review') && !args.includes('--execute'),
  };
}

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function similarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1.0;

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

  const editDistance = costs[s2.length];
  return (longer.length - editDistance) / longer.length;
}

class BlockShortcodeReviewer {
  private connection: Connection;
  private products: ProductLookup[] = [];
  private productsById: Map<number, ProductLookup> = new Map();
  private productsBySlug: Map<string, ProductLookup> = new Map();
  private rl: readline.Interface | null = null;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async loadProducts(): Promise<void> {
    console.log('Loading products from database...');

    const [rows] = await this.connection.execute(`
      SELECT p.ID as id, p.post_title as name, p.post_name as slug
      FROM wp_posts p
      WHERE p.post_type = 'product'
        AND p.post_status = 'publish'
    `);

    this.products = rows as ProductLookup[];

    for (const product of this.products) {
      this.productsById.set(product.id, product);
      this.productsBySlug.set(product.slug.toLowerCase(), product);
    }

    console.log(`✓ Loaded ${this.products.length} products\n`);
  }

  getProductById(id: number): ProductLookup | undefined {
    return this.productsById.get(id);
  }

  findProductByName(blockTitle: string): { product: ProductLookup | null; confidence: number } {
    const normalized = normalizeForComparison(blockTitle);

    // Try exact match on slug
    const slugified = blockTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (this.productsBySlug.has(slugified)) {
      return { product: this.productsBySlug.get(slugified)!, confidence: 100 };
    }

    // Try fuzzy match on name
    let bestMatch: ProductLookup | null = null;
    let bestSimilarity = 0;

    for (const product of this.products) {
      const productNorm = normalizeForComparison(product.name);
      const sim = similarity(normalized, productNorm);

      if (sim > bestSimilarity && sim >= 0.6) {
        bestSimilarity = sim;
        bestMatch = product;
      }
    }

    if (bestMatch) {
      return { product: bestMatch, confidence: Math.round(bestSimilarity * 100) };
    }

    return { product: null, confidence: 0 };
  }

  searchProducts(query: string): ProductLookup[] {
    const normalized = normalizeForComparison(query);
    const results: { product: ProductLookup; score: number }[] = [];

    for (const product of this.products) {
      const nameNorm = normalizeForComparison(product.name);
      const slugNorm = product.slug.toLowerCase();

      if (nameNorm.includes(normalized)) {
        results.push({ product, score: 100 });
        continue;
      }

      if (slugNorm.includes(query.toLowerCase().replace(/\s+/g, '-'))) {
        results.push({ product, score: 90 });
        continue;
      }

      const sim = Math.max(
        similarity(normalized, nameNorm),
        similarity(query.toLowerCase(), slugNorm)
      );
      if (sim >= 0.5) {
        results.push({ product, score: Math.round(sim * 80) });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(r => r.product);
  }

  async findBrokenBlockShortcodes(): Promise<BlockShortcode[]> {
    console.log('Finding reusable blocks with broken shortcodes...');

    // Get all valid product IDs
    const [products] = await this.connection.execute(
      "SELECT ID FROM wp_posts WHERE post_type IN ('product', 'product_variation') AND post_status = 'publish'"
    );
    const validIds = new Set((products as any[]).map(p => String(p.ID)));

    // Get all reusable blocks with shortcodes
    const [rows] = await this.connection.execute(`
      SELECT ID as id, post_title as title, post_content as content
      FROM wp_posts
      WHERE post_type = 'wp_block'
        AND post_status = 'publish'
        AND post_content LIKE '%[add_to_cart%'
    `);

    const blocks = rows as { id: number; title: string; content: string }[];
    const brokenShortcodes: BlockShortcode[] = [];

    for (const block of blocks) {
      const regex = /\[add_to_cart\s+id="(\d+)"\]/g;
      let match;

      while ((match = regex.exec(block.content)) !== null) {
        const shortcodeId = match[1];

        // Only include if the ID is NOT valid (broken)
        if (!validIds.has(shortcodeId)) {
          const { product, confidence } = this.findProductByName(block.title);

          brokenShortcodes.push({
            blockId: block.id,
            blockTitle: block.title,
            oldShortcodeId: shortcodeId,
            oldShortcode: match[0],
            suggestedProductId: product?.id || null,
            suggestedProductName: product?.name || null,
            suggestedProductSlug: product?.slug || null,
            matchConfidence: confidence,
          });
        }
      }
    }

    console.log(`Found ${brokenShortcodes.length} broken shortcodes in reusable blocks\n`);
    return brokenShortcodes;
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

  async interactiveReview(shortcodes: BlockShortcode[]): Promise<ReviewFile> {
    let reviewFile: ReviewFile;

    if (existsSync(REVIEW_FILE_PATH)) {
      reviewFile = JSON.parse(readFileSync(REVIEW_FILE_PATH, 'utf-8'));
      console.log(`Loaded existing review file with ${reviewFile.items.length} items\n`);
    } else {
      reviewFile = {
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        totalItems: shortcodes.length,
        reviewed: 0,
        approved: 0,
        rejected: 0,
        pending: shortcodes.length,
        items: shortcodes.map(s => ({
          blockId: s.blockId,
          blockTitle: s.blockTitle,
          oldShortcode: s.oldShortcode,
          oldShortcodeId: s.oldShortcodeId,
          newShortcode: s.suggestedProductId ? `[add_to_cart id="${s.suggestedProductId}"]` : null,
          approvedProductId: s.suggestedProductId,
          approvedProductName: s.suggestedProductName,
          approvedProductSlug: s.suggestedProductSlug,
          decision: 'pending' as const,
          reviewedAt: null,
        })),
      };
    }

    const pendingItems = reviewFile.items.filter(item => item.decision === 'pending');

    if (pendingItems.length === 0) {
      console.log('All items have been reviewed!');
      return reviewFile;
    }

    console.log(`${pendingItems.length} items pending review\n`);
    console.log('Commands:');
    console.log('  y       = approve suggested match');
    console.log('  n       = reject (remove shortcode)');
    console.log('  s       = search for different product');
    console.log('  <ID>    = enter product ID directly');
    console.log('  skip    = skip for now');
    console.log('  q       = quit and save progress');
    console.log('');
    console.log('='.repeat(70));

    let reviewed = 0;
    for (const item of pendingItems) {
      console.log('');
      console.log(`[${reviewed + 1}/${pendingItems.length}] Block: ${item.blockTitle} (ID: ${item.blockId})`);
      console.log(`  Shortcode: ${item.oldShortcode}`);

      if (item.approvedProductId) {
        console.log(`\n  Suggested Match:`);
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
          item.decision = 'approved';
          item.reviewedAt = new Date().toISOString();
          reviewFile.approved++;
          reviewFile.pending--;
          reviewFile.reviewed++;
          reviewed++;
          validDecision = true;
          console.log(`  → Approved: ${item.oldShortcode} → ${item.newShortcode}`);

        } else if (answer.toLowerCase() === 'n') {
          item.decision = 'rejected';
          item.approvedProductId = null;
          item.approvedProductName = null;
          item.approvedProductSlug = null;
          item.newShortcode = null;
          item.reviewedAt = new Date().toISOString();
          reviewFile.rejected++;
          reviewFile.pending--;
          reviewFile.reviewed++;
          reviewed++;
          validDecision = true;
          console.log(`  → Rejected: shortcode will be removed`);

        } else if (/^\d+$/.test(answer)) {
          const productId = parseInt(answer, 10);
          const product = this.getProductById(productId);

          if (product) {
            item.approvedProductId = product.id;
            item.approvedProductName = product.name;
            item.approvedProductSlug = product.slug;
            item.newShortcode = `[add_to_cart id="${product.id}"]`;
            item.decision = 'manual';
            item.reviewedAt = new Date().toISOString();
            reviewFile.approved++;
            reviewFile.pending--;
            reviewFile.reviewed++;
            reviewed++;
            validDecision = true;
            console.log(`  → Manual: ${product.name}`);
            console.log(`    ${item.oldShortcode} → ${item.newShortcode}`);
          } else {
            console.log(`  → Product ID ${productId} not found. Try again.`);
          }

        } else if (answer.toLowerCase() === 's') {
          const searchQuery = await this.prompt('  Search for product: ');
          const results = this.searchProducts(searchQuery);

          if (results.length === 0) {
            console.log('  No products found. Try a different search term.');
            continue;
          }

          console.log('\n  Search Results:');
          for (let i = 0; i < results.length; i++) {
            console.log(`    ${i + 1}. [${results[i].id}] ${results[i].name}`);
          }

          const selection = await this.prompt('\n  Select number (1-10), or press Enter to cancel: ');
          const idx = parseInt(selection, 10) - 1;

          if (idx >= 0 && idx < results.length) {
            const selected = results[idx];
            item.approvedProductId = selected.id;
            item.approvedProductName = selected.name;
            item.approvedProductSlug = selected.slug;
            item.newShortcode = `[add_to_cart id="${selected.id}"]`;
            item.decision = 'manual';
            item.reviewedAt = new Date().toISOString();
            reviewFile.approved++;
            reviewFile.pending--;
            reviewFile.reviewed++;
            reviewed++;
            validDecision = true;
            console.log(`  → Selected: ${item.oldShortcode} → ${item.newShortcode}`);
          } else {
            console.log('  → Selection cancelled, try again.');
          }

        } else if (answer.toLowerCase() === 'y' && !item.approvedProductId) {
          console.log('  → No suggested match to approve. Use "s" to search or enter an ID.');
        } else {
          console.log('  → Invalid input. Enter y, n, s, a product ID, skip, or q.');
        }
      }

      // Save progress after each review
      reviewFile.lastUpdatedAt = new Date().toISOString();
      writeFileSync(REVIEW_FILE_PATH, JSON.stringify(reviewFile, null, 2));
    }

    return reviewFile;
  }

  async executeApproved(reviewFile: ReviewFile): Promise<void> {
    const approvedItems = reviewFile.items.filter(
      item => (item.decision === 'approved' || item.decision === 'manual') && item.approvedProductId
    );
    const rejectedItems = reviewFile.items.filter(item => item.decision === 'rejected');

    console.log(`Approved items to update: ${approvedItems.length}`);
    console.log(`Rejected items (remove shortcode): ${rejectedItems.length}\n`);

    if (approvedItems.length === 0 && rejectedItems.length === 0) {
      console.log('No items to process.');
      return;
    }

    // Group by block
    const byBlock = new Map<number, typeof reviewFile.items>();
    for (const item of [...approvedItems, ...rejectedItems]) {
      if (!byBlock.has(item.blockId)) {
        byBlock.set(item.blockId, []);
      }
      byBlock.get(item.blockId)!.push(item);
    }

    let updated = 0;
    let removed = 0;

    for (const [blockId, items] of byBlock) {
      const [rows] = await this.connection.execute(
        'SELECT post_content, post_title FROM wp_posts WHERE ID = ?',
        [blockId]
      );

      let content = (rows as any[])[0]?.post_content;
      const blockTitle = (rows as any[])[0]?.post_title;
      if (!content) continue;

      let contentModified = false;

      for (const item of items) {
        if (item.decision === 'rejected') {
          // Remove the shortcode entirely
          if (content.includes(item.oldShortcode)) {
            content = content.replace(item.oldShortcode, '');
            contentModified = true;
            removed++;
            console.log(`  ✗ Removed: ${item.oldShortcode} from "${blockTitle}"`);
          }
        } else if (item.newShortcode) {
          // Replace with new shortcode
          if (content.includes(item.oldShortcode)) {
            content = content.replace(item.oldShortcode, item.newShortcode);
            contentModified = true;
            updated++;
            console.log(`  ✓ ${item.oldShortcode} → ${item.newShortcode} in "${blockTitle}"`);
          }
        }
      }

      if (contentModified) {
        await this.connection.execute(
          'UPDATE wp_posts SET post_content = ?, post_modified = NOW(), post_modified_gmt = NOW() WHERE ID = ?',
          [content, blockId]
        );
      }
    }

    console.log(`\nShortcodes updated: ${updated}`);
    console.log(`Shortcodes removed: ${removed}`);
  }
}

async function main() {
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  Reusable Block Shortcode Review           ║');
  console.log('╚════════════════════════════════════════════╝\n');

  if (options.dryRun) {
    console.log('Mode: DRY RUN (show broken shortcodes)');
  } else if (options.review) {
    console.log('Mode: INTERACTIVE REVIEW');
  } else if (options.execute) {
    console.log('Mode: EXECUTE APPROVED CHANGES');
  }
  console.log('');

  const connection = await createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: 'root',
    password: 'root',
    database: 'local',
  });

  console.log('✓ Connected to database\n');

  const reviewer = new BlockShortcodeReviewer(connection);

  try {
    await reviewer.loadProducts();

    if (options.execute) {
      if (!existsSync(REVIEW_FILE_PATH)) {
        console.log('No review file found. Run with --review first.');
        return;
      }

      const reviewFile: ReviewFile = JSON.parse(readFileSync(REVIEW_FILE_PATH, 'utf-8'));
      console.log(`Review file: ${reviewFile.approved} approved, ${reviewFile.rejected} rejected, ${reviewFile.pending} pending\n`);

      await reviewer.executeApproved(reviewFile);

    } else if (options.review) {
      const shortcodes = await reviewer.findBrokenBlockShortcodes();

      if (shortcodes.length === 0) {
        console.log('No broken shortcodes found in reusable blocks.');
        return;
      }

      const reviewFile = await reviewer.interactiveReview(shortcodes);

      console.log(`\nReview progress saved to: ${REVIEW_FILE_PATH}`);
      console.log(`  Approved: ${reviewFile.approved}`);
      console.log(`  Rejected: ${reviewFile.rejected}`);
      console.log(`  Pending: ${reviewFile.pending}`);
      console.log('\nRun with --execute to apply approved changes.');

    } else {
      // Dry run - just show broken shortcodes
      const shortcodes = await reviewer.findBrokenBlockShortcodes();

      console.log('Broken shortcodes in reusable blocks:\n');
      for (const s of shortcodes) {
        console.log(`  Block: ${s.blockTitle} (ID: ${s.blockId})`);
        console.log(`    Shortcode: ${s.oldShortcode}`);
        if (s.suggestedProductId) {
          console.log(`    Suggested: [${s.suggestedProductId}] ${s.suggestedProductName} (${s.matchConfidence}%)`);
        } else {
          console.log(`    Suggested: No match found`);
        }
        console.log('');
      }

      console.log('To start interactive review, run:');
      console.log('  bun scripts/review-block-shortcodes.ts --review');
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
