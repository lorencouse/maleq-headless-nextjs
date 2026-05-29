/**
 * SQL-backed Gutenberg content renderer.
 *
 * Why this exists: guide pages used WPGraphQL ONLY to get post content run
 * through WordPress's `do_blocks`/`do_shortcode` pipeline. That pipeline is
 * non-deterministic on our setup — WPGraphQL intermittently returns the RAW,
 * un-rendered editor content (Gutenberg reusable blocks left as bare
 * `<!-- wp:block {"ref":N} /-->` comments, shortcodes left literal). When an
 * ISR prerender captured that un-rendered form, the reusable blocks rendered to
 * nothing and the inline add-to-cart buttons vanished — the "buttons disappear
 * on hard refresh" bug.
 *
 * For our guide content the only dynamic pieces are:
 *   1. Reusable blocks (`wp:block` refs) — just stored content in `wp_block`
 *      posts; expand them with a SQL lookup.
 *   2. `[add_to_cart …]` shortcodes — already converted to client-mounted
 *      placeholders by rewriteWordPressUrls(); we only need to normalise the
 *      `sku=` form to the `id=` form (SKU → product ID via SQL).
 * Everything else is STATIC Gutenberg markup whose saved HTML *is* its rendered
 * output, so `do_blocks` for it is equivalent to stripping the delimiter
 * comments. That makes a deterministic SQL render possible and lets GraphQL
 * drop to a last-resort fallback (per the project's SQL-first rule).
 *
 * If a post turns out to contain a genuinely dynamic Gutenberg block we cannot
 * faithfully flatten (see UNSUPPORTED_DYNAMIC_BLOCK), `needsFallback` is set so
 * the caller can defer to GraphQL `do_blocks` for that one post.
 */
import { getPoolAsync } from './pool';
import type { RowDataPacket } from 'mysql2';

interface BlockRow extends RowDataPacket {
  ID: number;
  post_content: string;
}

interface TemplatePartRow extends RowDataPacket {
  post_name: string;
  post_content: string;
}

interface SkuRow extends RowDataPacket {
  post_id: number;
  meta_value: string;
}

/**
 * Allowlist of STATIC Gutenberg block types whose saved markup *is* their
 * rendered output — for these, `do_blocks` is equivalent to stripping the
 * delimiter comments. We render a post via SQL only when every block (after
 * reusable-block + template-part expansion) is in this set.
 *
 * Anything NOT listed (e.g. wp:latest-posts, wp:embed, wp:core-embed/*,
 * wp:rank-math/*, wp:query, future blocks) is generated at render time and
 * can't be flattened safely → defer that post to GraphQL's do_blocks. Using an
 * allowlist (not a denylist) is deliberately conservative and future-proof:
 * an unknown new block triggers the GraphQL fallback rather than mis-rendering.
 */
const STATIC_BLOCK_ALLOWLIST = new Set([
  'paragraph', 'heading', 'image', 'list', 'list-item', 'table', 'video',
  'separator', 'spacer', 'group', 'columns', 'column', 'quote', 'pullquote',
  'button', 'buttons', 'html', 'preformatted', 'code', 'gallery', 'cover',
  'media-text', 'details', 'verse', 'audio', 'file',
  'shortcode',        // [add_to_cart] etc. — handled downstream as placeholders
  'block',            // reusable block — expanded before this check
  'template-part',    // expanded before this check
]);

/** Matches a reusable-block reference: `<!-- wp:block {"ref":123} /-->`. */
const REUSABLE_BLOCK_REF = /<!--\s*wp:block\s+\{[^}]*?"ref"\s*:\s*(\d+)[^}]*\}\s*\/-->/g;

/** Matches a template-part reference: `<!-- wp:template-part {"slug":"x"} /-->`. */
const TEMPLATE_PART_REF = /<!--\s*wp:template-part\s+\{[^}]*?"slug"\s*:\s*"([^"]+)"[^}]*\}\s*\/-->/g;

/** Matches Gutenberg block delimiter comments (open or close, with attrs). */
const BLOCK_DELIMITER = /<!--\s*\/?wp:[\s\S]*?-->\n?/g;

/** Matches the opening of any Gutenberg block: captures the block type name. */
const BLOCK_TYPE = /<!--\s*wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)/gi;

/**
 * Recursively expand `wp:block` reusable-block references (by ID) and
 * `wp:template-part` references (by slug) by inlining the referenced post
 * content. Depth-guarded against reference cycles.
 */
