# Buyer's Guide ("Best [X]" Roundup) System — Implementation Spec

**Status:** Proposed (2026-06-01)
**Owner:** Loren
**Builds on:** `docs/POST-PRODUCT-RELATIONS.md`, `lib/db/post-relations.ts`, `wordpress/mu-plugins/maleq-post-product-relations.php`

## Goal

Replace the hand-authored, fast-rotting "best sex toys" top-10 articles with a
**data-driven roundup system**: an editor curates a *ranked list of product IDs*
plus a few editorial fields per product; the page renders the comparison table,
ranked product cards, pros/cons, FAQ, and all structured data **programmatically
from the live product index**. One renderer serves every product category;
category differences are data-driven.

### Why this design

- **Live data = zero maintenance rot.** Prices, ratings, stock, specs, and images
  resolve from `ProductIndexEntry` at render time. The old guides hand-typed
  prices that lied the moment they changed. This is the core win.
- **Stays in `wp_posts`.** A roundup is an *article whose body is data-driven*,
  not a new entity. Keeping it a post reuses everything already built: SQL-first
  render (`gutenberg-render`), ISR + webhook revalidation, i18n/hreflang/
  translations, categories/tags, comments, sitemap, related posts. A custom table
  would force re-implementing all of it. **Decision: no custom table.**
- **AEO/SEO payload.** Answer-first layout + `ItemList`/`Review`/`FAQPage`
  JSON-LD is what gets cited by AI answer engines and featured snippets.

### Decisions locked in (2026-06-01)

| Question | Decision |
|---|---|
| Render model | **Fully programmatic** — list/table/cards/FAQ are component-rendered from data; only intro/conclusion are prose. |
| Authoring | **AI-draft, human-refine** — a generator script drafts editorial via the Claude API; editor refines in WP. |
| First step | This spec, then build the data + render layer. |

---

## 1. Data model

### 1.1 Keep (unchanged)

