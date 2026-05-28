# Post ⇄ Product Relations

One-to-many relationships from blog posts (`/guides/*`) to products and product
categories. Lets us surface curated "Recommended Products" on a guide, and
"Related Guides" on a product page — and is the foundation for the future
"top 10" templated-post generator.

## Data model

Relations live in **WordPress post meta** (the CMS is the source of truth),
stored as **ordered CSV** in two protected keys on the `post` post type:

| Meta key | Value | Meaning |
|----------|-------|---------|
| `_maleq_related_products` | CSV of product post IDs, e.g. `123,456,789` | Curated products. **Order = ranking** (first = top). |
| `_maleq_related_product_cats` | CSV of `product_cat` term IDs, e.g. `42,57` | Categories to recommend / cross-link. |

Why CSV instead of PHP-serialized arrays or repeated meta rows:
- The read path stays a plain SQL lookup (project rule: prefer SQL over GraphQL).
- The reverse direction (product → posts) uses MySQL `FIND_IN_SET()`.
- Order is preserved for free, which the top-10 generator needs.
- The `_` prefix marks the keys protected, hiding them from the default
  Custom Fields box.

## Editing (WordPress admin)

`wordpress/mu-plugins/maleq-post-product-relations.php` adds a **"Related
Products & Categories"** meta box to the post editor:
- Product picker: WooCommerce `wc-product-search` (AJAX over the full catalog).
  Selection order is preserved and saved as the CSV order.
- Category picker: `product_cat` multi-select.
- On save it writes the CSV meta and calls `maleq_revalidate_frontend_cache()`
  for the post **and** each referenced product, so both `/guides/:slug` and the
  affected `/product/:slug` pages refresh.

## Reading (Next.js frontend)

`lib/db/post-relations.ts` (all direct SQL via the runtime pool):

| Function | Direction | Used by |
|----------|-----------|---------|
| `loadPostRelations(postId)` | forward — raw IDs | internal |
| `loadPostRecommendations(postId)` | forward — resolved `UnifiedProduct[]` + category links | guide page |
| `loadRelatedPostsForProduct({ productId, categoryTermIds })` | reverse — `Post[]` | product page |

Products are resolved through the in-memory product index
(`getIndexEntryById` → `indexEntryToUnifiedProduct`), so no extra product
queries. On the product page, the product's own category term IDs come from its
index entry (`getIndexEntryBySlug(...).categoryIds`), which matches the term IDs
the meta box stores.

Surfaces:
- **Guide page** (`app/guides/[slug]/page.tsx`) → `components/blog/RecommendedProducts.tsx`
  ("Recommended Products" carousel + category links). Additive — inline
  `[add_to_cart]` shortcodes still render as before.
- **Product page** (`app/product/[slug]/page.tsx`) → `components/product/RelatedGuides.tsx`
  (direct references first, topped up with category matches).

## Backfilling legacy posts

`scripts/backfill-post-product-relations.ts` parses products already embedded in
existing posts and writes `_maleq_related_products` in the same CSV format. It
handles all the ways products are referenced in this content:

- `[add_to_cart id="123"]`, `[product(_page) id="123"]`, `[products ids="1,2"]`
- `[add_to_cart sku="…"]` — SKUs (incl. variation SKUs like `VAR-…`) resolved via `_sku` meta
- rendered `data-product_id="123"` output
- **Reusable blocks / synced patterns** — `<!-- wp:block {"ref":N} /-->` refs are
  expanded to the referenced `wp_block` content (recursively) before extraction,
  mirroring `do_blocks()`. This matters: ~223 posts reference reusable blocks and
  119 of the 166 blocks contain product shortcodes, so most product references
  live in blocks, not inline. (`wp:pattern` is not used; unsynced patterns are
  inlined into post_content anyway.)

Variation IDs/SKUs are mapped to their parent product; unresolved references
(discontinued/deleted products) are logged and skipped.

- **Dry-run by default.** `--write` to persist; remote/prod writes also require
  `--yes` (and a fresh backup per the DB backup policy in `CLAUDE.md`).
- Skips posts that already have the meta unless `--overwrite` is given.
- `--category <slug>` to limit to a blog category (e.g. the sex-toy guides);
  `--local` to target Local by Flywheel.

```bash
bun run scripts/backfill-post-product-relations.ts --local --category sex-toys        # preview
bun run scripts/backfill-post-product-relations.ts --local --category sex-toys --write # persist locally
```

## Future: "top 10" templated post generator (designed-for, not built)

Goal: paste a series of WooCommerce shortcodes (or product IDs) and auto-generate
a ranked list-style post.

Planned flow, reusing everything above:
1. **Input**: ordered list of shortcodes / product IDs + a title and target
   blog category. Reuse the backfill extractor to pull IDs from pasted shortcodes.
2. **Resolve**: product IDs → product data via the index.
3. **Render template**: intro paragraph, then per product in order — an
   `<h2>#N. {name}</h2>`, the existing `[add_to_cart id="{id}"]` shortcode (so the
   inline cart keeps working), and a blurb (short description or generated copy).
4. **Create the post** (as a draft) via WP REST / WP-CLI.
5. **Set `_maleq_related_products`** to the same ordered IDs — identical CSV
   format, so the structured relationship matches the inline list and powers the
   "Recommended Products" / "Related Guides" surfaces immediately. Editors can
   then fine-tune via the meta box.

The ordered CSV meta is the key enabler: the generator just writes it, and the
read/render path is already live.
