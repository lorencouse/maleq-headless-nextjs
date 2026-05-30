# Product Variant Rules & Data Parameters

Canonical reference for all product variation detection, grouping, and cleanup logic.
Scripts and AI assistants should follow these rules exactly.

---

## 1. Data Source Hierarchy (Source of Truth)

Check sources in this order. Higher-priority sources override lower ones.

| Priority | File | Path | Description |
|----------|------|------|-------------|
| 1 (highest) | `products-filtered.xml` | `data/product-feeds/products-filtered.xml` | Main warehouse (Williams Trading). Active products with the richest metadata. Check first. |
| 2 | `stc-product-feed.csv` | `data/product-feeds/stc-product-feed.csv` | Secondary warehouse (STC). Products here ARE still active and shippable, even if they appear in `inactive_products.xml`. Cross-reference with inactive XML for richer metadata. |
| 3 (lowest) | `inactive_products.xml` | `data/product-feeds/inactive_products.xml` | Discontinued/no-longer-stocked in main warehouse. Has rich product metadata useful for populating meta fields. |

### Determining Active vs. Discontinued

- **Active**: Listed in `products-filtered.xml` OR `stc-product-feed.csv`
- **Truly discontinued**: Listed in `inactive_products.xml` AND **NOT** in `stc-product-feed.csv` AND **NOT** in `products-filtered.xml`
- When a product appears in both `inactive_products.xml` and `stc-product-feed.csv`, it is still active (shippable via STC). Use the inactive XML's rich metadata to populate fields.

### Handling Discontinued Products

- **Variant is discontinued**: Delete the variation from the parent variable product entirely.
- **All variants of a parent are discontinued** (parent is a single/simple product): Set post status to `draft`.
- Generate a finalized list of truly discontinued products for review before bulk operations.

---

## 2. Core Variation Rules

### Up to Two Attributes (UPDATED 2026-05-30)

A variable product may have **up to two** variation attributes — typically **size/length × color** (e.g. a RealRock dildo offered in 7–12 in × tan/vanilla/clear is ONE variable product with a Length dropdown AND a Color dropdown). This supersedes the former single-attribute rule (now that the attribute taxonomies are cleaned + split into pa_color/pa_size/pa_volume/pa_length/pa_flavor/pa_material).

- Pick the axes by the category rules below. The two axes must be **orthogonal** (size × color, not size × size).
- Every variation must be uniquely identified by its combination of axis values (no duplicate combos — see §7).
- Apparel/lube/condom lines are usually still single-axis; toys (dildos, plugs, etc.) are commonly size/length × color.
- Allowed taxonomies as variation axes: `pa_color`, `pa_size`, `pa_volume`, `pa_length`, `pa_flavor`, `pa_material`, `pa_pack` — bounded by the category→attribute rules (`scripts/lib/attribute-rules.ts`).

### WooCommerce Meta

- Products from Williams Trading have `_wt_*` meta fields (e.g., `_wt_sku`, `_wt_price`)
- Use `_regular_price` (not `_price`) for price comparisons to avoid sale price distortion

---

## 3. SKU-Based Variation Family Detection

The Williams Trading SKU (`_wt_sku` meta field) is the **primary identifier** for grouping variants into families.

### Choosing Pattern A vs B

The pattern is determined by counting **trailing digits after the last letter** in the entire SKU:

- **≤ 4 trailing digits** → **Pattern A** (direct variant ID, typically a size like oz)
- **≥ 5 trailing digits** → **Pattern B** (structured family/sibling/variant encoding)

This handles SKUs where numbers appear in the product code (e.g., "H2O" → "H20") without incorrectly triggering Pattern B.

### Pattern A: ≤ 4 Trailing Digits After Last Letter

Split at the last letter boundary. Everything up to and including the last letter = parent SKU. Trailing digits = variant ID.

```
SNSL1      -> Parent: SNSL,  Variant: 1     (1 oz)
SNSL32     -> Parent: SNSL,  Variant: 32    (32 oz)
EPG02      -> Parent: EPG,   Variant: 02    (Gun Oil Silicone 2 oz)
EPG032     -> Parent: EPG,   Variant: 032   (Gun Oil Silicone 32 oz)
EPGOH202   -> Parent: EPGOH, Variant: 202   (Gun Oil H2O 2 oz)
EPGOH2032  -> Parent: EPGOH, Variant: 2032  (Gun Oil H2O 32 oz)
ZDSGZL001  -> Parent: ZDSGZL, Variant: 001  (Zodiac Mini Vibe #1)
```

All `EPG*` SKUs share parent `EPG` (Gun Oil Silicone). All `EPGOH*` share parent `EPGOH` (Gun Oil H2O). The "H20" in the product code doesn't break the grouping.

### Pattern B: ≥ 5 Trailing Digits After Last Letter

The **last digit** is the variant ID within a sibling group. The **second-to-last digit** identifies the sibling product group. Everything before that is the product family.

```
NSN096111 -> Family: NSN0961, Sibling: 1, Variant: 1  (5 trailing digits after 'N')
NSN096114 -> Family: NSN0961, Sibling: 1, Variant: 4
NSN096121 -> Family: NSN0961, Sibling: 2, Variant: 1  (different sibling = different product)
```

All three share family `NSN0961` + sibling group `1` = Rear Assets Rose Gold Small.
Variants 1, 4, 9 = Clear, Pink, Rainbow.

A different sibling group (e.g., `NSN096121`, `NSN096124`) would be a different product (e.g., Rear Assets Rose Gold Medium).

### No Williams SKU

