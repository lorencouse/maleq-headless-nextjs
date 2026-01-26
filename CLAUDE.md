# Claude Code Instructions for Male Q Headless

## Build & Testing Rules

- **NEVER run `bun run build` or `npm run build` unless explicitly requested** - builds can crash/hang the project
- Use TypeScript type checking (`npx tsc --noEmit --skipLibCheck`) for validation instead
- Run individual file compilation checks when needed

## Project Context

- Next.js 15 headless WooCommerce e-commerce site
- Uses Bun as package manager
- Main branch: `initial-setup`
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

## API Preferences

- **Always prefer WPGraphQL over WooCommerce REST API** - GraphQL is more reliable and doesn't have the same authentication issues as the REST API
- For authenticated operations not available via GraphQL, use custom REST endpoints in `wordpress/mu-plugins/` that return data directly

## Plugin Documentation

- **When creating a new mu-plugin**, always update `docs/DEPLOYMENT_GUIDE.md` to add the plugin to the Required Plugins table and installation steps

## Available Scripts & CLI Tools

Located in `scripts/`:

**Data Import/Export:**
- `import-products-direct.ts` - Import products directly to database
- `import-categories-direct.ts` - Import product categories
- `import-manufacturers-direct.ts` - Import brand/manufacturer data
- `import-images.ts` - Import product images
- `import-featured-images.ts` - Import featured images
- `import-post-images.ts` - Import blog post images
- `import-videos.ts` - Import video content
- `import-reusable-blocks.ts` - Import WordPress reusable blocks
- `xml-to-json.ts` - Convert XML exports to JSON

**Database Operations:**
- `db-clone-direct.sh` - Clone database directly
- `db-clone-from-remote.sh` - Clone from remote database
- `db-push-direct.sh` - Push database changes
- `db-push-to-remote.sh` - Push to remote database
- `delete-all-products.sql` / `delete-all-categories.sql` - Cleanup SQL
- `delete-duplicate-comments.ts` - Remove duplicate comments

**Content Cleanup:**
- `cleanup-titles.ts` - Standardize product titles
- `cleanup-tags.ts` - Clean up product tags
- `normalize-tag-caps.ts` - Fix tag capitalization
- `remove-review-labels.ts` - Clean review formatting
- `remove-review-linebreaks.ts` - Fix review line breaks

**Product Updates:**
- `update-prices.ts` - Bulk price updates
- `update-brand-name.ts` - Update brand names
- `update-image-urls.ts` - Fix image URLs
- `update-product-links.ts` / `update-product-links-v2.ts` - Fix internal links
- `variation-updater.ts` - Update product variations
- `attribute-parser.ts` - Parse product attributes

**URL/Link Management:**
- `convert-urls-to-relative.ts` - Convert absolute to relative URLs
- `update-url-format.ts` - Standardize URL formats
- `generate-link-mapping-report.ts` - Report on internal links

**Analysis:**
- `analyze-title-patterns.ts` - Analyze product title patterns
- `apply-fuzzy-matches.ts` - Apply fuzzy matching to data
- `list-tags.ts` - List all product tags
- `filter-products.ts` - Filter products for analysis

**Media:**
- `convert-videos-to-webm.ts` - Convert videos to WebM format

## Built-In Search & Utility Functions

### Search System (`lib/search/` and `lib/utils/search-helpers.ts`)

**Fuse.js Pre-Indexing** (`lib/search/search-index.ts`):
- `correctProductSearchTerm(term)` - Corrects typos in product searches BEFORE DB query
- `correctBlogSearchTerm(term)` - Corrects typos in blog searches BEFORE DB query
- Pre-indexes all product names and blog titles with 5-minute cache
- Handles typos like "rabit" → "rabbit", "reveiw" → "review"

**Search Helpers** (`lib/utils/search-helpers.ts`):
- `tokenizeQuery(query)` - Splits query into searchable terms, removes stop words
- `simpleStem(word)` - Basic English stemming (plurals, -ing, -ed)
- `levenshteinDistance(a, b)` - Calculate edit distance between strings
- `isFuzzyMatch(word1, word2)` - Check if words are fuzzy match
- `textContainsTerm(text, term)` - Check if text contains term (with fuzzy matching)
- `calculateRelevanceScore(item, terms)` - Score item relevance for search terms
- `matchesAllTerms(text, terms)` / `matchesAnyTerm(text, terms)` - Term matching
- `generateSpellingVariants(word)` - Generate typo correction candidates
- `getTopSpellingCorrections(word, limit)` - Get most likely corrections

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

**useSearch.ts**:
- `useProductSearch(query)` - React Query hook for product search
- `useBlogSearch(query)` - React Query hook for blog search
- `useDebounce(value, delay)` - Debounce hook for search inputs

### Validation Schemas (`lib/validations/`)

- `auth.ts` - Zod schemas for login, registration, password reset
- `contact.ts` - Zod schemas for contact forms

### Providers (`components/providers/`)

- `QueryProvider.tsx` - React Query provider with 1min stale time, 5min cache

## Installed Packages for Common Tasks

- **Fuse.js** - Fuzzy search and typo tolerance
- **react-hook-form** + **@hookform/resolvers** - Form handling
- **zod** - Schema validation
- **@tanstack/react-query** - Data fetching and caching
- **dompurify** - XSS protection for HTML content
