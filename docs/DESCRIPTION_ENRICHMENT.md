# Product Description Enrichment Pipeline

## Overview

A CLI pipeline that merges data from 3 feed sources (WordPress DB, Williams Trading XML feeds, STC CSV feed), generates rich HTML descriptions via a local Ollama LLM, and outputs a reviewable CSV for WordPress import.

## Architecture

```
scripts/
  enrich-descriptions.ts          # Main CLI entry point
  lib/
    db.ts                          # (existing) shared MySQL connection
    llm-provider.ts                # Pluggable LLM interface + Ollama implementation
    product-data-merger.ts         # Merges 3 data sources into unified records
    description-generator.ts       # Prompt construction + LLM call + HTML validation
    image-embedder.ts              # Inserts <img> tags into generated HTML sections
    csv-writer.ts                  # RFC 4180 CSV output
    checkpoint.ts                  # Batch checkpoint/resume logic
```

## Usage

```bash
# 1. Analyze data coverage (no LLM needed)
bun scripts/enrich-descriptions.ts --analyze

# 2. Preview sample outputs
bun scripts/enrich-descriptions.ts --dry-run --limit 10

# 3. Small batch to review CSV in spreadsheet
bun scripts/enrich-descriptions.ts --apply --limit 100

# 4. Full run with resume support
bun scripts/enrich-descriptions.ts --apply --resume

# 5. Filter by source, override model
bun scripts/enrich-descriptions.ts --apply --source xml_active --model mistral
bun scripts/enrich-descriptions.ts --apply --batch-size 50 --concurrency 2
```

### CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--analyze` | - | Stats only, no LLM calls |
| `--dry-run` | - | Process samples, print to console |
| `--apply` | - | Full run, output CSV |
| `--limit <n>` | all | Max products to process |
| `--resume` | false | Resume from checkpoint |
| `--batch-size <n>` | 50 | Products per checkpoint save |
| `--concurrency <n>` | 1 | Parallel LLM calls |
| `--source <type>` | all | Filter: `xml_active`, `xml_inactive`, `stc`, `all` |
| `--model <name>` | gpt-oss:20b | Ollama model name |
| `--num-ctx <n>` | 4096 | Context window tokens (lower = less RAM) |
| `--timeout <seconds>` | 180 | Per-request timeout |

## Prerequisites

- **Ollama** running locally (`ollama serve`)
- Model pulled (`ollama pull gpt-oss:20b` — 14GB download, MoE with 3.6B active params, fits 16GB RAM)
- Database access: **Local by Flywheel** running, or SSH tunnel to production with `--remote`

## How It Works

### Data Merge (Step 1)

The merger loads all 3 sources and builds unified product records:

1. **WordPress DB** (source of truth): products, meta, taxonomies, image attachments
2. **XML active feed** (`data/products-filtered.xml`): Williams Trading active products
3. **XML inactive feed** (`data/inactive_products.xml`): Williams Trading inactive products
4. **STC CSV** (`data/stc-product-feed.csv`): STC distributor feed

Merge priority per field: DB taxonomies > XML active > XML inactive > STC

Products are matched across sources by barcode/UPC.

### Description Generation (Step 2)

- **Parent products**: Full HTML (150-400 words) with H2/H3 headings, feature lists, specifications, usage context
- **Variations**: Brief 50-100 word variant-specific description
- **SEO metadata**: Separate prompt generates `meta_title` (60 chars) and `meta_description` (155 chars)
- Validation ensures output has proper HTML structure; retries once then falls back to existing description

### Image Embedding (Step 3)

Gallery images from the DB are distributed into the generated HTML between heading sections (max 5 images, lazy-loaded).

### CSV Output

15-column CSV with: `post_id`, `post_type`, `parent_id`, `sku`, `barcode`, `title`, `post_content` (enriched HTML), `post_excerpt`, `meta_title`, `meta_description`, `brand`, `categories`, `images_embedded`, `data_sources`, `enrichment_status`.

Output file: `data/enriched-descriptions-{timestamp}.csv`

### Checkpoint/Resume

Progress saved to `data/enrichment-checkpoint.json` every batch. Use `--resume` to continue after interruption. Error budget pauses if >20% of a batch fails.

## Product Page SEO (Companion Changes)

Alongside the pipeline, the product page (`app/product/[slug]/page.tsx`) and structured data (`components/seo/StructuredData.tsx`) were updated to support richer metadata:

### Product Schema (JSON-LD) additions
- `gtin` — auto-detected from SKU when it's a 12-13 digit UPC/EAN barcode
- `category` — primary product category
- `material` — from product taxonomy
- `color` — from product taxonomy
- `offers.itemCondition` — `NewCondition`
- `offers.seller` — Organization
- Sale price handling in `offers.price`

### Meta tag improvements
- Title includes brand: "Product Name by Brand"
- `product:brand` and `product:availability` OG meta tags
- Product description renders as sanitized HTML (not stripped plain text)

## What Still Needs To Be Done

### Before First Run
- [ ] Install and start Ollama (`brew install ollama && ollama serve`)
- [ ] Pull the model (`ollama pull llama3.1` or whichever model you prefer)
- [ ] Ensure Local by Flywheel is running with the maleq-local site
- [ ] Run `--analyze` to verify data coverage numbers look right

### After First Batch
- [ ] Review CSV output in a spreadsheet — check quality of generated descriptions
- [ ] Tune prompts in `description-generator.ts` if output style needs adjustment
- [ ] Decide on model (llama3.1 8B is fast; larger models produce better copy)

### WordPress Import
- [ ] Build or configure a WP import script for the CSV (WP All Import or custom)
- [ ] Map CSV columns: `post_content` → description, `post_excerpt` → short description
- [ ] Map `meta_title` and `meta_description` to your SEO plugin's meta fields (or custom post meta if not using a plugin)
- [ ] Test import on a small batch before full import

### Future Improvements
- [ ] Add a `--product-id <id>` flag to re-enrich a single product
- [ ] Add a quality scoring heuristic to auto-flag low-quality outputs in the CSV
- [ ] Consider adding a `--compare` mode that shows before/after diffs
- [ ] Track which products have been imported so re-runs skip already-imported ones
- [ ] Add support for OpenAI/Anthropic API as alternative LLM providers
