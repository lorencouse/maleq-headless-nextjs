/**
 * In-memory product index singleton with query API.
 *
 * Lazy-initializes on first request. Real-time freshness comes from the
 * /api/revalidate webhook (WP -> Next.js) calling invalidateProductIndex().
 * /api/cron/refresh-index provides a nightly safety-net refresh from
 * external cron, so any data changes that bypass the webhook still surface
 * within ~24h without a periodic in-process timer (which previously caused
 * a ~2s MySQL spike every 5 minutes per running Next.js instance).
 *
 * All filtering, sorting, and facet extraction happens in-memory (~1-5ms).
 */
import { loadProductIndex, type ProductIndexEntry } from '@/lib/db/index-loader';
import { tokenizeQuery, simpleStem, isFuzzyMatch } from '@/lib/utils/search-helpers';

// ─── Types ───

export interface IndexQueryParams {
  category?: string;
  brand?: string;
  material?: string;
  color?: string;
  volume?: string;
  length?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  onSale?: boolean;
  productType?: string;
  search?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

export interface FacetOption {
  name: string;
  slug: string;
  count: number;
}

export interface IndexQueryResult {
  products: ProductIndexEntry[];
  total: number;
  facets: {
    brands: FacetOption[];
    materials: FacetOption[];
    colors: FacetOption[];
    volumes: FacetOption[];
    lengths: FacetOption[];
    categories: FacetOption[];
  };
}

// ─── Singleton State ───

let indexEntries: ProductIndexEntry[] | null = null;
let bySlug: Map<string, ProductIndexEntry> | null = null;
let byId: Map<number, ProductIndexEntry> | null = null;
let byCategorySlug: Map<string, ProductIndexEntry[]> | null = null;
let byBrandSlug: Map<string, ProductIndexEntry[]> | null = null;
/** Pre-computed lowercased searchable text and stemmed words per product */
let searchText: Map<number, { text: string; words: string[]; stemmed: string[] }> | null = null;
let loadPromise: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  if (indexEntries) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const start = performance.now();
      const entries = await loadProductIndex();
      buildLookups(entries);
      const elapsed = (performance.now() - start).toFixed(0);
      console.log(`[product-index] Loaded ${entries.length} products in ${elapsed}ms`);
    } finally {
      // Always clear, even on failure — otherwise a single transient DB error
      // (e.g. dropped SSH tunnel) caches the rejected promise forever and the
      // index never recovers until the process restarts.
      loadPromise = null;
    }
  })();

  return loadPromise;
}

function buildLookups(entries: ProductIndexEntry[]): void {
  indexEntries = entries;
  bySlug = new Map();
  byId = new Map();
  byCategorySlug = new Map();
  byBrandSlug = new Map();
  searchText = new Map();

  for (const entry of entries) {
    bySlug.set(entry.slug, entry);
    byId.set(entry.id, entry);

    for (const catSlug of entry.categorySlugs) {
      const list = byCategorySlug.get(catSlug);
      if (list) list.push(entry);
      else byCategorySlug.set(catSlug, [entry]);
    }

    if (entry.brandSlug) {
      const list = byBrandSlug.get(entry.brandSlug);
      if (list) list.push(entry);
      else byBrandSlug.set(entry.brandSlug, [entry]);
    }

    // Pre-compute searchable text: name + brand + categories + slug (hyphen→space)
    const parts = [
      entry.name,
      entry.brandName || '',
      ...entry.categoryNames,
      entry.slug.replace(/-/g, ' '),
    ];
    const text = parts.join(' ').toLowerCase();
    const words = text.split(/\s+/).filter(w => w.length > 1);
    const stemmed = words.map(simpleStem);
    searchText.set(entry.id, { text, words, stemmed });
  }
}

/** Force an immediate reload (e.g., after webhook notification). */
export async function invalidateProductIndex(): Promise<void> {
  try {
    const start = performance.now();
    const entries = await loadProductIndex();
    buildLookups(entries);
    const elapsed = (performance.now() - start).toFixed(0);
    console.log(`[product-index] Invalidated & reloaded ${entries.length} products in ${elapsed}ms`);
  } catch (err) {
    console.error('[product-index] Invalidation failed:', err);
  }
}

/** Get a single product by slug from the index. */
export async function getIndexEntryBySlug(slug: string): Promise<ProductIndexEntry | null> {
  await ensureLoaded();
  return bySlug?.get(slug) ?? null;
}

/** Get a single product by database ID from the index. */
export async function getIndexEntryById(id: number): Promise<ProductIndexEntry | null> {
  await ensureLoaded();
  return byId?.get(id) ?? null;
}

/** Get all entries (for search indexing etc). */
export async function getAllIndexEntries(): Promise<ProductIndexEntry[]> {
  await ensureLoaded();
  return indexEntries || [];
}

// ─── Query API ───

