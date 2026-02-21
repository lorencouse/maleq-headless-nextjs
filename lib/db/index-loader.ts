/**
 * Loads lightweight product data from MySQL for the in-memory index.
 *
 * Two queries total:
 * 1. Products + wp_wc_product_meta_lookup (WooCommerce denormalized table) + thumbnail
 * 2. Taxonomy relationships (categories, brands, materials, colors, product_type)
 *
 * Returns ~31K ProductIndexEntry items (~15-20 MB in memory).
 */
import { getPoolAsync } from './pool';
import type { RowDataPacket } from 'mysql2';

export interface ProductIndexEntry {
  id: number;
  slug: string;
  name: string;
  price: number | null;
  maxPrice: number | null;
  regularPrice: number | null;
  salePrice: number | null;
  onSale: boolean;
  stockStatus: string;       // 'IN_STOCK' | 'OUT_OF_STOCK' | 'ON_BACKORDER'
  categoryIds: number[];
  categorySlugs: string[];
  categoryNames: string[];
  brandSlug: string | null;
  brandName: string | null;
  materialSlug: string | null;
  materialName: string | null;
  colorSlugs: string[];
  imageUrl: string | null;
  imageAlt: string | null;
  type: string;              // 'SIMPLE' | 'VARIABLE' | 'GROUPED' | 'EXTERNAL'
  averageRating: number;
  reviewCount: number;
  viewCount: number;
  popularityScore: number;
}

interface RawProduct extends RowDataPacket {
  ID: number;
  post_name: string;
  post_title: string;
  min_price: number | null;
  max_price: number | null;
  onsale: number;
  stock_status: string | null;
  average_rating: number | null;
  rating_count: number | null;
  total_sales: number | null;
  thumb_url: string | null;
  thumb_title: string | null;
  thumb_excerpt: string | null;
  view_count: string | null;
  regular_price: string | null;
  sale_price: string | null;
}

interface RawTaxonomy extends RowDataPacket {
  object_id: number;
  taxonomy: string;
  term_id: number;
  name: string;
  slug: string;
}

const STOCK_MAP: Record<string, string> = {
  instock: 'IN_STOCK',
  outofstock: 'OUT_OF_STOCK',
  onbackorder: 'ON_BACKORDER',
};

const TYPE_MAP: Record<string, string> = {
  simple: 'SIMPLE',
  variable: 'VARIABLE',
  grouped: 'GROUPED',
  external: 'EXTERNAL',
};

export async function loadProductIndex(): Promise<ProductIndexEntry[]> {
  const pool = await getPoolAsync();

  const [productsResult, taxonomiesResult] = await Promise.all([
    pool.query<RawProduct[]>(`
      SELECT
        p.ID,
        p.post_name,
        p.post_title,
        lk.min_price,
        lk.max_price,
        lk.onsale,
        lk.stock_status,
        lk.average_rating,
        lk.rating_count,
        lk.total_sales,
        att.guid AS thumb_url,
        att.post_title AS thumb_title,
        att.post_excerpt AS thumb_excerpt,
        vc.meta_value AS view_count,
        rp.meta_value AS regular_price,
        sp.meta_value AS sale_price
      FROM wp_posts p
      LEFT JOIN wp_wc_product_meta_lookup lk ON lk.product_id = p.ID
      LEFT JOIN wp_postmeta tm ON tm.post_id = p.ID AND tm.meta_key = '_thumbnail_id'
      LEFT JOIN wp_posts att ON att.ID = CAST(tm.meta_value AS UNSIGNED)
      LEFT JOIN wp_postmeta vc ON vc.post_id = p.ID AND vc.meta_key = '_view_count'
      LEFT JOIN wp_postmeta rp ON rp.post_id = p.ID AND rp.meta_key = '_regular_price'
      LEFT JOIN wp_postmeta sp ON sp.post_id = p.ID AND sp.meta_key = '_sale_price'
      WHERE p.post_type = 'product' AND p.post_status = 'publish'
    `),
    pool.query<RawTaxonomy[]>(`
      SELECT tr.object_id, tt.taxonomy, t.term_id, t.name, t.slug
      FROM wp_term_relationships tr
      JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
      JOIN wp_terms t ON tt.term_id = t.term_id
      INNER JOIN wp_posts p ON tr.object_id = p.ID
      WHERE p.post_type = 'product' AND p.post_status = 'publish'
        AND tt.taxonomy IN ('product_cat','product_brand','product_material','pa_color','product_type')
    `),
  ]);

  const products = productsResult[0];
  const taxonomies = taxonomiesResult[0];

  // Build taxonomy lookup: productId -> taxonomy[]
  const taxMap = new Map<number, RawTaxonomy[]>();
  for (const row of taxonomies) {
    const list = taxMap.get(row.object_id);
    if (list) {
      list.push(row);
    } else {
      taxMap.set(row.object_id, [row]);
    }
  }

  // Assemble index entries
  const entries: ProductIndexEntry[] = new Array(products.length);
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const taxes = taxMap.get(p.ID) || [];

    const categoryIds: number[] = [];
    const categorySlugs: string[] = [];
    const categoryNames: string[] = [];
    let brandSlug: string | null = null;
    let brandName: string | null = null;
    let materialSlug: string | null = null;
    let materialName: string | null = null;
    const colorSlugs: string[] = [];
    let productType = 'SIMPLE';

    for (const tax of taxes) {
      switch (tax.taxonomy) {
        case 'product_cat':
          categoryIds.push(tax.term_id);
          categorySlugs.push(tax.slug);
          categoryNames.push(tax.name);
          break;
        case 'product_brand':
          brandSlug = tax.slug;
          brandName = tax.name;
          break;
        case 'product_material':
          materialSlug = tax.slug;
          materialName = tax.name;
          break;
        case 'pa_color':
          colorSlugs.push(tax.slug);
          break;
        case 'product_type':
          productType = TYPE_MAP[tax.slug] || 'SIMPLE';
          break;
      }
    }

    const viewCount = p.view_count ? parseInt(p.view_count, 10) || 0 : 0;
    const reviewCount = Number(p.rating_count) || 0;
    const averageRating = Number(p.average_rating) || 0;
    const totalSales = Number(p.total_sales) || 0;

    // MySQL DECIMAL comes back as string — coerce to number
    const minPrice = p.min_price !== null ? Number(p.min_price) || null : null;
    const maxPrice = p.max_price !== null ? Number(p.max_price) || null : null;
    const regPrice = p.regular_price ? parseFloat(p.regular_price) : null;
    const salPrice = p.sale_price ? parseFloat(p.sale_price) : null;

    // Compute onSale from actual prices (more reliable than lookup table flag)
    const isOnSale = !!(salPrice && regPrice && salPrice < regPrice);

    entries[i] = {
      id: p.ID,
      slug: p.post_name,
      name: p.post_title,
      price: minPrice,
      maxPrice,
      regularPrice: regPrice !== null && !isNaN(regPrice) ? regPrice : minPrice,
      salePrice: isOnSale ? salPrice : null,
      onSale: isOnSale,
      stockStatus: STOCK_MAP[p.stock_status || 'outofstock'] || 'OUT_OF_STOCK',
      categoryIds,
      categorySlugs,
      categoryNames,
      brandSlug,
      brandName,
      materialSlug,
      materialName,
      colorSlugs,
      imageUrl: p.thumb_url || null,
      imageAlt: p.thumb_excerpt || p.thumb_title || p.post_title,
      type: productType,
      averageRating,
      reviewCount,
      viewCount,
      popularityScore: viewCount + totalSales * 10 + reviewCount * 10,
    };
  }

  return entries;
}
