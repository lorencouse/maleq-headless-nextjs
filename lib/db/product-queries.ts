/**
 * Full product fetch from MySQL by slug.
 *
 * Returns an EnhancedProduct with all fields needed for the product detail page,
 * including variations, gallery, specifications, etc.
 */
import { getPool } from './pool';
import type { RowDataPacket } from 'mysql2';
import { parseProductAttributes, phpUnserialize } from '@/lib/utils/php-unserialize';
import { extractSpecifications } from '@/lib/products/specifications';
import { formatAttributeName } from '@/lib/utils/woocommerce-format';
import type { EnhancedProduct, ProductVariation } from '@/lib/products/product-service';

// ─── DB Row Types ───

interface DbProduct extends RowDataPacket {
  ID: number;
  post_title: string;
  post_name: string;
  post_content: string;
  post_excerpt: string;
}

interface DbMeta extends RowDataPacket {
  sku: string | null;
  price: string | null;
  regular_price: string | null;
  sale_price: string | null;
  stock_status: string | null;
  stock_qty: string | null;
  weight: string | null;
  length_val: string | null;
  width_val: string | null;
  height_val: string | null;
  thumbnail_id: string | null;
  gallery_ids: string | null;
  attributes_ser: string | null;
  purchase_note: string | null;
  featured: string | null;
  external_url: string | null;
  button_text: string | null;
  default_attributes_ser: string | null;
}

interface DbTaxonomy extends RowDataPacket {
  taxonomy: string;
  term_id: number;
  name: string;
  slug: string;
}

interface DbAttachment extends RowDataPacket {
  ID: number;
  guid: string;
  post_title: string;
  post_excerpt: string;
}

interface DbVariation extends RowDataPacket {
  ID: number;
  post_title: string;
  post_name: string;
  post_content: string;
}

interface DbVariationMeta extends RowDataPacket {
  post_id: number;
  sku: string | null;
  price: string | null;
  regular_price: string | null;
  sale_price: string | null;
  stock_status: string | null;
  stock_qty: string | null;
  weight: string | null;
  length_val: string | null;
  width_val: string | null;
  height_val: string | null;
  thumbnail_id: string | null;
}

interface DbVariationAttr extends RowDataPacket {
  post_id: number;
  meta_key: string;
  meta_value: string;
}

interface DbReview extends RowDataPacket {
  average_rating: number;
  rating_count: number;
}

// ─── Constants ───

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

function formatDbPrice(val: string | null | undefined): string | null {
  if (!val || val === '') return null;
  const num = parseFloat(val);
  if (isNaN(num)) return null;
  return `$${num.toFixed(2)}`;
}

function encodeId(prefix: string, id: number): string {
  return Buffer.from(`${prefix}:${id}`).toString('base64');
}

// ─── Main Query ───