export async function queryProductIndex(params: IndexQueryParams): Promise<IndexQueryResult> {
  await ensureLoaded();

  const {
    category,
    brand,
    material,
    color,
    volume,
    length,
    minPrice,
    maxPrice,
    inStock,
    onSale,
    productType,
    search,
    sort = 'newest',
    limit = 24,
    offset = 0,
  } = params;

  // Start with the most selective lookup
  let candidates: ProductIndexEntry[];
  if (category && byCategorySlug?.has(category)) {
    candidates = byCategorySlug.get(category)!;
  } else if (brand && byBrandSlug?.has(brand)) {
    candidates = byBrandSlug.get(brand)!;
  } else {
    candidates = indexEntries || [];
  }

  // Apply filters
  let filtered = candidates;

  // If we used a brand/category shortcut, still need to apply the other filter
  if (category && !(byCategorySlug?.has(category) && !brand)) {
    filtered = filtered.filter(p => p.categorySlugs.includes(category));
  }
  if (brand && !(byBrandSlug?.has(brand) && !category)) {
    filtered = filtered.filter(p => p.brandSlug === brand);
  }

  if (material) {
    filtered = filtered.filter(p => p.materialSlug === material);
  }
  if (color) {
    filtered = filtered.filter(p => p.colorSlugs.includes(color));
  }
  if (volume) {
    filtered = filtered.filter(p => p.volumeSlugs.includes(volume));
  }
  if (length) {
    filtered = filtered.filter(p => p.lengthSlugs.includes(length));
  }
  if (minPrice !== undefined && minPrice > 0) {
    filtered = filtered.filter(p => p.price !== null && p.price >= minPrice);
  }
  if (maxPrice !== undefined) {
    filtered = filtered.filter(p => p.price !== null && p.price <= maxPrice);
  }
  if (inStock) {
    filtered = filtered.filter(p => p.stockStatus === 'IN_STOCK');
  }
  if (onSale) {
    filtered = filtered.filter(p => p.onSale);
  }
  if (productType) {
    const upper = productType.toUpperCase();
    filtered = filtered.filter(p => p.type === upper);
  }
  if (search) {
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    filtered = filtered.filter(p => {
      const name = p.name.toLowerCase();
      return terms.every(term => name.includes(term));
    });
  }

  // Extract facets from ALL filtered results (before pagination)
  const facets = extractFacets(filtered);
  const total = filtered.length;

  // Sort
  filtered = sortProducts(filtered, sort);

  // Paginate
  const paginated = filtered.slice(offset, offset + limit);

  return { products: paginated, total, facets };
}

// ─── Search API ───

export interface SearchResult {
  products: ProductIndexEntry[];
  total: number;
  /** Matching category slugs/names for the query */
  matchingCategories: { slug: string; name: string }[];
}

/**
 * Search the product index with stemming, fuzzy matching, and relevance scoring.
 *
 * Scoring (per term):
 *  - Exact substring in product name: +10
 *  - Name starts with term: +5 bonus
 *  - Stem match in name words: +7
 *  - Fuzzy match in name words: +4
 *  - Match in brand name: +3
 *  - Match in category names: +2
 *  - All terms matched in name: +20 bonus
 *
 * Also returns matching categories for autocomplete suggestions.
 */
