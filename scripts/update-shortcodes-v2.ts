#!/usr/bin/env bun

/**
 * Shortcode Updater V2 - Unified script for finding, reviewing, and applying
 * shortcode replacements across blog posts, pages, and reusable blocks.
 *
 * Modes:
 *   bun scripts/update-shortcodes-v2.ts --import-v1       Import V1 review data
 *   bun scripts/update-shortcodes-v2.ts --scan             Scan DB for all shortcodes
 *   bun scripts/update-shortcodes-v2.ts --review           Interactive review
 *   bun scripts/update-shortcodes-v2.ts --apply            Apply approved changes
 *   bun scripts/update-shortcodes-v2.ts --apply --dry-run  Preview apply
 */

import type { Connection } from 'mysql2/promise';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';
import { getConnection } from './lib/db';

// ─── Paths ───────────────────────────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), 'data');
const STATE_PATH = join(DATA_DIR, 'shortcode-v2-state.json');
const CHANGELOG_PATH = join(DATA_DIR, 'shortcode-v2-changelog.json');

// V1 files
const V1_REVIEW_PATH = join(DATA_DIR, 'shortcode-review.json');
const V1_BLOCK_REVIEW_PATH = join(DATA_DIR, 'block-shortcode-review.json');
const V1_NEEDS_FIXING_PATH = join(DATA_DIR, 'shortcode-needs-fixing.json');

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProductLookup {
  id: number;
  name: string;
  slug: string;
  sku: string;
  type: string;
}

interface ContextSignals {
  nearbyUrl: string | null;
  nearbySlug: string | null;
  imageAlt: string | null;
  imageSrc: string | null;
  figCaption: string | null;
  nearestHeading: string | null;
  linkText: string | null;
}

interface Suggestion {
  product: ProductLookup;
  confidence: number;
  method: string;
}

interface StateItem {
  // Identity
  postId: number;
  postTitle: string;
  postType: string;
  shortcodeType: 'add_to_cart' | 'product';
  oldId: string;
  oldShortcode: string;

  // Context
  context: ContextSignals;

  // Suggestions (top 3)
  suggestions: Suggestion[];

  // Decision
  approvedProductId: number | null;
  approvedProductName: string | null;
  approvedProductSlug: string | null;
  newShortcode: string | null;
  newUrl: string | null;
  decision: 'pending' | 'approved' | 'manual' | 'rejected';
  reviewedAt: string | null;
  notes: string | null;

  // Source tracking
  source: 'scan' | 'v1-review' | 'v1-block' | 'v1-needs-fixing';
}

interface DiscontinuedProduct {
  oldId: string;
  context: string;  // Best description we have (slug, caption, link text, etc.)
  posts: { postId: number; postTitle: string }[];
  rejectedAt: string;
}

interface StateFile {
  version: 2;
  createdAt: string;
  lastUpdatedAt: string;
  items: StateItem[];
  // Pattern maps: slug -> approved product mapping for auto-apply
  approvedPatterns: Record<string, { productId: number; productName: string; productSlug: string }>;
  rejectedSlugs: string[];
  // Discontinued products: oldId -> info about where they appear
  discontinuedProducts: Record<string, DiscontinuedProduct>;
}

interface ChangelogEntry {
  postId: number;
  postTitle: string;
  oldShortcode: string;
  newShortcode: string;
  oldUrl: string | null;
  newUrl: string | null;
  appliedAt: string;
}

// ─── Utility Functions ───────────────────────────────────────────────────────

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

function similarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1.0;
  return (longer.length - levenshtein(longer, shorter)) / longer.length;
}

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function extractSlugFromUrl(url: string): string | null {
  const match = url.match(/\/product\/([^\/\?"]+)/);
  return match ? match[1] : null;
}

function extractNameFromImageUrl(url: string): string | null {
  // Extract product name from image filename
  // e.g. /wp-content/uploads/.../satisfyer-men-heat-vibration-black-stroker.jpg
  const match = url.match(/\/([^\/]+)\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i);
  if (!match) return null;
  let name = match[1];
  // Remove dimension suffixes like -300x300, -1024x1024
  name = name.replace(/-\d+x\d+$/, '');
  // Remove leading numbers/hashes
  name = name.replace(/^[0-9a-f]{8,}-/, '');
  // Convert dashes to spaces
  return name.replace(/-/g, ' ').trim();
}

// Color/size/variant suffixes for slug stripping
const COLOR_SUFFIXES = [
  'red', 'blue', 'black', 'white', 'pink', 'purple', 'green', 'yellow', 'orange',
  'clear', 'smoke', 'grey', 'gray', 'brown', 'gold', 'silver', 'red-velvet',
  'periwinkle', 'vanilla', 'chocolate', 'flesh', 'nude', 'natural', 'teal',
  'violet', 'lavender', 'coral', 'aqua', 'navy', 'midnight', 'ice', 'frost',
  'lilac', 'magenta', 'ivory', 'charcoal', 'rose', 'burgundy', 'crimson',
  'indigo', 'maroon', 'olive', 'plum', 'ruby', 'sapphire', 'tan', 'turquoise',
];
const SIZE_SUFFIXES = [
  'small', 'medium', 'large', 'xl', 'xxl', 'xs', 'sm', 'md', 'lg',
  '1-oz', '2-oz', '4-oz', '8-oz', '16-oz', 'oz', 'ml', 'pack', 'count', 'net',
];
const VARIANT_WORDS = ['select', 'deluxe', 'premium', 'pro', 'plus', 'mini', 'max', 'ultra'];
// Generic product-type words filtered from word-overlap matching (not from slug stripping)
const GENERIC_WORDS = [
  'vibrator', 'dildo', 'plug', 'ring', 'pump', 'sleeve', 'stroker', 'massager',
  'lube', 'lubricant', 'cream', 'gel', 'oil', 'spray', 'wash', 'cleaner',
  'cock', 'anal', 'butt', 'prostate', 'penis', 'nipple',
  'silicone', 'rubber', 'glass', 'steel', 'leather', 'latex', 'nylon',
  'rechargeable', 'waterproof', 'wireless', 'remote', 'control',
  'inch', 'inches', 'set', 'kit', 'pair', 'piece', 'pack',
  'spot', 'suction', 'thrusting', 'rotating', 'dual', 'double', 'triple',
];

function stripVariants(slug: string): string {
  let result = slug;
  for (const color of COLOR_SUFFIXES) {
    result = result.replace(new RegExp(`-${color}$`, 'i'), '');
  }
  for (const size of SIZE_SUFFIXES) {
    result = result.replace(new RegExp(`-${size}$`, 'i'), '');
  }
  for (const word of VARIANT_WORDS) {
    result = result.replace(new RegExp(`-${word}-`, 'gi'), '-');
    result = result.replace(new RegExp(`-${word}$`, 'gi'), '');
    result = result.replace(new RegExp(`^${word}-`, 'gi'), '');
  }
  result = result.replace(/-\d+$/, '');
  result = result.replace(/--+/g, '-').replace(/^-|-$/g, '');
  return result;
}

// ─── ProductIndex ────────────────────────────────────────────────────────────

class ProductIndex {
  products: ProductLookup[] = []; // Parent products only (for matching)
  private byId = new Map<number, ProductLookup>(); // All products + variations
  private bySlug = new Map<string, ProductLookup>();
  private byNormalizedName = new Map<string, ProductLookup[]>();

  async load(connection: Connection): Promise<void> {
    console.log('Loading products from database...');

    // Load parent products for matching (slug/name index)
    const [parentRows] = await connection.execute(`
      SELECT p.ID as id, p.post_title as name, p.post_name as slug,
        COALESCE(pm.meta_value, '') as sku, 'simple' as type
      FROM wp_posts p
      LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key = '_sku'
      WHERE p.post_type = 'product' AND p.post_status = 'publish'
    `);
    this.products = parentRows as ProductLookup[];

    for (const product of this.products) {
      this.byId.set(product.id, product);
      this.bySlug.set(product.slug.toLowerCase(), product);

      // Also index without distributor prefix (wd-, wt-, stc-) for better matching
      const slugLower = product.slug.toLowerCase();
      const prefixMatch = slugLower.match(/^(wd|wt|stc)-(.+)$/);
      if (prefixMatch && !this.bySlug.has(prefixMatch[2])) {
        this.bySlug.set(prefixMatch[2], product);
      }

      const normalized = normalizeForComparison(product.name);
      if (!this.byNormalizedName.has(normalized)) {
        this.byNormalizedName.set(normalized, []);
      }
      this.byNormalizedName.get(normalized)!.push(product);
    }

    // Also index variation IDs (for getById lookups on V1 imports)
    const [varRows] = await connection.execute(`
      SELECT ID as id, post_title as name, post_name as slug, '' as sku, 'variation' as type
      FROM wp_posts WHERE post_type = 'product_variation' AND post_status = 'publish'
    `);
    for (const v of varRows as ProductLookup[]) {
      this.byId.set(v.id, v);
    }

    console.log(`  Loaded ${this.products.length} products + ${(varRows as any[]).length} variations (ID lookup only)`);
  }

  getById(id: number): ProductLookup | undefined {
    return this.byId.get(id);
  }

  getBySlug(slug: string): ProductLookup | undefined {
    return this.bySlug.get(slug.toLowerCase());
  }

  /** Generate up to 3 ranked suggestions from a slug */
  suggestFromSlug(slug: string): Suggestion[] {
    const normalizedSlug = slug.toLowerCase();
    const results: Suggestion[] = [];
    const seenIds = new Set<number>();

    const addResult = (product: ProductLookup, confidence: number, method: string) => {
      if (!seenIds.has(product.id)) {
        seenIds.add(product.id);
        results.push({ product, confidence, method });
      }
    };

    // 1. Exact match
    const exact = this.bySlug.get(normalizedSlug);
    if (exact) addResult(exact, 100, 'exact_slug');

    // 2. Simple variations (also try with common distributor prefixes)
    const simpleVariations = [
      normalizedSlug.replace(/-\d+(-oz|-ml|-pack|-count)?$/, ''),
      normalizedSlug.replace(/^(the-|a-|an-)/, ''),
      normalizedSlug.replace(/-net$/, ''),
    ];
    // Also try adding distributor prefixes (wd-, etc.) to search slug
    const DIST_PREFIXES = ['wd-', 'wt-', 'stc-'];
    for (const prefix of DIST_PREFIXES) {
      simpleVariations.push(prefix + normalizedSlug);
      simpleVariations.push(prefix + normalizedSlug.replace(/-net$/, ''));
    }
    for (const variant of simpleVariations) {
      const match = this.bySlug.get(variant);
      if (match) addResult(match, 95, 'slug_variant');
    }

    // 3. Stripped match (remove color/size/variant)
    const strippedSlug = stripVariants(normalizedSlug);
    for (const [productSlug, product] of this.bySlug) {
      if (stripVariants(productSlug) === strippedSlug) {
        addResult(product, 90, 'stripped_match');
      }
    }

    // 4. Containment match — one slug contains the other
    //    Only consider if both slugs have meaningful length (>10 chars)
    if (results.length === 0 || results[0].confidence < 98) {
      const containResults: { product: ProductLookup; ratio: number }[] = [];
      for (const [productSlug, product] of this.bySlug) {
        // Skip very short slugs that trivially match inside longer ones
        if (productSlug.length < 10 || normalizedSlug.length < 10) continue;
        if (productSlug.includes(normalizedSlug) || normalizedSlug.includes(productSlug)) {
          const shorter = Math.min(normalizedSlug.length, productSlug.length);
          const longer = Math.max(normalizedSlug.length, productSlug.length);
          const ratio = shorter / longer;
          // Only count if the shorter is at least 50% of the longer
          if (ratio >= 0.5) {
            containResults.push({ product, ratio });
          }
        }
      }
      containResults.sort((a, b) => b.ratio - a.ratio);
      for (const cr of containResults.slice(0, 3)) {
        // Scale: 70% length ratio → 85 confidence, 100% → 99
        addResult(cr.product, Math.round(55 + cr.ratio * 44), 'contains_slug');
      }
    }

    // 5. Prefix matching — shared beginning words are a strong signal
    const inputWords = normalizedSlug.split('-');
    if (inputWords.length >= 3) {
      const prefixResults: { product: ProductLookup; prefixLen: number; inputLen: number; prodLen: number }[] = [];
      for (const [productSlug, product] of this.bySlug) {
        const prodWords = productSlug.split('-');
        // Count matching prefix words
        let prefixLen = 0;
        const minLen = Math.min(inputWords.length, prodWords.length);
        for (let i = 0; i < minLen; i++) {
          if (inputWords[i] === prodWords[i] || inputWords[i].startsWith(prodWords[i]) || prodWords[i].startsWith(inputWords[i])) {
            prefixLen++;
          } else {
            break;
          }
        }
        if (prefixLen >= 3) {
          prefixResults.push({ product, prefixLen, inputLen: inputWords.length, prodLen: prodWords.length });
        }
      }
      prefixResults.sort((a, b) => b.prefixLen - a.prefixLen);
      for (const pr of prefixResults.slice(0, 3)) {
        // Score: 3-word prefix → 85, scales up with longer prefix
        // Bonus if prefix covers most of the shorter slug
        const coverage = pr.prefixLen / Math.min(pr.inputLen, pr.prodLen);
        const confidence = Math.min(98, Math.round(75 + pr.prefixLen * 3 + coverage * 10));
        addResult(pr.product, confidence, `prefix_${pr.prefixLen}w`);
      }
    }

    // 6. Word overlap matching (with stemmed/prefix word matching, filtering generic words)
    const isFilteredWord = (w: string) =>
      COLOR_SUFFIXES.includes(w) || SIZE_SUFFIXES.includes(w) ||
      VARIANT_WORDS.includes(w) || GENERIC_WORDS.includes(w) || w.length <= 2;

    const slugWords = normalizedSlug.split('-').filter(w => !isFilteredWord(w));

    if (slugWords.length >= 2) {
      const wordMatches: { product: ProductLookup; count: number; ratio: number }[] = [];
      for (const [productSlug, product] of this.bySlug) {
        const productWords = productSlug.split('-').filter(w => !isFilteredWord(w));
        if (productWords.length === 0) continue;
        // Match words including prefix matches (e.g., "inches" matches "inch")
        const matchingWords = slugWords.filter(sw =>
          productWords.some(pw => sw === pw || sw.startsWith(pw) || pw.startsWith(sw))
        );
        const matchRatio = matchingWords.length / Math.max(slugWords.length, productWords.length);
        if (matchingWords.length >= 2 && matchRatio > 0.5) {
          wordMatches.push({ product, count: matchingWords.length, ratio: matchRatio });
        }
      }
      wordMatches.sort((a, b) => b.ratio - a.ratio || b.count - a.count);
      for (const wm of wordMatches.slice(0, 3)) {
        // Scale confidence by ratio: 0.5 → 65, 0.8 → 86, 1.0 → 98
        const confidence = Math.round(50 + wm.ratio * 48);
        addResult(wm.product, confidence, 'word_match');
      }
    }

    // 6. Fuzzy similarity (skip if we already have high-confidence matches)
    if (results.length === 0 || results[0].confidence < 85) {
      const fuzzyResults: { product: ProductLookup; sim: number }[] = [];
      for (const [productSlug, product] of this.bySlug) {
        // Relaxed length check — allow up to 70% difference for substring-like matches
        if (Math.abs(normalizedSlug.length - productSlug.length) > normalizedSlug.length * 0.7) continue;
        const sim1 = similarity(normalizedSlug, productSlug);
        const sim2 = sim1 < 0.6 ? similarity(strippedSlug, stripVariants(productSlug)) : sim1;
        const sim = Math.max(sim1, sim2);
        if (sim >= 0.6) {
          fuzzyResults.push({ product, sim });
        }
      }
      fuzzyResults.sort((a, b) => b.sim - a.sim);
      for (const fr of fuzzyResults.slice(0, 3)) {
        addResult(fr.product, Math.round(fr.sim * 100), 'fuzzy_slug');
      }
    }

    // Sort by confidence descending, return top 3
    results.sort((a, b) => b.confidence - a.confidence);
    return results.slice(0, 3);
  }

  /** Generate suggestions from a product name string (caption, alt text, heading) */
  suggestFromName(name: string): Suggestion[] {
    const normalized = normalizeForComparison(name);
    const results: Suggestion[] = [];
    const seenIds = new Set<number>();

    const addResult = (product: ProductLookup, confidence: number, method: string) => {
      if (!seenIds.has(product.id)) {
        seenIds.add(product.id);
        results.push({ product, confidence, method });
      }
    };

    // Exact normalized name match
    const exactMatches = this.byNormalizedName.get(normalized);
    if (exactMatches) {
      for (const p of exactMatches) addResult(p, 95, 'exact_name');
    }

    // Slugified name match
    const slugified = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const slugMatch = this.bySlug.get(slugified);
    if (slugMatch) addResult(slugMatch, 92, 'name_to_slug');

    // Name contains / contained-in matching (only if no high-confidence match yet)
    if (results.length === 0 || results[0].confidence < 90) {
      const nameResults: { product: ProductLookup; score: number }[] = [];
      for (const product of this.products) {
        const prodNorm = normalizeForComparison(product.name);
        // Skip very short or empty product names — they match everything
        if (prodNorm.length < 10) continue;
        if (prodNorm.includes(normalized) || normalized.includes(prodNorm)) {
          const shorter = Math.min(normalized.length, prodNorm.length);
          const longer = Math.max(normalized.length, prodNorm.length);
          const ratio = shorter / longer;
          // Require the shorter to be at least 50% of the longer
          if (ratio < 0.5) continue;
          nameResults.push({ product, score: 70 + ratio * 25 });
        }
      }
      nameResults.sort((a, b) => b.score - a.score);
      for (const nr of nameResults.slice(0, 3)) {
        addResult(nr.product, Math.round(nr.score), 'name_contains');
      }
    }

    // Fuzzy name similarity (expensive - only if still no good matches)
    if (results.length === 0 || results[0].confidence < 80) {
      const fuzzyResults: { product: ProductLookup; sim: number }[] = [];
      for (const product of this.products) {
        const prodNorm = normalizeForComparison(product.name);
        if (prodNorm.length < 10) continue;
        if (Math.abs(normalized.length - prodNorm.length) > normalized.length * 0.5) continue;
        const sim = similarity(normalized, prodNorm);
        if (sim >= 0.65) {
          fuzzyResults.push({ product, sim });
        }
      }
      fuzzyResults.sort((a, b) => b.sim - a.sim);
      for (const fr of fuzzyResults.slice(0, 3)) {
        addResult(fr.product, Math.round(fr.sim * 90), 'fuzzy_name');
      }
    }

    results.sort((a, b) => b.confidence - a.confidence);
    return results.slice(0, 3);
  }

  /** Search products interactively */
  search(query: string): ProductLookup[] {
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
      const sim = Math.max(similarity(normalized, nameNorm), similarity(query.toLowerCase(), slugNorm));
      if (sim >= 0.6) {
        results.push({ product, score: Math.round(sim * 80) });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 10).map(r => r.product);
  }
}

// ─── StateManager ────────────────────────────────────────────────────────────

class StateManager {
  state: StateFile;

  constructor() {
    if (existsSync(STATE_PATH)) {
      this.state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
      // Ensure discontinuedProducts exists (migration from older state files)
      if (!this.state.discontinuedProducts) {
        this.state.discontinuedProducts = {};
      }
      console.log(`  Loaded state: ${this.state.items.length} items`);
    } else {
      this.state = {
        version: 2,
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        items: [],
        approvedPatterns: {},
        rejectedSlugs: [],
        discontinuedProducts: {},
      };
      console.log('  Created new state file');
    }
  }

  save(): void {
    this.state.lastUpdatedAt = new Date().toISOString();
    writeFileSync(STATE_PATH, JSON.stringify(this.state, null, 2));
  }

  /** Find existing item by post ID + old shortcode ID */
  findItem(postId: number, oldId: string): StateItem | undefined {
    return this.state.items.find(i => i.postId === postId && i.oldId === oldId);
  }

  /** Add item if it doesn't already exist (dedup by postId + oldId) */
  addItem(item: StateItem): boolean {
    const existing = this.findItem(item.postId, item.oldId);
    if (existing) return false;
    this.state.items.push(item);
    return true;
  }

  /** Apply a pattern: if slug X is approved as product Y, auto-approve all pending slug X items */
  addApprovedPattern(slug: string, productId: number, productName: string, productSlug: string): number {
    this.state.approvedPatterns[slug] = { productId, productName, productSlug };
    let autoApplied = 0;
    for (const item of this.state.items) {
      if (item.decision === 'pending' && item.context.nearbySlug === slug) {
        item.approvedProductId = productId;
        item.approvedProductName = productName;
        item.approvedProductSlug = productSlug;
        item.newShortcode = `[add_to_cart id="${productId}"]`;
        item.newUrl = `/product/${productSlug}/`;
        item.decision = 'approved';
        item.reviewedAt = new Date().toISOString();
        item.notes = 'Auto-applied from pattern';
        autoApplied++;
      }
    }
    return autoApplied;
  }

  /** Approve ALL pending items with the same old product ID */
  approveByOldId(oldId: string, productId: number, productName: string, productSlug: string): number {
    let autoApplied = 0;
    for (const item of this.state.items) {
      if (item.decision === 'pending' && item.oldId === oldId) {
        item.approvedProductId = productId;
        item.approvedProductName = productName;
        item.approvedProductSlug = productSlug;
        item.newShortcode = `[add_to_cart id="${productId}"]`;
        item.newUrl = `/product/${productSlug}/`;
        item.decision = 'approved';
        item.reviewedAt = new Date().toISOString();
        item.notes = `Auto-applied from same old ID ${oldId}`;
        autoApplied++;
      }
    }
    return autoApplied;
  }

  addRejectedSlug(slug: string): number {
    if (!this.state.rejectedSlugs.includes(slug)) {
      this.state.rejectedSlugs.push(slug);
    }
    let autoRejected = 0;
    for (const item of this.state.items) {
      if (item.decision === 'pending' && item.context.nearbySlug === slug) {
        item.decision = 'rejected';
        item.approvedProductId = null;
        item.approvedProductName = null;
        item.approvedProductSlug = null;
        item.newShortcode = null;
        item.newUrl = null;
        item.reviewedAt = new Date().toISOString();
        item.notes = 'Auto-rejected from pattern';
        autoRejected++;
      }
    }
    return autoRejected;
  }

  /** Mark an old product ID as discontinued. Rejects ALL pending items with that old ID. */
  addDiscontinuedProduct(oldId: string, item: StateItem): number {
    // Build context description from best available signal
    const context = item.context.nearbySlug
      || item.context.figCaption
      || item.context.linkText
      || item.context.imageAlt
      || item.context.nearestHeading
      || `old ID ${oldId}`;

    // Collect all posts that reference this old ID
    const posts = this.state.items
      .filter(i => i.oldId === oldId)
      .map(i => ({ postId: i.postId, postTitle: i.postTitle }));
    // Deduplicate by postId
    const uniquePosts = Array.from(new Map(posts.map(p => [p.postId, p])).values());

    this.state.discontinuedProducts[oldId] = {
      oldId,
      context,
      posts: uniquePosts,
      rejectedAt: new Date().toISOString(),
    };

    // Auto-reject ALL pending items with this old product ID
    let autoRejected = 0;
    for (const i of this.state.items) {
      if (i.decision === 'pending' && i.oldId === oldId) {
        i.decision = 'rejected';
        i.approvedProductId = null;
        i.approvedProductName = null;
        i.approvedProductSlug = null;
        i.newShortcode = null;
        i.newUrl = null;
        i.reviewedAt = new Date().toISOString();
        i.notes = `Discontinued product (old ID ${oldId})`;
        autoRejected++;
      }
    }
    return autoRejected;
  }

  /** Check if an old product ID is discontinued */
  isDiscontinued(oldId: string): boolean {
    return oldId in this.state.discontinuedProducts;
  }

  /** Apply all stored patterns to pending items */
  applyStoredPatterns(): { approved: number; rejected: number; discontinued: number } {
    let approved = 0;
    let rejected = 0;
    let discontinued = 0;

    for (const item of this.state.items) {
      if (item.decision !== 'pending') continue;

      // Check discontinued products by old ID first
      if (this.isDiscontinued(item.oldId)) {
        item.decision = 'rejected';
        item.approvedProductId = null;
        item.approvedProductName = null;
        item.approvedProductSlug = null;
        item.newShortcode = null;
        item.newUrl = null;
        item.reviewedAt = new Date().toISOString();
        item.notes = `Discontinued product (old ID ${item.oldId})`;
        discontinued++;
        continue;
      }

      const slug = item.context.nearbySlug;
      if (!slug) continue;

      if (this.state.approvedPatterns[slug]) {
        const p = this.state.approvedPatterns[slug];
        item.approvedProductId = p.productId;
        item.approvedProductName = p.productName;
        item.approvedProductSlug = p.productSlug;
        item.newShortcode = `[add_to_cart id="${p.productId}"]`;
        item.newUrl = `/product/${p.productSlug}/`;
        item.decision = 'approved';
        item.reviewedAt = new Date().toISOString();
        item.notes = 'Auto-applied from stored pattern';
        approved++;
      } else if (this.state.rejectedSlugs.includes(slug)) {
        item.decision = 'rejected';
        item.approvedProductId = null;
        item.approvedProductName = null;
        item.approvedProductSlug = null;
        item.newShortcode = null;
        item.newUrl = null;
        item.reviewedAt = new Date().toISOString();
        item.notes = 'Auto-rejected from stored pattern';
        rejected++;
      }
    }

    return { approved, rejected, discontinued };
  }

  getSummary(): { total: number; pending: number; approved: number; rejected: number } {
    let pending = 0, approved = 0, rejected = 0;
    for (const item of this.state.items) {
      if (item.decision === 'pending') pending++;
      else if (item.decision === 'approved' || item.decision === 'manual') approved++;
      else if (item.decision === 'rejected') rejected++;
    }
    return { total: this.state.items.length, pending, approved, rejected };
  }
}

// ─── Context Extraction ──────────────────────────────────────────────────────

function extractContext(content: string, position: number): ContextSignals {
  const contextBefore = content.substring(Math.max(0, position - 3000), position);
  const contextAfter = content.substring(position, Math.min(content.length, position + 500));

  // 1. Nearby product URL (last one before shortcode)
  const urlMatches = [...contextBefore.matchAll(/href="([^"]*\/product\/[^"]+)"/g)];
  const nearbyUrl = urlMatches.length > 0 ? urlMatches[urlMatches.length - 1][1] : null;
  const nearbySlug = nearbyUrl ? extractSlugFromUrl(nearbyUrl) : null;

  // 2. Image alt text (closest img before shortcode)
  const altMatches = [...contextBefore.matchAll(/<img[^>]+alt="([^"]+)"[^>]*>/g)];
  const imageAlt = altMatches.length > 0 ? altMatches[altMatches.length - 1][1].trim() : null;

  // 3. Image src URL (closest img before shortcode)
  const srcMatches = [...contextBefore.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/g)];
  const imageSrc = srcMatches.length > 0 ? srcMatches[srcMatches.length - 1][1] : null;

  // 4. Figcaption (closest before shortcode)
  const captionMatch = contextBefore.match(/<figcaption[^>]*>([^<]+)<\/figcaption>\s*$/);
  const figCaption = captionMatch ? captionMatch[1].trim() : null;

  // 5. Nearest heading (h2-h4 before shortcode)
  const headingMatches = [...contextBefore.matchAll(/<h[2-4][^>]*>([^<]+)<\/h[2-4]>/g)];
  const nearestHeading = headingMatches.length > 0 ? headingMatches[headingMatches.length - 1][1].trim() : null;

  // 6. Link text near shortcode
  const linkTextMatches = [...contextBefore.matchAll(/<a[^>]+href="[^"]*\/product\/[^"]*"[^>]*>([^<]+)<\/a>/g)];
  const linkText = linkTextMatches.length > 0 ? linkTextMatches[linkTextMatches.length - 1][1].trim() : null;

  return { nearbyUrl, nearbySlug, imageAlt, imageSrc, figCaption, nearestHeading, linkText };
}

// ─── Match Engine ────────────────────────────────────────────────────────────

function generateSuggestions(context: ContextSignals, index: ProductIndex): Suggestion[] {
  const allSuggestions: Suggestion[] = [];
  const seenIds = new Set<number>();

  const collect = (suggestions: Suggestion[], sourceBoost: number = 0) => {
    for (const s of suggestions) {
      if (!seenIds.has(s.product.id)) {
        seenIds.add(s.product.id);
        allSuggestions.push({ ...s, confidence: s.confidence + sourceBoost });
      } else {
        // Boost existing suggestion when multiple signals agree
        const existing = allSuggestions.find(e => e.product.id === s.product.id);
        if (existing) {
          existing.confidence = Math.min(99, existing.confidence + 5);
          existing.method += '+' + s.method;
        }
      }
    }
  };

  // Primary signal: nearby slug
  if (context.nearbySlug) {
    collect(index.suggestFromSlug(context.nearbySlug));
  }

  // Secondary signals: name-based (skip very short/generic text)
  const MIN_NAME_LENGTH = 8;
  const GENERIC_LINK_TEXTS = ['shop', 'store', 'buy', 'buy now', 'add to cart', 'mq store', 'shop now', 'click here', 'learn more'];

  if (context.figCaption && context.figCaption.length >= MIN_NAME_LENGTH) {
    collect(index.suggestFromName(context.figCaption));
  }
  if (context.imageAlt && context.imageAlt.length >= MIN_NAME_LENGTH) {
    collect(index.suggestFromName(context.imageAlt));
  }
  if (context.linkText && context.linkText.length >= MIN_NAME_LENGTH &&
      !GENERIC_LINK_TEXTS.includes(context.linkText.toLowerCase())) {
    collect(index.suggestFromName(context.linkText));
  }

  // Tertiary signal: image filename
  if (context.imageSrc) {
    const nameFromImage = extractNameFromImageUrl(context.imageSrc);
    if (nameFromImage && nameFromImage.length > 5) {
      collect(index.suggestFromName(nameFromImage), -10); // Lower confidence for image filenames
    }
  }

  // Sort by confidence, return top 3
  allSuggestions.sort((a, b) => b.confidence - a.confidence);
  return allSuggestions.slice(0, 3);
}

// ─── Import V1 ───────────────────────────────────────────────────────────────

async function importV1(stateMgr: StateManager, index: ProductIndex): Promise<void> {
  console.log('\n── Import V1 Data ──────────────────────────────────\n');

  let imported = 0;
  let skipped = 0;
  let fixed = 0;

  // 1. Import from shortcode-review.json (main review file)
  if (existsSync(V1_REVIEW_PATH)) {
    const v1Data = JSON.parse(readFileSync(V1_REVIEW_PATH, 'utf-8'));
    console.log(`Reading ${V1_REVIEW_PATH}...`);
    console.log(`  ${v1Data.items.length} items total`);

    for (const v1Item of v1Data.items) {
      // Map V1 decision to V2
      let decision: StateItem['decision'] = 'pending';
      if (v1Item.decision === 'approved' || v1Item.decision === 'manual') {
        decision = v1Item.decision as 'approved' | 'manual';
      } else if (v1Item.decision === 'rejected') {
        decision = 'rejected';
      }

      let productId = v1Item.approvedProductId;
      let productName = v1Item.approvedProductName;
      let productSlug = v1Item.approvedProductSlug;

      // Fix V1 bug: some approved items have null product name/slug
      if (decision !== 'rejected' && productId && (!productName || !productSlug)) {
        const product = index.getById(productId);
        if (product) {
          productName = product.name;
          productSlug = product.slug;
          fixed++;
        }
      }

      const item: StateItem = {
        postId: v1Item.postId,
        postTitle: v1Item.postTitle || '',
        postType: 'post', // V1 didn't store post type consistently
        shortcodeType: v1Item.oldShortcode?.includes('product ') ? 'product' : 'add_to_cart',
        oldId: v1Item.oldId,
        oldShortcode: v1Item.oldShortcode,
        context: {
          nearbyUrl: v1Item.oldUrl || null,
          nearbySlug: v1Item.nearbySlug || null,
          imageAlt: null,
          imageSrc: null,
          figCaption: null,
          nearestHeading: null,
          linkText: null,
        },
        suggestions: [],
        approvedProductId: productId,
        approvedProductName: productName,
        approvedProductSlug: productSlug,
        newShortcode: productId ? `[add_to_cart id="${productId}"]` : null,
        newUrl: productSlug ? `/product/${productSlug}/` : null,
        decision,
        reviewedAt: v1Item.reviewedAt || null,
        notes: v1Item.notes ? `v1: ${v1Item.notes}` : 'Imported from V1',
        source: 'v1-review',
      };

      if (stateMgr.addItem(item)) {
        imported++;
        // Store approved patterns
        if (decision !== 'rejected' && productId && productSlug && item.context.nearbySlug) {
          stateMgr.state.approvedPatterns[item.context.nearbySlug] = {
            productId, productName: productName || '', productSlug,
          };
        }
      } else {
        skipped++;
      }
    }
    console.log(`  Imported: ${imported}, Skipped (dups): ${skipped}, Fixed names: ${fixed}`);
  } else {
    console.log(`  ${V1_REVIEW_PATH} not found, skipping`);
  }

  // 2. Import from block-shortcode-review.json
  let blockImported = 0;
  let blockSkipped = 0;
  if (existsSync(V1_BLOCK_REVIEW_PATH)) {
    const v1BlockData = JSON.parse(readFileSync(V1_BLOCK_REVIEW_PATH, 'utf-8'));
    console.log(`\nReading ${V1_BLOCK_REVIEW_PATH}...`);
    console.log(`  ${v1BlockData.items.length} items total`);

    for (const v1Item of v1BlockData.items) {
      let decision: StateItem['decision'] = 'pending';
      if (v1Item.decision === 'approved' || v1Item.decision === 'manual') {
        decision = v1Item.decision as 'approved' | 'manual';
      } else if (v1Item.decision === 'rejected') {
        decision = 'rejected';
      }

      let productId = v1Item.approvedProductId;
      let productName = v1Item.approvedProductName;
      let productSlug = v1Item.approvedProductSlug;

      // Fix missing names
      if (decision !== 'rejected' && productId && (!productName || !productSlug)) {
        const product = index.getById(productId);
        if (product) {
          productName = product.name;
          productSlug = product.slug;
          fixed++;
        }
      }

      const item: StateItem = {
        postId: v1Item.blockId,
        postTitle: v1Item.blockTitle || '',
        postType: 'wp_block',
        shortcodeType: 'add_to_cart',
        oldId: v1Item.oldShortcodeId,
        oldShortcode: v1Item.oldShortcode,
        context: {
          nearbyUrl: null,
          nearbySlug: null,
          imageAlt: null,
          imageSrc: null,
          figCaption: null,
          nearestHeading: null,
          linkText: null,
        },
        suggestions: [],
        approvedProductId: productId,
        approvedProductName: productName,
        approvedProductSlug: productSlug,
        newShortcode: productId ? `[add_to_cart id="${productId}"]` : null,
        newUrl: productSlug ? `/product/${productSlug}/` : null,
        decision,
        reviewedAt: v1Item.reviewedAt || null,
        notes: 'Imported from V1 block review',
        source: 'v1-block',
      };

      if (stateMgr.addItem(item)) {
        blockImported++;
      } else {
        blockSkipped++;
      }
    }
    console.log(`  Imported: ${blockImported}, Skipped (dups): ${blockSkipped}`);
  } else {
    console.log(`\n  ${V1_BLOCK_REVIEW_PATH} not found, skipping`);
  }

  // 3. Import rejected slugs from needs-fixing file
  if (existsSync(V1_NEEDS_FIXING_PATH)) {
    const v1NeedsFixing = JSON.parse(readFileSync(V1_NEEDS_FIXING_PATH, 'utf-8'));
    console.log(`\nReading ${V1_NEEDS_FIXING_PATH}...`);
    const existingRejected = new Set(stateMgr.state.rejectedSlugs);
    let newRejected = 0;
    for (const slug of v1NeedsFixing.rejectedSlugs || []) {
      if (!existingRejected.has(slug)) {
        stateMgr.state.rejectedSlugs.push(slug);
        newRejected++;
      }
    }
    console.log(`  Added ${newRejected} rejected slugs (total: ${stateMgr.state.rejectedSlugs.length})`);
  } else {
    console.log(`\n  ${V1_NEEDS_FIXING_PATH} not found, skipping`);
  }

  stateMgr.save();

  const summary = stateMgr.getSummary();
  console.log('\n── Import Summary ──────────────────────────────────');
  console.log(`  Total items:   ${summary.total}`);
  console.log(`  Approved:      ${summary.approved}`);
  console.log(`  Rejected:      ${summary.rejected}`);
  console.log(`  Pending:       ${summary.pending}`);
  console.log(`  Fixed names:   ${fixed}`);
  console.log(`  Patterns:      ${Object.keys(stateMgr.state.approvedPatterns).length}`);
  console.log(`  Rejected slugs:${stateMgr.state.rejectedSlugs.length}`);
}

// ─── Scan Mode ───────────────────────────────────────────────────────────────

async function scanForShortcodes(
  connection: Connection,
  stateMgr: StateManager,
  index: ProductIndex,
): Promise<void> {
  console.log('\n── Scan for Shortcodes ─────────────────────────────\n');

  // Query all post types for shortcodes
  const [rows] = await connection.execute(`
    SELECT ID, post_title, post_name, post_content, post_type
    FROM wp_posts
    WHERE (post_content LIKE '%[add_to_cart%' OR post_content LIKE '%[product id=%')
      AND post_status = 'publish'
      AND post_type IN ('post', 'page', 'wp_block', 'wp_template_part')
  `);

  const posts = rows as { ID: number; post_title: string; post_name: string; post_content: string; post_type: string }[];
  console.log(`  Posts with shortcodes: ${posts.length}`);

  let totalShortcodes = 0;
  let newItems = 0;
  let alreadyTracked = 0;
  let autoApprovedCount = 0;

  const shortcodeRegex = /\[(add_to_cart|product)\s+id="(\d+)"\]/g;

  let postIdx = 0;
  for (const post of posts) {
    postIdx++;
    if (postIdx % 50 === 0) process.stdout.write(`  Processing post ${postIdx}/${posts.length}...\r`);
    let match;
    shortcodeRegex.lastIndex = 0;

    while ((match = shortcodeRegex.exec(post.post_content)) !== null) {
      totalShortcodes++;
      const shortcodeType = match[1] as 'add_to_cart' | 'product';
      const oldId = match[2];

      // ALL shortcodes are candidates - old IDs may collide with new products

      // Check if already in state
      if (stateMgr.findItem(post.ID, oldId)) {
        alreadyTracked++;
        continue;
      }

      // Extract context signals
      const context = extractContext(post.post_content, match.index);

      // Check patterns first
      let decision: StateItem['decision'] = 'pending';
      let approvedProductId: number | null = null;
      let approvedProductName: string | null = null;
      let approvedProductSlug: string | null = null;
      let newShortcode: string | null = null;
      let newUrl: string | null = null;
      let notes: string | null = null;

      // Check if this old ID is already marked discontinued
      if (stateMgr.isDiscontinued(oldId)) {
        decision = 'rejected';
        notes = `Discontinued product (old ID ${oldId})`;
      } else if (context.nearbySlug && stateMgr.state.approvedPatterns[context.nearbySlug]) {
        const p = stateMgr.state.approvedPatterns[context.nearbySlug];
        decision = 'approved';
        approvedProductId = p.productId;
        approvedProductName = p.productName;
        approvedProductSlug = p.productSlug;
        newShortcode = `[add_to_cart id="${p.productId}"]`;
        newUrl = `/product/${p.productSlug}/`;
        notes = 'Auto-applied from stored pattern';
      } else if (context.nearbySlug && stateMgr.state.rejectedSlugs.includes(context.nearbySlug)) {
        decision = 'rejected';
        notes = 'Auto-rejected from stored pattern';
      }

      // Generate suggestions for pending items
      const suggestions = decision === 'pending' ? generateSuggestions(context, index) : [];

      // Auto-approve if top suggestion confidence >= 85%
      if (decision === 'pending' && suggestions.length > 0 && suggestions[0].confidence >= 85) {
        const top = suggestions[0];
        decision = 'approved';
        approvedProductId = top.product.id;
        approvedProductName = top.product.name;
        approvedProductSlug = top.product.slug;
        newShortcode = `[add_to_cart id="${top.product.id}"]`;
        newUrl = `/product/${top.product.slug}/`;
        notes = `Auto-approved (${top.confidence}% confidence, ${top.method})`;
        // Also store pattern for future matches
        if (context.nearbySlug) {
          stateMgr.state.approvedPatterns[context.nearbySlug] = {
            productId: top.product.id, productName: top.product.name, productSlug: top.product.slug,
          };
        }
      }

      const item: StateItem = {
        postId: post.ID,
        postTitle: post.post_title,
        postType: post.post_type,
        shortcodeType,
        oldId,
        oldShortcode: match[0],
        context,
        suggestions,
        approvedProductId,
        approvedProductName,
        approvedProductSlug,
        newShortcode,
        newUrl,
        decision,
        reviewedAt: decision !== 'pending' ? new Date().toISOString() : null,
        notes,
        source: 'scan',
      };

      stateMgr.addItem(item);
      newItems++;
      if (decision === 'approved' && notes?.startsWith('Auto-approved')) {
        autoApprovedCount++;
      }
    }
  }

  stateMgr.save();

  const summary = stateMgr.getSummary();
  console.log('\n── Scan Results ────────────────────────────────────');
  console.log(`  Total shortcodes found:  ${totalShortcodes}`);
  console.log(`  Already tracked:         ${alreadyTracked}`);
  console.log(`  New items added:         ${newItems}`);
  console.log(`  Auto-approved (>=85%):   ${autoApprovedCount}`);
  console.log('');
  console.log(`  State total:   ${summary.total}`);
  console.log(`  Approved:      ${summary.approved}`);
  console.log(`  Rejected:      ${summary.rejected}`);
  console.log(`  Pending:       ${summary.pending}`);
}

// ─── Review Mode ─────────────────────────────────────────────────────────────

async function interactiveReview(
  stateMgr: StateManager,
  index: ProductIndex,
): Promise<void> {
  console.log('\n── Interactive Review ───────────────────────────────\n');

  // First, apply stored patterns to any pending items
  const patternResult = stateMgr.applyStoredPatterns();
  if (patternResult.approved + patternResult.rejected + patternResult.discontinued > 0) {
    console.log(`Auto-applied stored patterns: ${patternResult.approved} approved, ${patternResult.rejected} rejected, ${patternResult.discontinued} discontinued`);
    stateMgr.save();
  }

  // Auto-approve high-confidence items (>=85%)
  let autoApproved = 0;
  const pendingForRegen = stateMgr.state.items.filter(i => i.decision === 'pending');
  let regenIdx = 0;
  for (const item of pendingForRegen) {
    regenIdx++;
    if (regenIdx % 10 === 0 || regenIdx === 1) {
      process.stdout.write(`  Regenerating suggestions: ${regenIdx}/${pendingForRegen.length}...\r`);
    }

    // Always regenerate suggestions with latest algorithm
    item.suggestions = generateSuggestions(item.context, index);

    if (item.suggestions.length > 0 && item.suggestions[0].confidence >= 85) {
      const top = item.suggestions[0];
      item.approvedProductId = top.product.id;
      item.approvedProductName = top.product.name;
      item.approvedProductSlug = top.product.slug;
      item.newShortcode = `[add_to_cart id="${top.product.id}"]`;
      item.newUrl = `/product/${top.product.slug}/`;
      item.decision = 'approved';
      item.reviewedAt = new Date().toISOString();
      item.notes = `Auto-approved (${top.confidence}% confidence, ${top.method})`;
      autoApproved++;

      if (item.context.nearbySlug) {
        stateMgr.addApprovedPattern(
          item.context.nearbySlug, top.product.id, top.product.name, top.product.slug,
        );
      }
    }
  }
  process.stdout.write('\r' + ' '.repeat(60) + '\r'); // Clear progress line
  console.log(`Regenerated suggestions for ${pendingForRegen.length} items`);
  if (autoApproved > 0) {
    console.log(`Auto-approved ${autoApproved} items with >=85% confidence`);
  }
  stateMgr.save();

  // Sort pending items: highest confidence first, no suggestions last
  const pendingItems = stateMgr.state.items
    .filter(i => i.decision === 'pending')
    .sort((a, b) => {
      const aConf = a.suggestions.length > 0 ? a.suggestions[0].confidence : -1;
      const bConf = b.suggestions.length > 0 ? b.suggestions[0].confidence : -1;
      return bConf - aConf;
    });

  if (pendingItems.length === 0) {
    console.log('No pending items to review!');
    const summary = stateMgr.getSummary();
    console.log(`  Total: ${summary.total}, Approved: ${summary.approved}, Rejected: ${summary.rejected}`);
    return;
  }

  console.log(`${pendingItems.length} items pending review (sorted by confidence)\n`);
  console.log('Commands:');
  console.log('  1/2/3      Pick suggestion 1, 2, or 3');
  console.log('  <id>       Enter product ID directly (e.g. 195685)');
  console.log('  r          Reject (discontinued/remove)');
  console.log('  s          Skip for now');
  console.log('  f          Search for product');
  console.log('  q          Quit and save');
  console.log('');
  console.log('═'.repeat(70));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = (q: string): Promise<string> =>
    new Promise(resolve => rl.question(q, answer => resolve(answer.trim())));

  let reviewed = 0;
  for (const item of pendingItems) {
    // Re-check patterns (may have been set during this session)
    if (item.decision !== 'pending') {
      reviewed++;
      continue;
    }

    // Always regenerate suggestions with latest algorithm
    item.suggestions = generateSuggestions(item.context, index);

    console.log('');
    console.log(`[${reviewed + 1}/${pendingItems.length}] ${item.postType}: "${item.postTitle}" (post #${item.postId})`);
    console.log(`  Shortcode: ${item.oldShortcode}`);
    if (item.context.nearbyUrl) {
      console.log(`  Old URL:   ${item.context.nearbyUrl}`);
    }
    if (item.context.nearbySlug) {
      console.log(`  Slug:      ${item.context.nearbySlug}`);
    }

    // Show context signals
    const contextParts: string[] = [];
    if (item.context.figCaption) contextParts.push(`Caption: "${item.context.figCaption}"`);
    if (item.context.imageAlt) contextParts.push(`Image alt: "${item.context.imageAlt}"`);
    if (item.context.linkText) contextParts.push(`Link text: "${item.context.linkText}"`);
    if (item.context.nearestHeading) contextParts.push(`Heading: "${item.context.nearestHeading}"`);
    if (item.context.imageSrc) {
      const nameFromImg = extractNameFromImageUrl(item.context.imageSrc);
      if (nameFromImg) contextParts.push(`Image file: "${nameFromImg}"`);
    }
    if (contextParts.length > 0) {
      console.log(`  Context:   ${contextParts[0]}`);
      for (let i = 1; i < contextParts.length; i++) {
        console.log(`             ${contextParts[i]}`);
      }
    }

    // Show suggestions
    if (item.suggestions.length > 0) {
      console.log('');
      for (let i = 0; i < item.suggestions.length; i++) {
        const s = item.suggestions[i];
        console.log(`  ${i + 1}. [${s.confidence}%] ${s.product.name} (ID: ${s.product.id})`);
        console.log(`     Slug: ${s.product.slug} | Method: ${s.method}`);
      }
    } else {
      console.log('\n  No suggestions found');
    }

    let validDecision = false;
    while (!validDecision) {
      const answer = await prompt('\n>>> (1/2/3/<id>/r/s/f/q): ');

      if (answer.toLowerCase() === 'q') {
        console.log('\nSaving and exiting...');
        stateMgr.save();
        rl.close();
        return;
      }

      if (answer.toLowerCase() === 's') {
        reviewed++;
        validDecision = true;
        console.log('  → Skipped');
        continue;
      }

      if (answer.toLowerCase() === 'r') {
        item.decision = 'rejected';
        item.approvedProductId = null;
        item.approvedProductName = null;
        item.approvedProductSlug = null;
        item.newShortcode = null;
        item.newUrl = null;
        item.reviewedAt = new Date().toISOString();
        item.notes = `Discontinued product (old ID ${item.oldId})`;
        reviewed++;
        validDecision = true;

        // Mark as discontinued — auto-rejects ALL pending items with same old ID
        const autoById = stateMgr.addDiscontinuedProduct(item.oldId, item);
        // Also reject same slug pattern
        let autoBySlug = 0;
        if (item.context.nearbySlug) {
          autoBySlug = stateMgr.addRejectedSlug(item.context.nearbySlug);
        }
        const totalAuto = autoById + autoBySlug;
        const disc = stateMgr.state.discontinuedProducts[item.oldId];
        console.log(`  → Discontinued (old ID ${item.oldId}, found in ${disc.posts.length} posts)${totalAuto > 0 ? ` (+${totalAuto} auto-rejected)` : ''}`);
      } else if (/^\d+$/.test(answer)) {
        const num = parseInt(answer, 10);

        // 1-3: pick a suggestion
        if (num >= 1 && num <= 3 && num <= item.suggestions.length) {
          const selected = item.suggestions[num - 1];
          item.approvedProductId = selected.product.id;
          item.approvedProductName = selected.product.name;
          item.approvedProductSlug = selected.product.slug;
          item.newShortcode = `[add_to_cart id="${selected.product.id}"]`;
          item.newUrl = `/product/${selected.product.slug}/`;
          item.decision = 'approved';
          item.reviewedAt = new Date().toISOString();
          item.notes = `Selected suggestion #${num}`;
          reviewed++;
          validDecision = true;

          // Auto-apply to all items with same old ID or same slug
          let autoCount = stateMgr.approveByOldId(item.oldId, selected.product.id, selected.product.name, selected.product.slug);
          if (item.context.nearbySlug) {
            autoCount += stateMgr.addApprovedPattern(
              item.context.nearbySlug,
              selected.product.id,
              selected.product.name,
              selected.product.slug,
            );
          }
          console.log(`  → Approved: ${selected.product.name}${autoCount > 0 ? ` (+${autoCount} auto-applied)` : ''}`);
        } else if (num > 3) {
          // Treat as a product ID
          const product = index.getById(num);
          if (!product) {
            console.log(`  → Product ID ${num} not found.`);
            continue;
          }
          item.approvedProductId = product.id;
          item.approvedProductName = product.name;
          item.approvedProductSlug = product.slug;
          item.newShortcode = `[add_to_cart id="${product.id}"]`;
          item.newUrl = `/product/${product.slug}/`;
          item.decision = 'manual';
          item.reviewedAt = new Date().toISOString();
          item.notes = 'Manual ID entry';
          reviewed++;
          validDecision = true;

          // Auto-apply to all items with same old ID or same slug
          let autoCount = stateMgr.approveByOldId(item.oldId, product.id, product.name, product.slug);
          if (item.context.nearbySlug) {
            autoCount += stateMgr.addApprovedPattern(
              item.context.nearbySlug, product.id, product.name, product.slug,
            );
          }
          console.log(`  → Manual: ${product.name}${autoCount > 0 ? ` (+${autoCount} auto-applied)` : ''}`);
        } else {
          console.log(`  → No suggestion #${answer}. Only ${item.suggestions.length} available.`);
        }
      } else if (answer.toLowerCase() === 'f') {
        const query = await prompt('  Search: ');
        const results = index.search(query);
        if (results.length === 0) {
          console.log('  → No results. Try different terms.');
          continue;
        }
        console.log('\n  Search Results:');
        for (let i = 0; i < results.length; i++) {
          console.log(`    ${i + 1}. [${results[i].id}] ${results[i].name}`);
          console.log(`       Slug: ${results[i].slug}`);
        }

        const sel = await prompt('\n  Select (1-10), Enter to cancel: ');
        const selIdx = parseInt(sel, 10) - 1;
        if (selIdx >= 0 && selIdx < results.length) {
          const selected = results[selIdx];
          item.approvedProductId = selected.id;
          item.approvedProductName = selected.name;
          item.approvedProductSlug = selected.slug;
          item.newShortcode = `[add_to_cart id="${selected.id}"]`;
          item.newUrl = `/product/${selected.slug}/`;
          item.decision = 'manual';
          item.reviewedAt = new Date().toISOString();
          item.notes = 'Selected from search';
          reviewed++;
          validDecision = true;

          // Auto-apply to all items with same old ID or same slug
          let autoCount = stateMgr.approveByOldId(item.oldId, selected.id, selected.name, selected.slug);
          if (item.context.nearbySlug) {
            autoCount += stateMgr.addApprovedPattern(
              item.context.nearbySlug, selected.id, selected.name, selected.slug,
            );
          }
          console.log(`  → Selected: ${selected.name}${autoCount > 0 ? ` (+${autoCount} auto-applied)` : ''}`);
        } else {
          console.log('  → Cancelled.');
        }
      } else {
        console.log('  → Invalid. Use 1/2/3/<id>/r/s/f/q');
      }
    }

    // Save after each decision
    stateMgr.save();
  }

  rl.close();

  const summary = stateMgr.getSummary();
  console.log('\n── Review Complete ─────────────────────────────────');
  console.log(`  Total: ${summary.total}, Approved: ${summary.approved}, Rejected: ${summary.rejected}, Pending: ${summary.pending}`);
}

// ─── Apply Mode ──────────────────────────────────────────────────────────────

async function applyChanges(
  connection: Connection,
  stateMgr: StateManager,
  dryRun: boolean,
): Promise<void> {
  const label = dryRun ? 'DRY RUN' : 'APPLY';
  console.log(`\n── ${label}: Apply Approved Changes ────────────────\n`);

  const approvedItems = stateMgr.state.items.filter(
    i => (i.decision === 'approved' || i.decision === 'manual') && i.approvedProductId && i.newShortcode
  );

  if (approvedItems.length === 0) {
    console.log('No approved items to apply.');
    return;
  }

  // Fix any approved items missing slug by looking up from DB
  let fixedSlugs = 0;
  for (const item of approvedItems) {
    if (item.approvedProductId && !item.approvedProductSlug) {
      const [product] = await connection.execute(
        "SELECT post_name FROM wp_posts WHERE ID = ? AND post_status = 'publish'",
        [item.approvedProductId]
      ) as any[];
      if (product.length > 0 && product[0].post_name) {
        item.approvedProductSlug = product[0].post_name;
        item.newUrl = `/product/${product[0].post_name}/`;
        fixedSlugs++;
      }
    }
  }
  if (fixedSlugs > 0) {
    console.log(`Fixed ${fixedSlugs} items missing product slugs`);
    stateMgr.save();
  }

  // Build global old-ID → new-ID mapping so ALL instances get replaced,
  // even in posts not individually tracked in state
  const idMapping = new Map<string, { newId: number; newSlug: string; newShortcode: string }>();
  const urlMapping = new Map<string, string>(); // old URL → new URL

  for (const item of approvedItems) {
    if (!idMapping.has(item.oldId) && item.approvedProductId) {
      idMapping.set(item.oldId, {
        newId: item.approvedProductId,
        newSlug: item.approvedProductSlug || '',
        newShortcode: `[add_to_cart id="${item.approvedProductId}"]`,
      });
    }
    // Collect URL mappings
    if (item.context.nearbyUrl && item.newUrl && item.context.nearbyUrl !== item.newUrl) {
      urlMapping.set(item.context.nearbyUrl, item.newUrl);
    }
  }

  // Resolve chain mappings: if A→B and B→C, resolve A→C
  // This prevents A being replaced with B, then B being replaced with C in the same pass
  let chainsResolved = 0;
  for (const [oldId, mapping] of idMapping) {
    const newIdStr = String(mapping.newId);
    if (idMapping.has(newIdStr)) {
      const final = idMapping.get(newIdStr)!;
      mapping.newId = final.newId;
      mapping.newSlug = final.newSlug;
      mapping.newShortcode = `[add_to_cart id="${final.newId}"]`;
      chainsResolved++;
    }
  }

  // Remove mappings where the old ID is also a valid new target (now resolved)
  // i.e., if B→C exists and A→C was resolved from A→B→C, remove B→C only if B
  // is not itself an orphaned shortcode in the content
  // Actually, we should keep B→C in case B still appears as an orphaned shortcode.
  // The chain resolution above already ensures A→C, so B→C won't double-replace.

  console.log(`${approvedItems.length} approved items, ${idMapping.size} unique ID mappings${chainsResolved > 0 ? `, ${chainsResolved} chains resolved` : ''}\n`);

  // Query ALL posts with shortcodes (not just tracked ones) to catch every instance
  const [allRows] = await connection.execute(`
    SELECT ID, post_title, post_content, post_type
    FROM wp_posts
    WHERE (post_content LIKE '%[add_to_cart%' OR post_content LIKE '%[product id=%')
      AND post_status = 'publish'
      AND post_type IN ('post', 'page', 'wp_block', 'wp_template_part')
  `);

  const allPosts = allRows as { ID: number; post_title: string; post_content: string; post_type: string }[];

  let shortcodesUpdated = 0;
  let urlsUpdated = 0;
  let postsModified = 0;
  const changelog: ChangelogEntry[] = [];

  for (const post of allPosts) {
    let content = post.post_content;
    let modified = false;

    // Replace all shortcodes using the global ID mapping
    for (const [oldId, mapping] of idMapping) {
      // Match both [add_to_cart id="X"] and [product id="X"] forms
      const patterns = [
        `[add_to_cart id="${oldId}"]`,
        `[product id="${oldId}"]`,
      ];
      for (const oldShortcode of patterns) {
        if (content.includes(oldShortcode)) {
          const count = content.split(oldShortcode).length - 1;
          content = content.split(oldShortcode).join(mapping.newShortcode);
          modified = true;
          shortcodesUpdated += count;

          for (let c = 0; c < count; c++) {
            changelog.push({
              postId: post.ID,
              postTitle: post.post_title,
              oldShortcode,
              newShortcode: mapping.newShortcode,
              oldUrl: null,
              newUrl: `/product/${mapping.newSlug}/`,
              appliedAt: new Date().toISOString(),
            });
          }

          const countStr = count > 1 ? ` (x${count})` : '';
          console.log(`  ${dryRun ? '[DRY]' : '✓'} ${oldShortcode} → ${mapping.newShortcode}${countStr}`);
        }
      }
    }

    // Replace URLs
    for (const [oldUrl, newUrl] of urlMapping) {
      if (content.includes(oldUrl)) {
        const count = content.split(oldUrl).length - 1;
        content = content.split(oldUrl).join(newUrl);
        modified = true;
        urlsUpdated += count;
        console.log(`    ${dryRun ? '[DRY]' : '✓'} URL: ${oldUrl} → ${newUrl}${count > 1 ? ` (x${count})` : ''}`);
      }
    }

    if (modified) {
      if (!dryRun) {
        await connection.execute(
          'UPDATE wp_posts SET post_content = ?, post_modified = NOW(), post_modified_gmt = NOW() WHERE ID = ?',
          [content, post.ID]
        );
      }
      postsModified++;
      console.log(`  ${dryRun ? '[DRY]' : '→'} Post ${post.ID}: ${post.post_title}\n`);
    }
  }

  // Save changelog
  if (!dryRun && changelog.length > 0) {
    writeFileSync(CHANGELOG_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      totalShortcodesUpdated: shortcodesUpdated,
      totalUrlsUpdated: urlsUpdated,
      totalPostsModified: postsModified,
      changes: changelog,
    }, null, 2));
    console.log(`Changelog saved: ${CHANGELOG_PATH}`);
  }

  console.log(`\n── ${label} Summary ─────────────────────────────────`);
  console.log(`  Shortcodes updated: ${shortcodesUpdated}`);
  console.log(`  URLs updated:       ${urlsUpdated}`);
  console.log(`  Posts modified:     ${postsModified}`);
  if (dryRun) {
    console.log('\n  Run without --dry-run to apply changes.');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    importV1: args.includes('--import-v1'),
    scan: args.includes('--scan'),
    review: args.includes('--review'),
    apply: args.includes('--apply'),
    dryRun: args.includes('--dry-run'),
    stats: args.includes('--stats'),
  };
}