export async function expandReferences(html: string, depth = 0): Promise<string> {
  if (depth > 6) return html;

  const refIds = Array.from(html.matchAll(REUSABLE_BLOCK_REF)).map((m) => parseInt(m[1], 10));
  const partSlugs = Array.from(html.matchAll(TEMPLATE_PART_REF)).map((m) => m[1]);
  if (refIds.length === 0 && partSlugs.length === 0) return html;

  const pool = await getPoolAsync();
  let out = html;

  if (refIds.length > 0) {
    const uniq = Array.from(new Set(refIds));
    const [rows] = await pool.query<BlockRow[]>(
      `SELECT ID, post_content FROM wp_posts
       WHERE ID IN (${uniq.map(() => '?').join(',')})
         AND post_type = 'wp_block' AND post_status = 'publish'`,
      uniq,
    );
    const byId = new Map(rows.map((r) => [r.ID, r.post_content || '']));
    out = out.replace(REUSABLE_BLOCK_REF, (_m, id) => byId.get(parseInt(id, 10)) ?? '');
  }

  if (partSlugs.length > 0) {
    const uniq = Array.from(new Set(partSlugs));
    const [rows] = await pool.query<TemplatePartRow[]>(
      `SELECT post_name, post_content FROM wp_posts
       WHERE post_name IN (${uniq.map(() => '?').join(',')})
         AND post_type = 'wp_template_part' AND post_status = 'publish'`,
      uniq,
    );
    const bySlug = new Map(rows.map((r) => [r.post_name, r.post_content || '']));
    out = out.replace(TEMPLATE_PART_REF, (_m, slug) => bySlug.get(slug) ?? '');
  }

  // An expanded block/part can itself contain more references.
  return out.includes('wp:block') || out.includes('wp:template-part')
    ? expandReferences(out, depth + 1)
    : out;
}

/**
 * True when the (already expanded) content contains a block type we can't
 * faithfully flatten — the caller should defer to GraphQL do_blocks.
 */
function hasUnsupportedBlock(html: string): boolean {
  for (const m of html.matchAll(BLOCK_TYPE)) {
    if (!STATIC_BLOCK_ALLOWLIST.has(m[1].toLowerCase())) return true;
  }
  return false;
}

/**
 * Normalise `[add_to_cart sku="X"]` to `[add_to_cart id="<productId>"]` by
 * resolving the SKU against `_sku` postmeta (products *and* variations). The
 * downstream pipeline (rewriteWordPressUrls + AddToCartEnhancer) only
 * understands the `id=` form, so this is what makes SKU-based shortcodes work.
 * Unresolved SKUs are left untouched (rendered harmlessly as literal text,
 * same as before).
 */
export async function resolveAddToCartSkus(html: string): Promise<string> {
  if (!html || !html.includes('[add_to_cart')) return html;

  // Collect sku= shortcodes that don't already carry an id=.
  const skuShortcode = /\[add_to_cart\b(?![^\]]*\bid=)[^\]]*?\bsku=["']([^"']+)["'][^\]]*?\]/gi;
  const skus = Array.from(html.matchAll(skuShortcode)).map((m) => m[1]);
  if (skus.length === 0) return html;

  const uniq = Array.from(new Set(skus));
  const pool = await getPoolAsync();
  const [rows] = await pool.query<SkuRow[]>(
    `SELECT pm.post_id, pm.meta_value
       FROM wp_postmeta pm
       JOIN wp_posts p ON p.ID = pm.post_id
      WHERE pm.meta_key = '_sku'
        AND pm.meta_value IN (${uniq.map(() => '?').join(',')})
        AND p.post_type IN ('product', 'product_variation')
        AND p.post_status = 'publish'`,
    uniq,
  );
  const idBySku = new Map<string, number>();
  for (const r of rows) {
    if (!idBySku.has(r.meta_value)) idBySku.set(r.meta_value, r.post_id);
  }
  if (idBySku.size === 0) return html;

  return html.replace(skuShortcode, (match, sku) => {
    const id = idBySku.get(sku);
    return id ? `[add_to_cart id="${id}"]` : match;
  });
}

/** Add native lazy-loading to inline images that lack it (do_blocks/the_content
 * normally injects these; the saved markup doesn't always have them). */
function enhanceInlineImages(html: string): string {
  return html.replace(/<img\b((?:[^>]*?))>/gi, (match, attrs) => {
    let a = attrs as string;
    if (!/\bloading=/.test(a)) a += ' loading="lazy"';
    if (!/\bdecoding=/.test(a)) a += ' decoding="async"';
    return `<img${a}>`;
  });
}

export interface RenderedContent {
  /** Rendered HTML, ready for rewriteWordPressUrls() + sanitizeHtml(). */
  html: string;
  /** True when the post contains a dynamic block we can't flatten; caller
   *  should fall back to GraphQL do_blocks for this post. */
  needsFallback: boolean;
}

/**
 * Render raw WordPress `post_content` (Gutenberg source) to HTML using SQL only.
 * Equivalent to WP's `do_blocks` for the static-block + reusable-block +
 * add-to-cart-shortcode content our guides use.
 */
export async function renderPostContentFromSql(
  rawContent: string,
): Promise<RenderedContent> {
  if (!rawContent) return { html: '', needsFallback: false };

  const expanded = await expandReferences(rawContent);

  // Decide BEFORE stripping comments (the block type lives in the delimiter).
  if (hasUnsupportedBlock(expanded)) {
    return { html: '', needsFallback: true };
  }

  const withResolvedSkus = await resolveAddToCartSkus(expanded);
  const stripped = stripBlockComments(withResolvedSkus);
  const html = enhanceInlineImages(stripped);

  return { html, needsFallback: false };
}

/**
 * Strip Gutenberg block delimiter comments. For static blocks the saved inner
 * HTML is the rendered output, so removing the delimiters == do_blocks().
 * Exported for testing.
 */
export function stripBlockComments(html: string): string {
  return html.replace(BLOCK_DELIMITER, '');
}
