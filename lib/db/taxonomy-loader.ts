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
}

interface TaxonomyTerm {
  id: string;
  name: string;
  slug: string;
  count: number;
  description?: string | null;
}

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

async function loadTaxonomy(taxonomy: string): Promise<TaxonomyTerm[]> {
  const cached = taxonomyCaches.get(taxonomy);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  const pool = await getPoolAsync();

  const [rows] = await pool.query<DbTaxonomyTerm[]>(`
    SELECT
      t.term_id,
      t.name,
      t.slug,
      tt.description,
      tt.count
    FROM wp_term_taxonomy tt
    JOIN wp_terms t ON tt.term_id = t.term_id
    WHERE tt.taxonomy = ? AND tt.count > 0
    ORDER BY t.name
  `, [taxonomy]);

  const result: TaxonomyTerm[] = rows.map(row => ({
    id: encodeId('term', row.term_id),
    name: row.name,
    slug: row.slug,
    count: row.count,
    description: row.description || null,
  }));

  taxonomyCaches.set(taxonomy, { data: result, time: Date.now() });
  return result;
}

async function loadTaxonomyTermBySlug(
  taxonomy: string,
  slug: string
): Promise<TaxonomyTerm | null> {
  // Try cache first
  const cached = taxonomyCaches.get(taxonomy);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data.find(t => t.slug === slug) ?? null;
  }

  // Load all and search (populates cache for future lookups)
  const all = await loadTaxonomy(taxonomy);
  return all.find(t => t.slug === slug) ?? null;
}

// ─── Public API ───

export async function loadBrands(): Promise<TaxonomyTerm[]> {
  return loadTaxonomy('product_brand');
}

export async function loadBrandBySlug(slug: string): Promise<TaxonomyTerm | null> {
  return loadTaxonomyTermBySlug('product_brand', slug);
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