If no `_wt_sku` exists, fall back to secondary detection methods (see Section 5).

---

## 4. Category-Specific Attribute Rules

### Lubricants (and all child categories)

Allowed attributes: **`size`** or **`type`** (pick one).

- **Size examples**: `1 oz`, `2 oz`, `16 oz`, `100 ml`, `250 ml`
- **Type examples**: `Water`, `Silicone`, `Cherry`, `Warming`, `Cooling`, `Desensitizing`

**Which attribute to use as the variation:**

1. Use WTC SKU grouping first (Section 3).
2. Fallback: If variants have **multiple different sizes** (1 oz, 2 oz, 4 oz) -> **type is the parent product**, **size is the variation attribute**.
3. Fallback: If variants have the **same size** (all 2 oz) -> **size is the parent descriptor**, **type is the variation attribute** (e.g., Parent: "Brand Lube 2oz", Variants: Silicone, Water, Warming).

### All Other Categories (NOT Lubricants)

Allowed attributes: **`size`** or **`color`** (pick one).

- **Size examples**: `X-Small`, `Small`, `Medium`, `Large`, `XL` / `6 in`, `7 in`, `7.5 in` / `10 cm`, `20 cm`
- **Color examples**: `Black`, `Brown`, `Gold`, `Beige`, `Red`, `Tan`, `Pink`, `Purple`, `Clear`, `Rainbow`

**Which attribute to use as the variation:**

1. Use WTC SKU grouping first (Section 3).
2. Fallback: If variants have **multiple colors AND multiple sizes** -> **size is the parent product**, **color is the variation attribute**.
   - Example: "Dildo Black 6 in" + "Dildo Brown 6 in" -> Parent: "Dildo 6 in", Variants: Black, Brown
3. Fallback: If variants have **no color variation but multiple sizes** -> **size is the variation attribute**.
4. Fallback: If only one size and one color -> **single product** (not a variable product).

---

## 5. Fallback Detection Cascade (When No WTC SKU)

When `_wt_sku` is not available, use these methods in order:

### Method 1: Price Grouping

- **Same price** = likely same product line (color or type variants, not size)
- **Different prices** = likely different sizes or different products entirely
- Use `_regular_price` for comparison

### Method 2: Title Analysis

- Extract the base product name by stripping known variant indicators (colors, sizes, types)
- Products sharing a base name are candidate siblings
- Title gives clues about variant type (contains color word? size word? type word?)

### Method 3: Description / Metadata Comparison

- Compare product descriptions, brands, and categories
- Products in the same brand + category with similar descriptions are likely related

---

## 6. Post-Processing Steps

After any variation grouping/splitting operation:

1. **Fix duplicate attributes**: Run `scripts/fix-duplicate-variations.ts --apply`
2. **Regenerate WooCommerce lookup tables** (via WP-CLI):
   - `wc tool run regenerate_product_attributes_lookup_table`
   - `wc tool run regenerate_product_lookup_tables`
3. **Clear transient cache**: `transient delete --all`
4. **Verify in WC admin** that variations display correctly

---

## 7. No Duplicate Attribute Values

A parent product must **never** have two or more variations with the same attribute value. Every variation on a parent must be uniquely identifiable by its attribute value in the dropdown.

### Why Duplicates Happen

Duplicates typically occur when the wrong attribute is chosen as the variation dimension:
- **Color chosen but products differ by size**: 6 variations all tagged "black" because they're Black Small, Black Medium, Black Large, etc.
- **Size chosen but products differ by color**: 4 variations all tagged "4-oz" because they're 4oz Cherry, 4oz Warming, etc.
- **Import artifacts**: Slug-based attribute values from bulk imports that don't differentiate products.

### Handling Strategies (by case)

#### Case 1: ALL variations share the same attribute value (335 parents)

The current attribute is meaningless as a differentiator. Resolution:
1. Check feed data for a better differentiator (size, color, type, flavor).
2. If feed data provides distinct values → **reclassify** to the correct attribute using feed names.
3. If no differentiator exists → these may be **duplicate products** that should be merged or deleted.

#### Case 2: SOME values duplicated, others unique (614 parents)

The product likely contains **multiple product lines** that were incorrectly merged. Resolution:
1. Check if SKU patterns reveal sub-groups (e.g., different sibling groups in Pattern B).
2. If sub-groups exist → **split** into separate parent products, one per sub-group.
3. If same SKU family but different physical products → use feed data to find a differentiating attribute (often the product is "Color × Size" but only one dimension was captured).
4. If feed data provides distinct names → **append a differentiator** to the attribute value (e.g., "orange" → "orange-6in", "orange-8in").

#### Case 3: Variant names contain parent product name

Variation attribute values should be **just the differentiator**, not the full product name. Strip the parent product name prefix from attribute values.
- Bad: `orange-is-the-new-black-whip-it` on parent "Orange Is the New Black"
- Good: `whip-it`

### Priority in Pipeline

Duplicate detection runs **after** split operations (a split may resolve duplicates by separating sub-groups). Remaining duplicates are then fixed via feed-data reclassification or differentiator appending.

---

## 8. Validation Checklist

Before applying any batch operation:

- [ ] Every variable product has exactly 1 variation attribute
- [ ] No product has a 2-level variation selector
- [ ] No parent product has two or more variations with the same attribute value
- [ ] SKU grouping aligns with price and title signals
- [ ] Discontinued variants (truly inactive) are deleted, not left orphaned
- [ ] Discontinued single products are set to `draft`
- [ ] Parent product title reflects the product line (not a specific variant)
- [ ] Variation attribute values are human-readable (not raw SKU fragments)