async function main() {
  const opts = parseArgs();

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  Shortcode Updater V2                              ║');
  console.log('╚════════════════════════════════════════════════════╝');

  if (!opts.importV1 && !opts.scan && !opts.review && !opts.apply && !opts.stats) {
    console.log('\nUsage:');
    console.log('  bun scripts/update-shortcodes-v2.ts --import-v1       Import V1 review data');
    console.log('  bun scripts/update-shortcodes-v2.ts --scan             Scan DB for orphaned shortcodes');
    console.log('  bun scripts/update-shortcodes-v2.ts --review           Interactive review');
    console.log('  bun scripts/update-shortcodes-v2.ts --apply            Apply approved changes');
    console.log('  bun scripts/update-shortcodes-v2.ts --apply --dry-run  Preview apply');
    console.log('  bun scripts/update-shortcodes-v2.ts --stats            Show state summary');
    return;
  }

  // Stats mode doesn't need DB connection
  if (opts.stats) {
    const stateMgr = new StateManager();
    const summary = stateMgr.getSummary();
    console.log('\n── State Summary ───────────────────────────────────');
    console.log(`  Total items:     ${summary.total}`);
    console.log(`  Approved:        ${summary.approved}`);
    console.log(`  Rejected:        ${summary.rejected}`);
    console.log(`  Pending:         ${summary.pending}`);
    console.log(`  Patterns:        ${Object.keys(stateMgr.state.approvedPatterns).length}`);
    console.log(`  Rejected slugs:  ${stateMgr.state.rejectedSlugs.length}`);
    const discCount = Object.keys(stateMgr.state.discontinuedProducts).length;
    console.log(`  Discontinued:    ${discCount}`);

    // Breakdown by source
    const bySrc: Record<string, number> = {};
    for (const item of stateMgr.state.items) {
      bySrc[item.source] = (bySrc[item.source] || 0) + 1;
    }
    console.log('\n  By source:');
    for (const [src, count] of Object.entries(bySrc)) {
      console.log(`    ${src}: ${count}`);
    }

    // Show discontinued products list
    if (discCount > 0) {
      console.log(`\n── Discontinued Products (${discCount}) ─────────────────`);
      console.log('  These products need manual removal from blog posts:\n');
      for (const [oldId, disc] of Object.entries(stateMgr.state.discontinuedProducts)) {
        console.log(`  Old ID ${oldId}: ${disc.context}`);
        for (const post of disc.posts) {
          console.log(`    - Post #${post.postId}: ${post.postTitle}`);
        }
      }
    }
    return;
  }

  const connection = await getConnection();
  console.log('\n  Connected to database');

  const index = new ProductIndex();
  await index.load(connection);

  const stateMgr = new StateManager();

  try {
    if (opts.importV1) {
      await importV1(stateMgr, index);
    }

    if (opts.scan) {
      await scanForShortcodes(connection, stateMgr, index);
    }

    if (opts.review) {
      await interactiveReview(stateMgr, index);
    }

    if (opts.apply) {
      await applyChanges(connection, stateMgr, opts.dryRun);
    }
  } finally {
    await connection.end();
    console.log('\n  Done');
  }
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