- `_maleq_related_products` — **canonical ordered CSV of product IDs**. Order =
  ranking (#1 first). Keep as-is so the existing `FIND_IN_SET` reverse lookups
  (`loadPostIdsReferencingProduct`, "Related Guides" on product pages) keep
  working untouched.
- `_maleq_related_product_cats` — CSV of `product_cat` term IDs (browse links +
  category-fallback reverse lookup).

### 1.2 Add

| Meta key | Type | Purpose |
|---|---|---|
| `_maleq_guide_type` | string | `roundup` marks a post for the programmatic layout. Absent = normal article (current behavior). |
| `_maleq_guide_entries` | JSON | Editorial overlay, **keyed by product ID**. Only ~4 fields per product. |
| `_maleq_guide_faq` | JSON | Array of `{q, a}` for the FAQ block → `FAQPage` schema. |
| `_maleq_guide_meta` | JSON | Guide-level fields: `methodology` (how we picked), `lastReviewed` (ISO date), optional `columns` override. |

**`_maleq_guide_entries` shape** (keyed by product ID so reordering the CSV never
desyncs the overlay):

```jsonc
{
  "1234": {
    "award": "Best Overall",        // badge; free text, but see award vocab §4
    "bestFor": "Beginners",
    "verdict": "Our top pick — quiet, body-safe, and dead simple to use.",
    "pros": ["Whisper quiet", "Body-safe silicone", "USB rechargeable"],
    "cons": ["Premium price"],
    "editorRating": 4.8             // optional; falls back to live averageRating
  },
  "5678": { "award": "Best Budget", "bestFor": "...", "verdict": "...", "pros": [], "cons": [] }
}
```

Everything else — name, slug, image, price/salePrice, live `averageRating` +
`reviewCount`, brand, material, attributes/specs, stock — is resolved from the
index and **never stored in the post**.

### 1.3 Why JSON-by-ID and not extend the CSV

The CSV is the *ranking* (one cheap SQL read, FIND_IN_SET-friendly). The JSON is
the *editorial overlay* (varied, nested, optional). Keying by ID means an editor
can drag-reorder the product list in the meta box without touching the overlay.
Both are read in one `wp_postmeta` query the page already makes.

---

## 2. Placement in the rendered page (fully programmatic)

The list is 100% component-rendered, but the editor still writes **intro** and
**conclusion/buying-advice** prose. Control placement with a single marker token
the editor drops in the post body:

```
[buyers_guide]
```

Render flow in `app/(guide)/guides/[slug]/page.tsx`:

1. SQL-render `post.content` as today (`getGuidePost`).
2. If `_maleq_guide_type === 'roundup'`: split the rendered HTML on the
   `[buyers_guide]` marker (or a `<!-- buyers-guide -->` comment).
   - Before-marker HTML → intro prose (`dangerouslySetInnerHTML`).
   - `<BuyersGuide />` component renders between.
   - After-marker HTML → conclusion / "how to choose" prose.
   - **No marker present →** render `<BuyersGuide />` right after the intro
     (after the first `<h2>`), before the rest. Pick a deterministic default.
3. Non-roundup posts: unchanged.

> The marker keeps the heavy list out of Gutenberg entirely (no stale HTML) while
> letting editors place it. This is still "fully programmatic" — only *position*
> is editor-controlled, never the list's markup or data.

---

## 3. Components

All server components (data resolved server-side; no client fetching).

### `components/blog/BuyersGuide.tsx` (new, orchestrator)

Props: `{ entries: GuideEntry[]; columns: SpecColumn[]; faq: FaqItem[]; meta: GuideMeta; locale?: string }`

Renders, in order:
1. **`<TopPicksSummary>`** — TL;DR answer box: "Best Overall: X · Best Budget: Y · …"
   (one line per awarded product, anchor-linked to its card). Answer-first for AEO.
2. **`<ComparisonTable>`** — see §3.1.
3. **`<RankedProductCard>` × N** — see §3.2.
4. **`<GuideFaq>`** — accordion of `{q,a}`.
5. **`<Methodology>`** — "How we picked" trust block (E-E-A-T) + `lastReviewed` date.
6. **Schema** — `ItemListSchema`, per-product `ReviewSchema`/aggregateRating, `FaqSchema` (§5).

### 3.1 `<ComparisonTable>`

Columns: `Rank · Product (img+name) · Award · Price (live) · Rating (live stars) ·
{category specs} · CTA`. Sortable client-enhancement optional (defer).

**Spec columns are derived per-category from `scripts/lib/attribute-rules.ts`:**

| Product category | Spec columns |
|---|---|
| Lubes / topicals | Volume, Flavor |
| Condoms | Count, Flavor |
| Apparel / lingerie | Size, Material, Color |
| Toys (default) | Length, Material, Color |

Resolve the guide's dominant category from `_maleq_related_product_cats` (or the
products' shared category), look up its allowed dimensions, and map to columns.
Reuse `CATEGORY_RULES` / `RESTRICTED` rather than re-encoding the mapping.

### 3.2 `<RankedProductCard>`

`<h2 id="pick-{rank}">#{rank} — {name}</h2>`, award badge, image, live star rating
+ review count, live price (+ sale strikethrough), editorial `verdict`, two-column
pros/cons (reuse the existing pros-cons styling the `CheckmarkEnhancer` targets),
`bestFor` chip, key specs row, CTA → product page / add-to-cart (reuse the
`AddToCartEnhancer` plumbing or `ProductCard`'s buy button).

### Reuse, don't rebuild

- `ProductCarousel` / `ProductCard` styling for the cards.
- `StarRatingEnhancer`, `CheckmarkEnhancer` patterns for ratings/pros-cons.
- `AddToCartEnhancer` for CTAs.
- `RecommendedProducts` stays for **non-roundup** posts (and as the "browse related
  categories" footer on roundups).

---

## 4. Read layer (`lib/db/post-relations.ts`)

Add a `loadGuide(postId)` that returns a fully-resolved structure:

```ts
export interface GuideEntry {
  rank: number;
  product: UnifiedProduct;          // resolved from index (live)
  award?: string;
  bestFor?: string;
  verdict?: string;
  pros: string[];
  cons: string[];
  rating: number;                   // editorRating ?? product.averageRating
  reviewCount: number;
}
export interface ResolvedGuide {
  type: 'roundup' | null;
  entries: GuideEntry[];            // ordered by the CSV ranking
  faq: { q: string; a: string }[];
  columns: SpecColumn[];            // derived per category (§3.1)
  meta: { methodology?: string; lastReviewed?: string };
}
export async function loadGuide(postId: number): Promise<ResolvedGuide>
```

Implementation: extend the existing single `wp_postmeta` read in
`loadPostRelations` to also pull the four new keys; merge CSV order + JSON overlay;
resolve products via the index (`getIndexEntryById` → `indexEntryToUnifiedProduct`,
already used by `resolveProducts`). Returns `type: null` for non-roundup posts so
the page falls back to current behavior.

**Guard rails (match existing patterns):** wrap in the same `isMySQLConfigured()`
try/catch the page already uses; return an empty guide on DB failure so the page
still renders.

---

## 5. Structured data (`components/seo/StructuredData.tsx`)

The biggest SEO/AEO gap today. Add three emitters:

- **`ItemListSchema`** — `@type: ItemList`, `itemListElement` of `ListItem`
  (`position`, `item` → nested `Product` with offers + `aggregateRating`). Tells
  Google/AI "ranked list of N products."
- **`ReviewSchema` / aggregateRating** — per product; you already have
  `averageRating` + `reviewCount` in the index. (The existing `ProductSchema`
  already supports `aggregateRating` — reuse it inside the `ItemList` items.)
- **`FaqSchema`** — `@type: FAQPage` from `_maleq_guide_faq`. Strong AEO / "People
  Also Ask" signal.

Keep the existing `ArticleSchema` (BlogPosting) and `BreadcrumbSchema` on the page.
For roundups, consider `BlogPosting` → also fine to keep; the `ItemList` + `FAQPage`
are the additions that matter.

---

## 6. Generator script (`scripts/gen-guide.ts`)

**AI-draft, human-refine.** Input: a list of product IDs (+ optional target post
ID or "create draft"). Output: writes the CSV + JSON meta; editor refines in WP.

Pipeline:
1. Resolve products from the index (price, rating, popularity, attributes, reviews).
2. **Rule-based:** assign provisional awards from signals — highest
   `averageRating` → "Best Overall", lowest price among in-stock → "Best Budget",
   highest `popularityScore` → "Most Popular", etc. Pick spec columns from
   `attribute-rules.ts`.
3. **Claude API draft** (use the `claude-api` skill; prompt-cache the product
   corpus): per-product `verdict`, `pros`, `cons`, `bestFor`; guide-level intro,
   "how to choose," and 4–6 FAQ Q&As. Feed real attributes + a sample of review
   text so copy is grounded, not generic.
4. Write `_maleq_related_products` (CSV), `_maleq_guide_entries` (JSON),
   `_maleq_guide_faq`, `_maleq_guide_meta`, `_maleq_guide_type=roundup`.
5. Dry-run by default; `--write` (+ `--yes` for prod per the DB backup policy,
   mirroring `backfill-post-product-relations.ts`).

Editor then opens the draft in WP, adjusts awards/copy, writes intro/conclusion
prose with the `[buyers_guide]` marker, and publishes.

---

## 7. mu-plugin changes (`maleq-post-product-relations.php`)

- Add a `guide_type` toggle (checkbox: "This post is a Best-of roundup").
- Add a repeatable editorial-overlay UI per selected product (award, bestFor,
  verdict, pros, cons) → writes `_maleq_guide_entries` JSON.
- Add an FAQ repeater → `_maleq_guide_faq`.
- Add methodology textarea + lastReviewed → `_maleq_guide_meta`.
- Keep writing the CSV exactly as now (don't break reverse lookups).
- Per CLAUDE.md: **update `docs/DEPLOYMENT_GUIDE.md`** if plugin scope changes
  materially (it's already a Required Plugin).

> If the meta-box UI for the overlay is heavy, an acceptable v1 is: editor curates
> the *product list + order* in the meta box (as today), and the **generator
> script owns the JSON overlay**; editor edits the overlay JSON via the script /
> a simple admin field. Decide during build.

---

## 8. Freshness automation (optional, later)

- Cron pass: for each `roundup` post, flag entries whose product is now
  `OUT_OF_STOCK`/discontinued (you have `stockStatus` + variant machinery), bump
  `lastReviewed`, and notify for re-curation. Live price/rating already self-heal.

---

## 9. Build order

1. ✅ **Read layer** — `loadGuide()` + types in `lib/db/post-relations.ts`.
2. ✅ **Schema** — `ItemListSchema` + `FaqSchema` in `components/seo/StructuredData.tsx`.
3. ✅ **Components** — `components/blog/buyers-guide/BuyersGuide.tsx` + `guide-*`
   CSS in `blog-post.css`, reusing `.pros-list`/`.cons-list` styles.
4. ✅ **Page wiring** — `guide_type` branch + `[buyers_guide]` marker split
   (`splitGuideContent`) in `app/(guide)/guides/[slug]/page.tsx`.
5. ✅ **mu-plugin** — in `maleq-post-product-relations.php`: the `roundup`
   toggle **plus** the full editorial meta box — per-product fields
   (award / best-for / verdict / pros / cons, keyed to the saved product list),
   a FAQ repeater (add-row JS), and a methodology field. Writes the same
   `_maleq_guide_entries` / `_faq` / `_meta` keys the generator and `loadGuide`
   use, so the generator pre-fills and editors refine in place. (PHP lints clean;
   symlinked into the local WP `mu-plugins` for testing.)
6. ✅ **Generator** — `scripts/gen-guide.ts`: reads the post's curated ranking,
   pulls live product data (price/rating/specs/categories) via SQL, assigns
   rule-based awards (Best Overall / Best Budget / Most Popular), then drafts
   verdict/pros/cons/bestFor + FAQ + methodology via the Claude API
   (`claude-opus-4-8`, adaptive thinking, Zod structured output, prompt-cached
   system prompt). Dry-run by default; `--write` (+ `--yes` for prod). Needs
   `ANTHROPIC_API_KEY`.
7. ✅ **Prototype** — post #287 "Best Glass Dildos"
   (`/guides/best-glass-dildos-and-sex-toys`) converted end-to-end on the LOCAL
   DB: trimmed to 11 toys via `--ids` (dropped a stray toy cleaner + bulk lube),
   full overlay + FAQ + methodology drafted by `gen-guide.ts`, all five
   `_maleq_*` meta keys verified, local WP object cache flushed.

> **Status (2026-06-01):** All 7 steps done. `tsc --noEmit` clean project-wide,
> mu-plugin PHP lints clean, generator output is grounded/specific, prototype
> live on local.
>
> **Render path:** `lib/db/pool.ts` tries the **local socket first** (Local by
> Flywheel) and only falls back to the prod SSH tunnel when local is down — so
> a roundup written to local renders on `next dev` with no repointing. To appear
> on the live site, the meta must be written to **prod** (`--write --yes`, with a
> fresh backup per the DB policy).
>
> **Verified:** prototype renders on `next dev` (HTTP 200, all components +
> both JSON-LD scripts emitted). Editorial meta box installed & active in local
> WP (post #287's fields are pre-filled from the generator output).
>
> **Spec columns now cover all dimensions:** `loadGuide` derives columns from the
> index (length/volume/color/material) **and** a per-request term lookup
> (`loadDbSpecTerms` → flavor/apparel-size/count via `pa_flavor`/`pa_size`/`pa_pack`).
> So lube→Volume+Flavor, condom→Count+Flavor, apparel→Size+Color+Material. Verified
> consistent with `index-loader` and type-clean; #287 regression-renders.
>
> ⚠️ **Local DB caveat:** the local clone predates the prod attribute split
> (`pa_volume`/`pa_length`/`pa_pack` don't exist locally; lube volumes still under
> `pa_size`). Volume/flavor/count columns therefore can't be verified on local —
> re-clone with `db-clone-from-remote.sh` or verify on prod.
>
> **Remaining / follow-ups:** validate JSON-LD in Google's Rich Results Test on a
> deployed page; tidy backfilled lists before converting more posts; write #287
> (and the rest) to **prod** to go live (+ deploy the mu-plugin change to the prod
> mu-plugins dir, see `docs/DEPLOYMENT_GUIDE.md`); roll out to the other 47 guides.
>
> **Dependency added:** `@anthropic-ai/sdk` (for the generator).

## 10. Out of scope (for now)

- Custom database table (rejected — §Goal).
- Sortable/filterable client table (defer; static table ships first).
- Per-locale roundups beyond existing translation machinery.
