/**
 * Loads lightweight product data from MySQL for the in-memory index.
 *
 * Three parallel queries plus a follow-up:
 * 1. Products + wp_wc_product_meta_lookup
 * 2. Postmeta scalars (_thumbnail_id, _view_count, _regular_price, _sale_price)
 *    — filtered by meta_key first so the (meta_key) index drives the scan
 * 3. Taxonomy relationships (categories, brands, materials, colors, product_type)
 * Then a PK lookup on wp_posts for thumbnail attachments.
 *
 * Replaces an earlier single-query version that LEFT JOIN'd wp_postmeta four
 * times — that plan examined ~3.7M rows to return 35K and ran ~15s.
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
  volumeSlugs: string[];
  lengthSlugs: string[];
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
}

interface RawPostmeta extends RowDataPacket {
  post_id: number;
  meta_key: string;
  meta_value: string | null;
}

interface RawAttachment extends RowDataPacket {
  ID: number;
  guid: string | null;
  post_title: string | null;
  post_excerpt: string | null;
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

  const PRODUCT_FILTER = `p.post_type = 'product' AND p.post_status = 'publish'`;

  const [productsResult, postmetaResult, taxonomiesResult] = await Promise.all([
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
        lk.total_sales
      FROM wp_posts p
      LEFT JOIN wp_wc_product_meta_lookup lk ON lk.product_id = p.ID
      WHERE ${PRODUCT_FILTER}
    `),
    pool.query<RawPostmeta[]>(`
      SELECT pm.post_id, pm.meta_key, pm.meta_value
      FROM wp_postmeta pm
      INNER JOIN wp_posts p ON p.ID = pm.post_id
      WHERE pm.meta_key IN ('_thumbnail_id','_view_count','_regular_price','_sale_price')
        AND ${PRODUCT_FILTER}
    `),
    pool.query<RawTaxonomy[]>(`
      SELECT tr.object_id, tt.taxonomy, t.term_id, t.name, t.slug
      FROM wp_term_relationships tr
      JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
      JOIN wp_terms t ON tt.term_id = t.term_id
      INNER JOIN wp_posts p ON tr.object_id = p.ID
      WHERE ${PRODUCT_FILTER}
        AND tt.taxonomy IN ('product_cat','product_brand','product_material','pa_color','pa_volume','pa_length','product_type')
    `),
  ]);

  const products = productsResult[0];
  const postmetaRows = postmetaResult[0];
  const taxonomies = taxonomiesResult[0];

  // Pivot postmeta to per-product scalar lookup
  type PostmetaScalars = {
    thumbId: number | null;
    viewCount: string | null;
    regularPrice: string | null;
    salePrice: string | null;
  };
  const postmetaByProduct = new Map<number, PostmetaScalars>();
  for (const row of postmetaRows) {
    let entry = postmetaByProduct.get(row.post_id);
    if (!entry) {
      entry = { thumbId: null, viewCount: null, regularPrice: null, salePrice: null };
      postmetaByProduct.set(row.post_id, entry);
    }
    switch (row.meta_key) {
      case '_thumbnail_id': {
        const id = row.meta_value ? parseInt(row.meta_value, 10) : NaN;
        entry.thumbId = Number.isFinite(id) ? id : null;
        break;
      }
      case '_view_count':
        entry.viewCount = row.meta_value;
        break;
      case '_regular_price':
        entry.regularPrice = row.meta_value;
        break;
      case '_sale_price':
        entry.salePrice = row.meta_value;
        break;
    }
  }

  // Fetch thumbnail attachments by PK (fast index lookup)
  const thumbIds = Array.from(postmetaByProduct.values())
    .map((p) => p.thumbId)
    .filter((id): id is number => id !== null);
  const attachmentMap = new Map<number, RawAttachment>();
  if (thumbIds.length > 0) {
    const [attachmentsResult] = await pool.query<RawAttachment[]>(
      `SELECT ID, guid, post_title, post_excerpt FROM wp_posts WHERE ID IN (?)`,
      [thumbIds],
    );
    for (const att of attachmentsResult) {
      attachmentMap.set(att.ID, att);
    }
  }

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
    const volumeSlugs: string[] = [];
    const lengthSlugs: string[] = [];
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
        case 'pa_volume':
          volumeSlugs.push(tax.slug);
          break;
        case 'pa_length':
          lengthSlugs.push(tax.slug);
          break;
        case 'product_type':
          productType = TYPE_MAP[tax.slug] || 'SIMPLE';
          break;
      }
    }

    const meta = postmetaByProduct.get(p.ID);
    const attachment = meta?.thumbId !== null && meta?.thumbId !== undefined
      ? attachmentMap.get(meta.thumbId)
      : undefined;

    const viewCount = meta?.viewCount ? parseInt(meta.viewCount, 10) || 0 : 0;
    const reviewCount = Number(p.rating_count) || 0;
    const averageRating = Number(p.average_rating) || 0;
    const totalSales = Number(p.total_sales) || 0;

    // MySQL DECIMAL comes back as string — coerce to number
    const minPrice = p.min_price !== null ? Number(p.min_price) || null : null;
    const maxPrice = p.max_price !== null ? Number(p.max_price) || null : null;
    const regPrice = meta?.regularPrice ? parseFloat(meta.regularPrice) : null;
    const salPrice = meta?.salePrice ? parseFloat(meta.salePrice) : null;

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
      volumeSlugs,
      lengthSlugs,
      imageUrl: attachment?.guid || null,
      imageAlt: attachment?.post_excerpt || attachment?.post_title || p.post_title,
      type: productType,
      averageRating,
      reviewCount,
      viewCount,
      popularityScore: viewCount + totalSales * 10 + reviewCount * 10,
    };
  }

  return entries;
}