export async function searchProductIndex(
  query: string,
  options: { limit?: number; inStock?: boolean } = {},
): Promise<SearchResult> {
  await ensureLoaded();

  const { limit = 5, inStock } = options;
  const terms = tokenizeQuery(query);

  if (terms.length === 0 || !indexEntries || !searchText) {
    return { products: [], total: 0, matchingCategories: [] };
  }

  const stemmedTerms = terms.map(simpleStem);

  // Score every product
  const scored: { entry: ProductIndexEntry; score: number }[] = [];

  for (const entry of indexEntries) {
    // Skip out-of-stock if requested
    if (inStock && entry.stockStatus !== 'IN_STOCK') continue;

    const st = searchText.get(entry.id);
    if (!st) continue;

    let score = 0;
    let termsMatched = 0;
    const nameLower = entry.name.toLowerCase();
    const nameWords = nameLower.split(/\s+/);
    const nameStemmed = nameWords.map(simpleStem);

    for (let t = 0; t < terms.length; t++) {
      const term = terms[t];
      const stem = stemmedTerms[t];
      let termScore = 0;

      // Exact substring in name (strongest signal)
      if (nameLower.includes(term)) {
        termScore += 10;
        if (nameLower.startsWith(term)) termScore += 5;
      } else {
        // Stem match in name words
        let stemFound = false;
        for (const ns of nameStemmed) {
          if (ns === stem || ns.startsWith(term) || term.startsWith(ns)) {
            termScore += 7;
            stemFound = true;
            break;
          }
        }
        // Fuzzy match in name words (only if no stem match)
        if (!stemFound) {
          for (const nw of nameWords) {
            if (nw.length > 2 && isFuzzyMatch(nw, term)) {
              termScore += 4;
              break;
            }
          }
        }
      }

      // Brand match
      if (entry.brandName && entry.brandName.toLowerCase().includes(term)) {
        termScore += 3;
      }

      // Category match
      for (const catName of entry.categoryNames) {
        if (catName.toLowerCase().includes(term)) {
          termScore += 2;
          break;
        }
      }

      if (termScore > 0) termsMatched++;
      score += termScore;
    }

    // All terms matched in name bonus
    if (termsMatched === terms.length && terms.length > 1) {
      score += 20;
    }

    // Require at least one term to match
    if (termsMatched === 0) continue;

    // For multi-word queries, penalize if not all terms matched
    if (terms.length > 1 && termsMatched < terms.length) {
      score = Math.floor(score * 0.3);
    }

    // Tiny popularity tiebreaker (0-1 range, won't override relevance)
    score += Math.min(entry.popularityScore / 100000, 1);

    scored.push({ entry, score });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const total = scored.length;
  const products = scored.slice(0, limit).map(s => s.entry);

  // Find matching categories
  const queryLower = query.toLowerCase();
  const matchingCategories: { slug: string; name: string }[] = [];
  const seenCats = new Set<string>();
  if (byCategorySlug) {
    for (const [slug, entries] of byCategorySlug) {
      if (entries.length === 0) continue;
      const catName = entries[0].categoryNames[entries[0].categorySlugs.indexOf(slug)];
      if (!catName) continue;
      const catLower = catName.toLowerCase();
      const slugClean = slug.replace(/-/g, ' ');
      if (catLower.includes(queryLower) || slugClean.includes(queryLower) ||
          terms.some(t => catLower.includes(t) || slugClean.includes(t))) {
        if (!seenCats.has(slug)) {
          seenCats.add(slug);
          matchingCategories.push({ slug, name: catName });
        }
      }
    }
  }
  matchingCategories.sort((a, b) => a.name.localeCompare(b.name));

  return { products: products, total, matchingCategories: matchingCategories.slice(0, 5) };
}

// ─── Helpers ───

function extractFacets(products: ProductIndexEntry[]) {
  const brandMap = new Map<string, { name: string; count: number }>();
  const materialMap = new Map<string, { name: string; count: number }>();
  const colorMap = new Map<string, { name: string; count: number }>();
  const volumeMap = new Map<string, { name: string; count: number }>();
  const lengthMap = new Map<string, { name: string; count: number }>();
  const categoryMap = new Map<string, { name: string; count: number }>();

  for (const p of products) {
    if (p.brandSlug && p.brandName) {
      const existing = brandMap.get(p.brandSlug);
      if (existing) existing.count++;
      else brandMap.set(p.brandSlug, { name: p.brandName, count: 1 });
    }

    if (p.materialSlug && p.materialName) {
      const existing = materialMap.get(p.materialSlug);
      if (existing) existing.count++;
      else materialMap.set(p.materialSlug, { name: p.materialName, count: 1 });
    }

    for (const slug of p.colorSlugs) {
      const existing = colorMap.get(slug);
      if (existing) existing.count++;
      else colorMap.set(slug, { name: slug.replace(/-/g, ' '), count: 1 });
    }

    for (const slug of p.volumeSlugs) {
      const existing = volumeMap.get(slug);
      if (existing) existing.count++;
      else volumeMap.set(slug, { name: slug.replace(/-/g, ' '), count: 1 });
    }

    for (const slug of p.lengthSlugs) {
      const existing = lengthMap.get(slug);
      if (existing) existing.count++;
      else lengthMap.set(slug, { name: slug.replace(/-/g, ' '), count: 1 });
    }

    for (let i = 0; i < p.categorySlugs.length; i++) {
      const slug = p.categorySlugs[i];
      const existing = categoryMap.get(slug);
      if (existing) existing.count++;
      else categoryMap.set(slug, { name: p.categoryNames[i], count: 1 });
    }
  }

  const toSorted = (map: Map<string, { name: string; count: number }>): FacetOption[] =>
    Array.from(map.entries())
      .map(([slug, { name, count }]) => ({ slug, name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

  return {
    brands: toSorted(brandMap),
    materials: toSorted(materialMap),
    colors: toSorted(colorMap),
    volumes: toSorted(volumeMap),
    lengths: toSorted(lengthMap),
    categories: toSorted(categoryMap),
  };
}

function sortProducts(products: ProductIndexEntry[], sort: string): ProductIndexEntry[] {
  const sorted = [...products];

  switch (sort) {
    case 'price-asc':
      sorted.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
      break;
    case 'price-desc':
      sorted.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
      break;
    case 'name-asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'name-desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case 'popularity':
      sorted.sort((a, b) => b.popularityScore - a.popularityScore);
      break;
    default:
      // 'newest' — sort by ID descending (newer products have higher IDs)
      sorted.sort((a, b) => b.id - a.id);
      break;
  }

  // Push out-of-stock to end while preserving sort within each group
  const inStock = sorted.filter(p => p.stockStatus === 'IN_STOCK');
  const outOfStock = sorted.filter(p => p.stockStatus !== 'IN_STOCK');
  return [...inStock, ...outOfStock];
}
