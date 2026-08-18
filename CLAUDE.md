# Claude Code Instructions for Male Q Headless

## Commands for the User to Run (clipboard rule)

- **Whenever you produce a shell command for the user to run themselves** (e.g. prod-write/migration operations the agent is blocked from, SSH commands, `wp-cli`, anything you'd prefix with `!`), **also copy it to the macOS clipboard in the same turn** via `pbcopy`, e.g. `printf '%s' '<command>' | pbcopy` (use a heredoc piped to `pbcopy` for multi-line).
- Copy the command **without** the leading `!` so it pastes cleanly into a terminal (the user can still re-add `!` to run it in-session).
- If you present multiple commands, copy the single one the user should run **next**; mention that the others are in the message.

## Build & Testing Rules

- **NEVER run `bun run build` or `npm run build` unless explicitly requested** - builds can crash/hang the project
- Use TypeScript type checking (`npx tsc --noEmit --skipLibCheck`) for validation instead
- Run individual file compilation checks when needed

## Known Vercel Build Issues

- **DO NOT use `isomorphic-dompurify`** — it depends on `jsdom` → `parse5` (ESM-only), which breaks Vercel's webpack build and serverless runtime. This has caused production outages twice (commits `3d8d6c1b`, `d3e288de`). Use `sanitize-html` or a regex-based approach instead for HTML sanitization.

## Project Context

- Next.js 15 headless WooCommerce e-commerce site
- **Uses Bun as package manager** - always use `bun add`, `bun remove`, `bun install`
- Main branch: `main`
- WordPress backend with WPGraphQL

## Key Directories

- `app/` - Next.js App Router pages
- `components/` - React components
- `lib/` - Utilities, services, GraphQL queries
- `scripts/` - CLI scripts (price updates, migrations)
- `wordpress/mu-plugins/` - WordPress must-use plugins
- `docs/` - Documentation

## Local WordPress Installation

- **Location**: `~/Local Sites/maleq-local/app/public/`
- **URL**: `http://maleq-local.local`
- **mu-plugins**: `~/Local Sites/maleq-local/app/public/wp-content/mu-plugins/`
- **Platform**: Local by Flywheel

## Database Backup Policy (Required)

- Before any production DB push/sync, create a fresh production backup on this machine.
- Use **SSH-streamed mysqldump + gzip** (preferred format: `.sql.gz`) instead of plain `.sql`:
  - `ssh root@159.69.220.162 "mysqldump --ssl-mode=REQUIRED --no-tablespaces -u <user> -p'<pass>' -h 127.0.0.1 <db> --single-transaction --quick --lock-tables=false 2>/dev/null" | gzip -1 > backups/prod-backup-$(date +%Y%m%d_%H%M%S).sql.gz`
- Validate backup integrity immediately: `gzip -t backups/<file>.sql.gz`
- Keep the backup file path recorded in the task notes/output before making production writes.

## API Preferences

- **Always prefer direct SQL queries over GraphQL** - SQL via the MySQL connection pool (`lib/db/pool.ts`) is faster and avoids WPGraphQL overhead. Use GraphQL only when absolutely necessary (e.g., reusable block rendering in blog post content which requires WordPress's `do_blocks()` pipeline).
- For authenticated operations, use custom REST endpoints in `wordpress/mu-plugins/` that return data directly
- The in-memory product index (`lib/products/product-index.ts`) backed by SQL should be the primary data source for product listings, filtering, and search

## Plugin Documentation

- **When creating a new mu-plugin**, always update `docs/DEPLOYMENT_GUIDE.md` to add the plugin to the Required Plugins table and installation steps

## Attribute Data Hygiene (Imports)

To prevent re-dirtying the cleaned attribute schema, **any code that creates product attribute terms MUST route + canonicalize values through `scripts/lib/attribute-sanitizer.ts`** — never map a source attribute name directly to `pa_<name>` with a raw slug.
- `classifyAttributeValue(value, {colorVocab, flavorVocab, materialVocab})` → routes by VALUE (a "Size" attr holding `Black`→`pa_color`, `2 Oz`→`pa_volume`, `8in`→`pa_length`/`8-in`, `Sm`→`pa_size`/`s`) and returns the canonical `{taxonomy, slug, name}`. Pass live DB vocab so multi-word values (`hot-pink`, `mojito`) match existing terms.
- `resolveAxis(attrName, values, vocab)` → the taxonomy for a whole variation axis (pure→that dim; mixed→source taxonomy + warning).
- `findDuplicateVariationCombos(variations)` → catches the "lost axis" bug (multiple variations sharing one value because e.g. color was never wired in).
- Canonical taxonomies: `pa_color`, `pa_size` (apparel), `pa_volume` (oz/ml/g), `pa_length` (in/cm/mm/ft), `pa_flavor`, `pa_material`, `pa_pack` (counts). Do NOT dump mixed values into `pa_size`/`pa_style`/`pa_variant`.
- Already wired into `import-products-direct.ts` (loads vocab on connect, routes the variation axis, warns on mixed/junk/duplicate-combo). The full cleanup history is in memory: size/attribute/variation cleanups.

**Category → attribute rules** (`scripts/lib/attribute-rules.ts`): which attribute dimensions a product's category may have. Enforced at import (warns) and auditable (`scripts/_audit-attr-rules.ts`):
- **Lubes / cleaners / oils / creams / lotions / sprays / gels / hygiene / douches** → **volume, flavor** only.
- **Condoms** → **count, flavor** only.
- **Apparel / lingerie / costumes** → **apparel-size, color, material, count**.
- **Everything else (toys: dildos, anal, cock-rings, plugs, vibes, masturbators, extensions…)** → **length, color, material, apparel, count**.
- **GLOBAL restrictions:** `volume` only on lube/topical; `flavor` only on lube/topical + condoms. So a FLAVOR on a toy is almost always a mislabeled skin-tone (vanilla/chocolate/caramel → should be `pa_color`); a VOLUME on a non-lube is junk. `reconcileWithCategory()` auto-corrects skin-tone flavor→color and flags the rest.
- Add new rules by extending `CATEGORY_RULES` / `RESTRICTED`.

## Available Scripts & CLI Tools

Located in `scripts/`. All scripts use the shared DB module at `scripts/lib/db.ts` for MySQL connections.

**Shared Modules** (`scripts/lib/`):
- `db.ts` - Shared MySQL connection config (`getConnection()` and `config` exports)
- `attribute-sanitizer.ts` - Route + canonicalize attribute values at import (see Attribute Data Hygiene above)

**Data Import/Export:**
- `import-products-direct.ts` - Import products directly to database
- `import-images.ts` - Import product images
- `import-videos.ts` - Import video content
- `xml-to-json.ts` - Convert XML exports to JSON

**Database Operations:**
- `db-clone-from-remote.sh` - **Sync local DB from production** (dumps prod via SSH, imports into Local by Flywheel `local` DB). Requires Local site running.
- `db-clone-direct.sh` - Clone database directly
- `db-push-direct.sh` - Push database changes
- `db-push-to-remote.sh` - Push to remote database
- `delete-all-products.sql` / `delete-all-categories.sql` - Cleanup SQL
- `delete-duplicate-comments.ts` - Remove duplicate comments

**Content Cleanup:**
- `fix-html-entities.ts` - Decode HTML entity artifacts (`&amp;` → `&`) in titles, terms, descriptions
- `cleanup-titles.ts` - Standardize product titles
- `cleanup-tags.ts` - Clean up product tags
- `normalize-tag-caps.ts` - Fix tag capitalization
- `remove-review-labels.ts` - Clean review formatting
- `remove-review-linebreaks.ts` - Fix review line breaks

**Buyer's Guides ("Best of" roundups):**
- `gen-guide.ts` - Generate the editorial overlay for a roundup post (rule-based awards + Claude-drafted verdict/pros/cons/FAQ/methodology) → writes `_maleq_guide_*` meta. Dry-run by default; needs `ANTHROPIC_API_KEY`. See `docs/BUYERS_GUIDE_SYSTEM.md`.
- `backfill-post-product-relations.ts` - Backfill `_maleq_related_products` from products embedded in existing posts.

**Product Updates:**
- `update-prices.ts` - Bulk price updates
- `update-brand-name.ts` - Update brand names
- `update-image-urls.ts` - Fix image URLs
- `update-product-links-v2.ts` - Fix internal links
- `variation-updater.ts` - Update product variations
- `attribute-parser.ts` - Parse product attributes

**URL/Link Management:**
- `convert-urls-to-relative.ts` - Convert absolute to relative URLs
- `generate-link-mapping-report.ts` - Report on internal links

**Analysis:**
- `analyze-title-patterns.ts` - Analyze product title patterns
- `apply-fuzzy-matches.ts` - Apply fuzzy matching to data
- `list-tags.ts` - List all product tags

**Archived** (`scripts/archive/`):
- One-time migration scripts (imports, category hierarchy, video conversion, etc.)

## Built-In Search & Utility Functions

### Search System (`lib/search/` and `lib/utils/search-helpers.ts`)

**Spell Checking / Fuzzy Suggestions** (`lib/search/search-index.ts`):
- `correctProductSearchTerm(term)` - Returns spelling suggestions when no results found
- `correctBlogSearchTerm(term)` - Returns spelling suggestions when no results found
- Uses MiniSearch with product/brand/category vocabulary index (fuzzy: 0.3, prefix: true)
- Returns up to 5 suggestions for "Did you mean?" UI
- Only triggered when search returns zero results

**Search Helpers** (`lib/utils/search-helpers.ts`):
- `tokenizeQuery(query)` - Splits query into searchable terms, removes stop words
- `simpleStem(word)` - Basic English stemming (plurals, -ing, -ed)
- `levenshteinDistance(a, b)` - Calculate edit distance between strings
- `isFuzzyMatch(word1, word2)` - Check if words are fuzzy match
- `textContainsTerm(text, term)` - Check if text contains term (with fuzzy matching)
- `calculateRelevanceScore(item, terms)` - Score item relevance for search terms
- `matchesAllTerms(text, terms)` / `matchesAnyTerm(text, terms)` - Term matching

**Shared Filter Utility** (`lib/utils/product-filter-helpers.ts`):
- `extractFilterOptionsFromProducts(products)` - Extract brand/material/color filter options from product list

### Service Layer

**Product Service** (`lib/products/combined-service.ts`):
- `searchProducts(term, options)` - Full-text product search with typo tolerance
- `getProducts(options)` - Get products with filtering/pagination
- `getProductBySlug(slug)` - Single product lookup
- `getFilteredProducts(filters)` - Advanced filtering (category, brand, material, price)
- `getProductCategories()` - Get all categories
- `getBrands()` / `getMaterials()` - Get filter options

**Blog Service** (`lib/blog/blog-service.ts`):
- `searchBlogPosts(query, options)` - Blog search with typo tolerance
- `getBlogPosts(options)` - Paginated blog listing
- `getBlogSearchSuggestions(query)` - Autocomplete suggestions
- `getBlogCategories()` - Get blog categories

### React Hooks (`lib/hooks/`)

- `useHorizontalScroll` - shared carousel scroll/arrow state (ProductCarousel, ArticleCarousel)
- `useHydrated` - SSR-safe "has hydrated" flag
- `usePushSubscription` - Web Push subscription state
- `useUnitSystem` - metric/imperial preference

(Note: the older `useSearch`/`useAddToCart`/`useFormSubmit`/`useOnlineStatus` hooks were
removed in the 2026-06-11 cleanup — they had zero consumers; search/add-to-cart logic lives
inline in `SearchAutocomplete.tsx` and the cart store. Don't reintroduce them as "the API"
without wiring them up.)

### Validation Schemas (`lib/validations/`)

- `auth.ts` - Zod schemas for login, registration, password reset
- `contact.ts` - Zod schemas for contact forms

### Providers (`components/providers/`)

- `QueryProvider.tsx` - React Query provider with 1min stale time, 5min cache

## Installed Packages for Common Tasks

- **minisearch** - Fuzzy search, relevance ranking, and spelling suggestions (~5.8 kB)
- **sanitize-html** - XSS protection for HTML content (replaces isomorphic-dompurify which breaks on Vercel)
- **react-hook-form** + **@hookform/resolvers** - Form handling
- **zod** - Schema validation
- **@tanstack/react-query** - Data fetching and caching
- **graphql-request** - Lightweight GraphQL client for WPGraphQL queries (~5 kB, replaced Apollo Client)