export async function getProductBySlugFromDB(slug: string): Promise<EnhancedProduct | null> {
  const pool = getPool();

  // Round 1: Fetch product post + meta + taxonomies + variations + reviews in parallel
  // We use a subquery to get the product ID once, then fan out all related queries
  const [productRows, metaRows, taxRows, variationRows, reviewRows] = await Promise.all([
    // Product post
    pool.query<DbProduct[]>(
      `SELECT ID, post_title, post_name, post_content, post_excerpt
       FROM wp_posts
       WHERE post_type = 'product' AND post_status = 'publish' AND post_name = ?
       LIMIT 1`,
      [slug]
    ),
    // Product meta (pivoted) — uses subquery to avoid sequential round-trip
    pool.query<DbMeta[]>(
      `SELECT
        MAX(CASE WHEN meta_key = '_sku' THEN meta_value END) AS sku,
        MAX(CASE WHEN meta_key = '_price' THEN meta_value END) AS price,
        MAX(CASE WHEN meta_key = '_regular_price' THEN meta_value END) AS regular_price,
        MAX(CASE WHEN meta_key = '_sale_price' THEN meta_value END) AS sale_price,
        MAX(CASE WHEN meta_key = '_stock_status' THEN meta_value END) AS stock_status,
        MAX(CASE WHEN meta_key = '_stock' THEN meta_value END) AS stock_qty,
        MAX(CASE WHEN meta_key = '_weight' THEN meta_value END) AS weight,
        MAX(CASE WHEN meta_key = '_length' THEN meta_value END) AS length_val,
        MAX(CASE WHEN meta_key = '_width' THEN meta_value END) AS width_val,
        MAX(CASE WHEN meta_key = '_height' THEN meta_value END) AS height_val,
        MAX(CASE WHEN meta_key = '_thumbnail_id' THEN meta_value END) AS thumbnail_id,
        MAX(CASE WHEN meta_key = '_product_image_gallery' THEN meta_value END) AS gallery_ids,
        MAX(CASE WHEN meta_key = '_product_attributes' THEN meta_value END) AS attributes_ser,
        MAX(CASE WHEN meta_key = '_purchase_note' THEN meta_value END) AS purchase_note,
        MAX(CASE WHEN meta_key = '_featured' THEN meta_value END) AS featured,
        MAX(CASE WHEN meta_key = '_product_url' THEN meta_value END) AS external_url,
        MAX(CASE WHEN meta_key = '_button_text' THEN meta_value END) AS button_text,
        MAX(CASE WHEN meta_key = '_default_attributes' THEN meta_value END) AS default_attributes_ser
       FROM wp_postmeta
       WHERE post_id = (SELECT ID FROM wp_posts WHERE post_type = 'product' AND post_status = 'publish' AND post_name = ? LIMIT 1)
         AND meta_key IN ('_sku','_price','_regular_price','_sale_price','_stock_status','_stock',
           '_weight','_length','_width','_height','_thumbnail_id','_product_image_gallery',
           '_product_attributes','_purchase_note','_featured','_product_url','_button_text',
           '_default_attributes')`,
      [slug]
    ),
    // Taxonomies
    pool.query<DbTaxonomy[]>(
      `SELECT tt.taxonomy, t.term_id, t.name, t.slug
       FROM wp_term_relationships tr
       JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
       JOIN wp_terms t ON tt.term_id = t.term_id
       WHERE tr.object_id = (SELECT ID FROM wp_posts WHERE post_type = 'product' AND post_status = 'publish' AND post_name = ? LIMIT 1)
         AND tt.taxonomy IN ('product_cat','product_tag','product_brand','product_material','product_type','product_visibility','pa_color')`,
      [slug]
    ),
    // Variations
    pool.query<DbVariation[]>(
      `SELECT ID, post_title, post_name, post_content
       FROM wp_posts
       WHERE post_type = 'product_variation' AND post_status = 'publish'
         AND post_parent = (SELECT ID FROM wp_posts WHERE post_type = 'product' AND post_status = 'publish' AND post_name = ? LIMIT 1)`,
      [slug]
    ),
    // Reviews (from WooCommerce lookup table)
    pool.query<DbReview[]>(
      `SELECT average_rating, rating_count
       FROM wp_wc_product_meta_lookup
       WHERE product_id = (SELECT ID FROM wp_posts WHERE post_type = 'product' AND post_status = 'publish' AND post_name = ? LIMIT 1)`,
      [slug]
    ),
  ]);

  if (!productRows[0].length) return null;
  const product = productRows[0][0];
  const productId = product.ID;

  const meta = metaRows[0]?.[0] || {} as DbMeta;
  const taxes = taxRows[0] as DbTaxonomy[];
  const variations = variationRows[0] as DbVariation[];
  const review = reviewRows[0]?.[0] as DbReview | undefined;

  // Collect parent product attachment IDs (known from meta already)
  const attachmentIds = new Set<number>();
  if (meta.thumbnail_id) attachmentIds.add(parseInt(meta.thumbnail_id, 10));
  if (meta.gallery_ids) {
    meta.gallery_ids.split(',').forEach(id => {
      const n = parseInt(id.trim(), 10);
      if (n) attachmentIds.add(n);
    });
  }

  // Round 2: Fetch variation meta/attrs AND parent attachments in parallel
  const varMetaMap = new Map<number, DbVariationMeta>();
  const varAttrMap = new Map<number, DbVariationAttr[]>();

  if (variations.length > 0) {
    const varIds = variations.map(v => v.ID);
    const placeholders = varIds.map(() => '?').join(',');

    const [varMetaRows, varAttrRows] = await Promise.all([
      pool.query<DbVariationMeta[]>(
        `SELECT post_id,
          MAX(CASE WHEN meta_key = '_sku' THEN meta_value END) AS sku,
          MAX(CASE WHEN meta_key = '_price' THEN meta_value END) AS price,
          MAX(CASE WHEN meta_key = '_regular_price' THEN meta_value END) AS regular_price,
          MAX(CASE WHEN meta_key = '_sale_price' THEN meta_value END) AS sale_price,
          MAX(CASE WHEN meta_key = '_stock_status' THEN meta_value END) AS stock_status,
          MAX(CASE WHEN meta_key = '_stock' THEN meta_value END) AS stock_qty,
          MAX(CASE WHEN meta_key = '_weight' THEN meta_value END) AS weight,
          MAX(CASE WHEN meta_key = '_length' THEN meta_value END) AS length_val,
          MAX(CASE WHEN meta_key = '_width' THEN meta_value END) AS width_val,
          MAX(CASE WHEN meta_key = '_height' THEN meta_value END) AS height_val,
          MAX(CASE WHEN meta_key = '_thumbnail_id' THEN meta_value END) AS thumbnail_id
         FROM wp_postmeta
         WHERE post_id IN (${placeholders})
           AND meta_key IN ('_sku','_price','_regular_price','_sale_price','_stock_status','_stock',
             '_weight','_length','_width','_height','_thumbnail_id')
         GROUP BY post_id`,
        varIds
      ),
      pool.query<DbVariationAttr[]>(
        `SELECT post_id, meta_key, meta_value
         FROM wp_postmeta
         WHERE post_id IN (${placeholders})
           AND meta_key LIKE 'attribute_%'`,
        varIds
      ),
    ]);

    for (const row of varMetaRows[0] as DbVariationMeta[]) {
      varMetaMap.set(row.post_id, row);
    }
    for (const row of varAttrRows[0] as DbVariationAttr[]) {
      const list = varAttrMap.get(row.post_id) || [];
      list.push(row);
      varAttrMap.set(row.post_id, list);
    }

    // Add variation thumbnail IDs to attachment set
    for (const [, vMeta] of varMetaMap) {
      if (vMeta.thumbnail_id) attachmentIds.add(parseInt(vMeta.thumbnail_id, 10));
    }
  }

  // Round 3 (only if needed): Fetch all attachment images
  const attachments = new Map<number, DbAttachment>();
  if (attachmentIds.size > 0) {
    const attIds = Array.from(attachmentIds);
    const attPlaceholders = attIds.map(() => '?').join(',');
    const [attRows] = await pool.query<DbAttachment[]>(
      `SELECT ID, guid, post_title, post_excerpt
       FROM wp_posts WHERE ID IN (${attPlaceholders})`,
      attIds
    );
    for (const row of attRows as DbAttachment[]) {
      attachments.set(row.ID, row);
    }
  }

  // Assembly
  const typeTax = taxes.find(t => t.taxonomy === 'product_type');
  const productType = TYPE_MAP[typeTax?.slug || 'simple'] || 'SIMPLE';
  const isVariable = productType === 'VARIABLE';
  const isFeatured = taxes.some(t => t.taxonomy === 'product_visibility' && t.slug === 'featured');

  const stockStatus = STOCK_MAP[meta.stock_status || 'outofstock'] || 'OUT_OF_STOCK';
  const stockQuantity = meta.stock_qty ? parseInt(meta.stock_qty, 10) : null;

  const categories = taxes
    .filter(t => t.taxonomy === 'product_cat')
    .map(t => ({ id: encodeId('term', t.term_id), name: t.name, slug: t.slug }));
  const tags = taxes
    .filter(t => t.taxonomy === 'product_tag')
    .map(t => ({ id: encodeId('term', t.term_id), name: t.name, slug: t.slug }));
  const brands = taxes
    .filter(t => t.taxonomy === 'product_brand')
    .map(t => ({ id: encodeId('term', t.term_id), name: t.name, slug: t.slug }));
  const materialsList = taxes
    .filter(t => t.taxonomy === 'product_material')
    .map(t => ({ id: encodeId('term', t.term_id), name: t.name, slug: t.slug }));

  // Resolve images
  function resolveImage(thumbId: string | null | undefined) {
    if (!thumbId) return null;
    const att = attachments.get(parseInt(thumbId, 10));
    if (!att) return null;
    return { id: encodeId('post', att.ID), url: att.guid, altText: att.post_excerpt || att.post_title || product.post_title };
  }

  const primaryImage = resolveImage(meta.thumbnail_id);
  const galleryIds = (meta.gallery_ids || '').split(',').map(id => id.trim()).filter(Boolean);
  const galleryImages = galleryIds
    .map(gid => {
      const att = attachments.get(parseInt(gid, 10));
      if (!att) return null;
      return { url: att.guid, altText: att.post_excerpt || att.post_title || product.post_title };
    })
    .filter((img): img is NonNullable<typeof img> => img !== null);

  const gallery = [
    ...(primaryImage ? [{ id: primaryImage.id, url: primaryImage.url, altText: primaryImage.altText, isPrimary: true }] : []),
    ...galleryIds
      .map(gid => {
        const att = attachments.get(parseInt(gid, 10));
        if (!att) return null;
        return { id: encodeId('post', att.ID), url: att.guid, altText: att.post_excerpt || att.post_title || product.post_title, isPrimary: false };
      })
      .filter((img): img is NonNullable<typeof img> => img !== null),
  ];

  // Attributes
  const parsedAttrs = meta.attributes_ser ? parseProductAttributes(meta.attributes_ser) : [];
  const termsByTaxonomy = new Map<string, string[]>();
  for (const tax of taxes) {
    if (tax.taxonomy.startsWith('pa_')) {
      const list = termsByTaxonomy.get(tax.taxonomy) || [];
      list.push(tax.name);
      termsByTaxonomy.set(tax.taxonomy, list);
    }
  }

  const attributes = parsedAttrs.map(attr => {
    let options: string[];
    if (attr.isTaxonomy) {
      options = termsByTaxonomy.get(attr.name) || [];
    } else {
      options = attr.value.split(/\s*\|\s*/).map(o => o.trim()).filter(o => o.length > 0);
    }
    return { name: attr.name, options, visible: attr.isVisible, variation: attr.isVariation };
  });

  // Assemble variations
  const assembledVariations: ProductVariation[] = variations.map(v => {
    const vMeta = varMetaMap.get(v.ID);
    const vAttrs = varAttrMap.get(v.ID) || [];
    const vImage = resolveImage(vMeta?.thumbnail_id || null);

    return {
      id: encodeId('product', v.ID),
      databaseId: v.ID,
      name: v.post_title,
      sku: vMeta?.sku || null,
      description: v.post_content || null,
      price: formatDbPrice(vMeta?.price) || null,
      regularPrice: formatDbPrice(vMeta?.regular_price) || null,
      salePrice: formatDbPrice(vMeta?.sale_price) || null,
      stockStatus: STOCK_MAP[vMeta?.stock_status || 'outofstock'] || 'OUT_OF_STOCK',
      stockQuantity: vMeta?.stock_qty ? parseInt(vMeta.stock_qty, 10) : null,
      weight: vMeta?.weight || null,
      length: vMeta?.length_val || null,
      width: vMeta?.width_val || null,
      height: vMeta?.height_val || null,
      attributes: vAttrs.map(a => ({
        name: formatAttributeName(a.meta_key.replace('attribute_', '')),
        value: a.meta_value,
      })),
      image: vImage ? { url: vImage.url, altText: vImage.altText } : null,
    };
  });

  // Compute price for variable products
  let price = formatDbPrice(meta.price);
  const regularPrice = formatDbPrice(meta.regular_price);
  const salePrice = formatDbPrice(meta.sale_price);

  if (isVariable && assembledVariations.length > 0) {
    const prices = assembledVariations
      .map(v => v.price)
      .filter((p): p is string => p !== null)
      .map(p => parseFloat(p.replace('$', '')))
      .filter(n => !isNaN(n));
    if (prices.length > 0) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      price = min === max ? `$${min.toFixed(2)}` : `$${min.toFixed(2)} - $${max.toFixed(2)}`;
    }
  }

  const onSale = !!(
    salePrice &&
    regularPrice &&
    parseFloat(salePrice.replace('$', '')) < parseFloat(regularPrice.replace('$', ''))
  );

  const specifications = extractSpecifications(
    {
      sku: meta.sku || null,
      weight: meta.weight || null,
      length: meta.length_val || null,
      width: meta.width_val || null,
      height: meta.height_val || null,
      stockStatus,
      stockQuantity,
      brands,
      categories,
      tags,
      attributes,
    },
    isVariable
  );

  // Parse default attributes (serialized PHP: a:1:{s:7:"pa_size";s:4:"4-oz";})
  let defaultAttributes: { name: string; value: string }[] | undefined;
  if (meta.default_attributes_ser) {
    const parsed = phpUnserialize(meta.default_attributes_ser);
    if (parsed && typeof parsed === 'object') {
      defaultAttributes = Object.entries(parsed as Record<string, string>)
        .filter(([, v]) => typeof v === 'string' && v.length > 0)
        .map(([key, value]) => ({
          name: formatAttributeName(key),
          value: value as string,
        }));
    }
  }

  return {
    id: encodeId('post', product.ID),
    databaseId: product.ID,
    name: product.post_title,
    slug: product.post_name,
    description: product.post_content || null,
    shortDescription: product.post_excerpt || null,
    sku: meta.sku || null,
    price,
    regularPrice,
    salePrice,
    onSale,
    stockStatus,
    stockQuantity,
    weight: meta.weight || null,
    length: meta.length_val || null,
    width: meta.width_val || null,
    height: meta.height_val || null,
    image: primaryImage ? { url: primaryImage.url, altText: primaryImage.altText } : null,
    galleryImages: galleryImages.length > 0 ? galleryImages : undefined,
    categories,
    tags: tags.length > 0 ? tags : undefined,
    brands,
    materials: materialsList.length > 0 ? materialsList : undefined,
    type: productType,
    averageRating: Number(review?.average_rating) || 0,
    reviewCount: Number(review?.rating_count) || 0,
    viewCount: 0,
    popularityScore: 0,
    attributes: attributes.length > 0 ? attributes : undefined,
    variations: assembledVariations.length > 0 ? assembledVariations : undefined,
    specifications,
    gallery,
    dimensions: {
      weight: meta.weight || null,
      length: meta.length_val || null,
      width: meta.width_val || null,
      height: meta.height_val || null,
    },
    featured: isFeatured,
    purchaseNote: meta.purchase_note || null,
    externalUrl: meta.external_url || null,
    buttonText: meta.button_text || null,
    defaultAttributes,
  };
}
