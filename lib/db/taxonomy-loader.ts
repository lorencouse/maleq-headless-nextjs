/**
 * Loads product taxonomy data (brands, materials, colors) from MySQL.
 *
 * Single-query fetches with in-process caching (5-minute TTL).
 * Replaces paginated GraphQL queries that required multiple round-trips.
 */
import { getPoolAsync } from './pool';
import type { RowDataPacket } from 'mysql2';

interface DbTaxonomyTerm extends RowDataPacket {
  term_id: number;
  name: string;
  slug: string;
  description: string | null;
  count: number;
  [metaAlias: string]: unknown;
}

interface TaxonomyTerm {
  id: string;
  name: string;
  slug: string;
  count: number;
  description?: string | null;
  /** Manufacturer homepage URL (brands only, from termmeta `maleq_brand_website`). */
  website?: string | null;
  /** Manufacturer product-URL template with a `{sku}` placeholder (brands only). */
  productUrlTemplate?: string | null;
}

/**
 * Optional term-meta to pull alongside the taxonomy term. Maps a result alias
 * (the key set on each TaxonomyTerm) to the wp_termmeta meta_key to fetch.
 */
type TermMetaMap = Record<string, string>;

// Brand terms carry a manufacturer website + product-URL template in termmeta.
const BRAND_META: TermMetaMap = {
  website: 'maleq_brand_website',
  productUrlTemplate: 'maleq_brand_product_url_template',
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function encodeId(prefix: string, id: number): string {
  return Buffer.from(`${prefix}:${id}`).toString('base64');
}

// ─── Generic taxonomy loader ───

interface TaxonomyCache {
  data: TaxonomyTerm[];
  time: number;
}

const taxonomyCaches = new Map<string, TaxonomyCache>();

async function loadTaxonomy(
  taxonomy: string,
  metaMap?: TermMetaMap
): Promise<TaxonomyTerm[]> {
  const cached = taxonomyCaches.get(taxonomy);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  const pool = await getPoolAsync();

  // Build optional LEFT JOINs onto wp_termmeta — one join per requested meta
  // key — so each term carries its meta values as aliased columns.
  const metaEntries = metaMap ? Object.entries(metaMap) : [];
  const metaSelects = metaEntries
    .map(([alias], i) => `, tm${i}.meta_value AS \`${alias}\``)
    .join('');
  const metaJoins = metaEntries
    .map(
      ([, metaKey], i) =>
        `LEFT JOIN wp_termmeta tm${i} ON tm${i}.term_id = t.term_id AND tm${i}.meta_key = ${pool.escape(metaKey)}`
    )
    .join('\n    ');

  const [rows] = await pool.query<DbTaxonomyTerm[]>(`
    SELECT
      t.term_id,
      t.name,
      t.slug,
      tt.description,
      tt.count${metaSelects}
    FROM wp_term_taxonomy tt
    JOIN wp_terms t ON tt.term_id = t.term_id
    ${metaJoins}
    WHERE tt.taxonomy = ? AND tt.count > 0
    ORDER BY t.name
  `, [taxonomy]);

  const result: TaxonomyTerm[] = rows.map(row => {
    const term: TaxonomyTerm = {
      id: encodeId('term', row.term_id),
      name: row.name,
      slug: row.slug,
      count: row.count,
      description: row.description || null,
    };
    for (const [alias] of metaEntries) {
      const value = row[alias];
      (term as unknown as Record<string, unknown>)[alias] =
        typeof value === 'string' && value.length > 0 ? value : null;
    }
    return term;
  });

  taxonomyCaches.set(taxonomy, { data: result, time: Date.now() });
  return result;
}

async function loadTaxonomyTermBySlug(
  taxonomy: string,
  slug: string,
  metaMap?: TermMetaMap
): Promise<TaxonomyTerm | null> {
  // Try cache first
  const cached = taxonomyCaches.get(taxonomy);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data.find(t => t.slug === slug) ?? null;
  }

  // Load all and search (populates cache for future lookups)
  const all = await loadTaxonomy(taxonomy, metaMap);
  return all.find(t => t.slug === slug) ?? null;
}

// ─── Public API ───

export async function loadBrands(): Promise<TaxonomyTerm[]> {
  return loadTaxonomy('product_brand', BRAND_META);
}

export async function loadBrandBySlug(slug: string): Promise<TaxonomyTerm | null> {
  return loadTaxonomyTermBySlug('product_brand', slug, BRAND_META);
}

export async function loadMaterials(): Promise<TaxonomyTerm[]> {
  return loadTaxonomy('product_material');
}

export async function loadColors(): Promise<TaxonomyTerm[]> {
  return loadTaxonomy('pa_color');
}

export function invalidateTaxonomyCache(taxonomy?: string): void {
  if (taxonomy) {
    taxonomyCaches.delete(taxonomy);
  } else {
    taxonomyCaches.clear();
  }
}
