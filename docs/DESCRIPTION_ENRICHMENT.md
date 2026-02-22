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
| `--model <name>` | qwen3:14b | Ollama model name |
| `--num-ctx <n>` | 4096 | Context window tokens (lower = less RAM) |
| `--timeout <seconds>` | 180 | Per-request timeout |

## Prerequisites

- **Ollama** running locally (`ollama serve`)
- Model pulled (see recommendations below)
- Database access: **Local by Flywheel** running, or SSH tunnel to production with `--remote`

## Recommended Models (MacBook Pro M1, 32GB RAM)

The default model is `qwen3:14b`. Override with `--model <name>`.

| Model | Ollama Tag | Download | RAM Used | Speed | Best For |
|-------|-----------|----------|----------|-------|----------|
| **Qwen3 14B** | `qwen3:14b` | 9.3GB | ~12-14GB | Fast (~15-25 tok/s) | Daily driver — all-around product copy |
| **Qwen3 30B-A3B** (MoE) | `qwen3:30b` | 19GB | ~19-21GB | Fast (MoE) | Highest quality, varied output |
| **Gemma 3 27B** | `gemma3:27b` | 17GB | ~15-17GB | Moderate (~8-15 tok/s) | Lifestyle/emotional copy |
| **Mistral Small 3.2** | `mistral-small3.2` | 14GB | ~15-17GB | Moderate (~10-18 tok/s) | SEO/structured descriptions |
| **Phi-4 14B** | `phi4:14b` | 8.4GB | ~10-12GB | Fast (~20-30 tok/s) | Lightweight bulk generation |

### Which to use

- **Qwen3 14B** (recommended default): Best balance of speed, quality, and instruction following. Fits comfortably alongside the dev environment. Has toggleable chain-of-thought reasoning. The `<think>` tag stripping in `llm-provider.ts` already handles its reasoning output.
- **Qwen3 30B-A3B**: MoE architecture (only 3.3B params active per token) so it's fast despite the size. Produces more varied copy across thousands of products (less repetitive). Tight on 32GB — close other apps.
- **Gemma 3 27B**: Best creative/emotional tone. Use for featured products, landing pages, category descriptions. Google's QAT version preserves quality at Q4 quantization.
- **Mistral Small 3.2**: Strictest instruction adherence. Best when you need exact formatting compliance (bullet structure, character counts, JSON SEO output).
- **Phi-4 14B**: Fastest option, leaves the most RAM headroom. Good for initial bulk runs where speed matters more than creative flair.

### Too large for 32GB

Llama 4 Scout (109B, ~55GB), DeepSeek V3 (671B), Qwen3 235B, and Qwen3 32B dense (borderline, no context headroom) do not fit.

### Install

```bash
# Pull your preferred model(s)
ollama pull qwen3:14b          # recommended default
ollama pull gemma3:27b         # premium creative copy
ollama pull mistral-small3.2   # structured/SEO copy
```

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
- [ ] Pull the model (`ollama pull qwen3:14b` — see Recommended Models section)
- [ ] Ensure Local by Flywheel is running with the maleq-local site
- [ ] Run `--analyze` to verify data coverage numbers look right

### After First Batch
- [ ] Review CSV output in a spreadsheet — check quality of generated descriptions
- [ ] Tune prompts in `description-generator.ts` if output style needs adjustment
- [ ] Decide on model (see Recommended Models section above — `qwen3:14b` is the default)

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
