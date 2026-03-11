#!/usr/bin/env bun

/**
 * Product Description Enrichment Pipeline
 *
 * Merges data from DB + XML feeds + STC CSV, generates rich HTML descriptions
 * via a local Ollama LLM, and outputs a reviewable CSV for WP import.
 *
 * Two-path architecture:
 *   - Reformat: products with existing descriptions >= 300 chars
 *   - Generate: products with short/no descriptions (varied templates)
 *
 * Usage:
 *   bun scripts/enrich-descriptions.ts --analyze                    # Stats only
 *   bun scripts/enrich-descriptions.ts --dry-run [--limit 10]       # Sample outputs
 *   bun scripts/enrich-descriptions.ts --apply [--resume]           # Full run → CSV
 *   bun scripts/enrich-descriptions.ts --apply --batch-size 50 --concurrency 2
 *   bun scripts/enrich-descriptions.ts --apply --source xml_active  # Only WT active
 *   bun scripts/enrich-descriptions.ts --apply --model mistral      # Override model
 *   bun scripts/enrich-descriptions.ts --dry-run --path reformat    # Only reformat path
 *   bun scripts/enrich-descriptions.ts --dry-run --path generate    # Only generate path
 *
 * Provider selection:
 *   bun scripts/enrich-descriptions.ts --dry-run --provider claude  # Claude Haiku 4.5
 *   bun scripts/enrich-descriptions.ts --dry-run --provider openai  # GPT-5 nano
 *   bun scripts/enrich-descriptions.ts --apply --provider openai --concurrency 5
 */

import { join } from 'path';
import { OllamaProvider, type LLMProvider } from './lib/llm-provider';
import { ClaudeProvider } from './lib/claude-provider';
import { OpenAIProvider } from './lib/openai-provider';
import { mergeAllSources, type MergedProduct, type MergeOptions } from './lib/product-data-merger';
import {
  generateDescription,
  classifyProduct,
  matchCategoryProfile,
  type GeneratedDescription,
} from './lib/description-generator';
import { embedImages } from './lib/image-embedder';
import { parseDimensionsFromDescription } from './lib/description-dimension-parser';
import { writeCsvHeader, appendCsvRows, type CsvRow } from './lib/csv-writer';
import {
  loadCheckpoint,
  saveCheckpoint,
  createCheckpoint,
  shouldPause,
  type CheckpointData,
} from './lib/checkpoint';

// ─── CLI Parsing ───

type ProviderType = 'ollama' | 'claude' | 'openai';

interface CliOptions {
  mode: 'analyze' | 'dry-run' | 'apply' | 'write-local';
  limit?: number;
  resume: boolean;
  batchSize: number;
  concurrency: number;
  source: MergeOptions['source'];
  provider: ProviderType;
  model: string;
  numCtx: number;
  timeoutMs: number;
  pathFilter?: 'enhance' | 'reformat' | 'generate';
  offset: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    mode: 'analyze',
    resume: false,
    batchSize: 50,
    concurrency: 1,
    source: 'all',
    provider: 'ollama',
    model: 'qwen3:14b',
    numCtx: 4096,
    timeoutMs: 180_000,
    offset: 0,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--analyze') opts.mode = 'analyze';
    else if (arg === '--dry-run') opts.mode = 'dry-run';
    else if (arg === '--apply') opts.mode = 'apply';
    else if (arg === '--write-local') opts.mode = 'write-local';
    else if (arg === '--resume') opts.resume = true;
    else if (arg === '--limit' && i + 1 < args.length) {
      opts.limit = parseInt(args[++i], 10);
    } else if (arg === '--batch-size' && i + 1 < args.length) {
      opts.batchSize = parseInt(args[++i], 10);
    } else if (arg === '--concurrency' && i + 1 < args.length) {
      opts.concurrency = parseInt(args[++i], 10);
    } else if (arg === '--source' && i + 1 < args.length) {
      opts.source = args[++i] as MergeOptions['source'];
    } else if (arg === '--provider' && i + 1 < args.length) {
      const val = args[++i] as ProviderType;
      if (!['ollama', 'claude', 'openai'].includes(val)) {
        console.error(`Invalid --provider value: ${val}. Use "ollama", "claude", or "openai".`);
        process.exit(1);
      }
      opts.provider = val;
      // Set default model for the provider if user hasn't explicitly set --model
      if (!args.includes('--model')) {
        if (val === 'claude') opts.model = 'claude-haiku-4-5-20251001';
        else if (val === 'openai') opts.model = 'gpt-4.1-nano';
      }
    } else if (arg === '--model' && i + 1 < args.length) {
      opts.model = args[++i];
    } else if (arg === '--num-ctx' && i + 1 < args.length) {
      opts.numCtx = parseInt(args[++i], 10);
    } else if (arg === '--offset' && i + 1 < args.length) {
      opts.offset = parseInt(args[++i], 10);
    } else if (arg === '--timeout' && i + 1 < args.length) {
      opts.timeoutMs = parseInt(args[++i], 10) * 1000;
    } else if (arg === '--path' && i + 1 < args.length) {
      const val = args[++i];
      if (val === 'enhance' || val === 'reformat' || val === 'generate') {
        opts.pathFilter = val;
      } else {
        console.error(`Invalid --path value: ${val}. Use "enhance", "reformat", or "generate".`);
        process.exit(1);
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Product Description Enrichment Pipeline

Usage:
  bun scripts/enrich-descriptions.ts [mode] [options]

Modes:
  --analyze                Stats only, no LLM calls
  --dry-run                Process samples, print to console
  --apply                  Full run, output CSV
  --write-local            Process and write directly to local DB (requires --local)

Options:
  --limit <n>              Max products to process
  --resume                 Resume from checkpoint
  --batch-size <n>         Products per batch (default: 50)
  --concurrency <n>        Parallel LLM calls (default: 1)
  --source <type>          Filter: xml_active | xml_inactive | stc | all (default: all)
  --provider <type>        LLM provider: ollama | claude | openai (default: ollama)
  --model <name>           Model override (default: qwen3:14b / claude-haiku-4-5-20251001 / gpt-4.1-nano)
  --num-ctx <n>            Context window tokens - Ollama only (default: 4096)
  --timeout <seconds>      Per-request timeout (default: 180)
  --offset <n>             Skip first N products (default: 0)
  --path <type>            Filter by enrichment path: enhance | reformat | generate
  --help                   Show this help

Environment variables:
  ANTHROPIC_API_KEY        Required for --provider claude
  OPENAI_API_KEY           Required for --provider openai
`);
      process.exit(0);
    }
  }

  return opts;
}

// ─── Analyze Mode ───

function printAnalysis(products: MergedProduct[], stats: any): void {
  console.log('\n═══════════════════════════════════════');
  console.log('  DATA MERGE ANALYSIS');
  console.log('═══════════════════════════════════════\n');

  console.log(`Total DB products:     ${stats.totalDbProducts.toLocaleString()}`);
  console.log(`Total DB variations:   ${stats.totalDbVariations.toLocaleString()}`);
  console.log(`XML active matches:    ${stats.xmlActiveMatches.toLocaleString()}`);
  console.log(`XML inactive matches:  ${stats.xmlInactiveMatches.toLocaleString()}`);
  console.log(`STC matches:           ${stats.stcMatches.toLocaleString()}`);
  console.log(`No feed match:         ${stats.noFeedMatch.toLocaleString()}`);

  const parents = products.filter((p) => p.postType === 'product');
  const variations = products.filter((p) => p.postType === 'product_variation');

  console.log(`\nFiltered results:`);
  console.log(`  Parent products:     ${parents.length.toLocaleString()}`);
  console.log(`  Variations:          ${variations.length.toLocaleString()}`);

  // Description coverage
  const withDesc = parents.filter((p) => p.mergedDescription.length > 50);
  const withFeatures = parents.filter((p) => p.mergedFeatures.length > 0);
  const withSpecs = parents.filter((p) => Object.keys(p.mergedSpecifications).length > 0);
  const withImages = parents.filter((p) => p.galleryImageUrls.length > 0);
  const withBrand = parents.filter((p) => p.brand);

  console.log(`\nData coverage (parent products):`);
  console.log(`  Has description:     ${withDesc.length.toLocaleString()} (${pct(withDesc.length, parents.length)})`);
  console.log(`  Has features:        ${withFeatures.length.toLocaleString()} (${pct(withFeatures.length, parents.length)})`);
  console.log(`  Has specifications:  ${withSpecs.length.toLocaleString()} (${pct(withSpecs.length, parents.length)})`);
  console.log(`  Has gallery images:  ${withImages.length.toLocaleString()} (${pct(withImages.length, parents.length)})`);
  console.log(`  Has brand:           ${withBrand.length.toLocaleString()} (${pct(withBrand.length, parents.length)})`);

  // Enrichment path distribution
  const enhanceCount = parents.filter((p) => classifyProduct(p) === 'enhance').length;
  const reformatCount = parents.filter((p) => classifyProduct(p) === 'reformat').length;
  const generateCount = parents.filter((p) => classifyProduct(p) === 'generate').length;
  console.log(`\nEnrichment path distribution:`);
  console.log(`  Enhance  (>= 400 words): ${enhanceCount.toLocaleString()} (${pct(enhanceCount, parents.length)})`);
  console.log(`  Reformat (100-399 words): ${reformatCount.toLocaleString()} (${pct(reformatCount, parents.length)})`);
  console.log(`  Generate (< 100 words):   ${generateCount.toLocaleString()} (${pct(generateCount, parents.length)})`);

  // Category profile distribution
  const profileCounts = new Map<string, number>();
  for (const p of parents) {
    const profile = matchCategoryProfile(p);
    profileCounts.set(profile.id, (profileCounts.get(profile.id) || 0) + 1);
  }
  console.log(`\nCategory profile distribution:`);
  const profileSorted = Array.from(profileCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [profileId, count] of profileSorted) {
    console.log(`  ${profileId.padEnd(20)} ${count.toLocaleString()} (${pct(count, parents.length)})`);
  }

  // Source breakdown
  const sourceGroups = new Map<string, number>();
  for (const p of parents) {
    const key = p.dataSources.sort().join('+');
    sourceGroups.set(key, (sourceGroups.get(key) || 0) + 1);
  }
  console.log(`\nData source combinations:`);
  const sorted = Array.from(sourceGroups.entries()).sort((a, b) => b[1] - a[1]);
  for (const [sources, count] of sorted) {
    console.log(`  ${sources.padEnd(35)} ${count.toLocaleString()}`);
  }

  // Variation size distribution
  const varCounts = parents.filter((p) => p.variationCount > 0);
  const largeGroups = parents.filter((p) => p.variationCount > 50);
  console.log(`\nVariation groups:`);
  console.log(`  Products with variations: ${varCounts.length.toLocaleString()}`);
  console.log(`  Large groups (>50):       ${largeGroups.length.toLocaleString()} (children will be skipped)`);

  // Time estimate
  const totalToProcess = parents.length + variations.filter((v) => {
    const parent = parents.find((p) => p.postId === v.parentId);
    return parent && parent.variationCount <= 50;
  }).length;
  const estimatedSeconds = totalToProcess * 10;
  const hours = Math.floor(estimatedSeconds / 3600);
  const minutes = Math.floor((estimatedSeconds % 3600) / 60);
  console.log(`\nEstimated LLM time: ~${hours}h ${minutes}m (at ~10s/product)`);
}

function pct(num: number, total: number): string {
  if (total === 0) return '0%';
  return `${((num / total) * 100).toFixed(1)}%`;
}

// ─── Process a single product ───

async function processProduct(
  llm: LLMProvider,
  product: MergedProduct,
  options: {
    parentTitle?: string;
    parentHtml?: string;
    variations?: MergedProduct[];
  } = {}
): Promise<{ row: CsvRow; status: string; result: GeneratedDescription }> {
  const result = await generateDescription(llm, product, options);

  // Embed images for parent products with successful generation
  let finalHtml = result.html;
  let imagesEmbedded = 0;

  if (
    product.postType === 'product' &&
    result.status === 'success' &&
    product.galleryImageUrls.length > 0
  ) {
    finalHtml = embedImages(finalHtml, product.galleryImageUrls, product.title, product.brand);
    imagesEmbedded = (finalHtml.match(/<img /gi) || []).length;
  }

  const row: CsvRow = {
    post_id: product.postId,
    post_type: product.postType,
    parent_id: product.parentId || '',
    sku: product.sku,
    barcode: product.barcode,
    title: product.title,
    post_content: finalHtml,
    post_excerpt: result.excerpt,
    meta_title: result.metaTitle,
    meta_description: result.metaDescription,
    focus_keyword: result.focusKeyword,
    brand: product.brand,
    categories: product.categories.join('|'),
    images_embedded: imagesEmbedded,
    data_sources: product.dataSources.join('|'),
    enrichment_status: result.status,
    enrichment_path: result.path,
  };

  return { row, status: result.status, result };
}

// ─── Dry-Run Mode ───

async function runDryRun(
  llm: LLMProvider,
  products: MergedProduct[],
  limit: number,
  pathFilter?: 'enhance' | 'reformat' | 'generate'
): Promise<void> {
  let parents = products.filter((p) => p.postType === 'product');

  // Apply path filter if specified
  if (pathFilter) {
    parents = parents.filter((p) => classifyProduct(p) === pathFilter);
    console.log(`\nFiltered to ${pathFilter} path: ${parents.length} products available`);
  }

  const sample = parents.slice(0, limit);
  const variantCount = 5;

  console.log(`\nDry run: processing ${sample.length} sample products...\n`);

  for (const product of sample) {
    const enrichPath = classifyProduct(product);
    const profile = matchCategoryProfile(product);
    const variantIdx = product.postId % variantCount;

    console.log('─'.repeat(60));
    console.log(`Product #${product.postId}: ${product.title}`);
    console.log(`Brand: ${product.brand || '(none)'} | Categories: ${product.categories.join(', ') || '(none)'}`);
    console.log(`Sources: ${product.dataSources.join(', ')}`);
    console.log(`Gallery images: ${product.galleryImageUrls.length}`);
    console.log(`Path: ${enrichPath} | Profile: ${profile.id} | Variant: ${variantIdx}`);

    const { row, status, result } = await processProduct(llm, product, {});

    console.log(`\nStatus: ${status}`);
    console.log(`SEO Title: ${row.meta_title}`);
    console.log(`SEO Description: ${row.meta_description}`);
    console.log(`Excerpt: ${row.post_excerpt}`);
    console.log('');
  }
}

// ─── Apply Mode ───

async function runApply(
  llm: LLMProvider,
  products: MergedProduct[],
  opts: CliOptions
): Promise<void> {
  const csvPath = join(process.cwd(), 'data', `enriched-descriptions-${Date.now()}.csv`);

  // Load or create checkpoint
  let checkpoint: CheckpointData;
  if (opts.resume) {
    const existing = loadCheckpoint();
    if (existing) {
      console.log(`\nResuming from checkpoint (${existing.processedIds.length} already processed)`);
      checkpoint = existing;
    } else {
      console.log('\nNo checkpoint found, starting fresh');
      checkpoint = createCheckpoint(csvPath);
      writeCsvHeader(csvPath);
    }
  } else {
    checkpoint = createCheckpoint(csvPath);
    writeCsvHeader(csvPath);
  }

  const processedSet = new Set(checkpoint.processedIds);

  // Separate parents and variations, filter already-processed
  let parents = products
    .filter((p) => p.postType === 'product' && !processedSet.has(p.postId));

  // Apply path filter
  if (opts.pathFilter) {
    parents = parents.filter((p) => classifyProduct(p) === opts.pathFilter);
    console.log(`Filtered to ${opts.pathFilter} path: ${parents.length} products`);
  }

  const variationsByParent = new Map<number, MergedProduct[]>();
  for (const v of products.filter((p) => p.postType === 'product_variation')) {
    const list = variationsByParent.get(v.parentId!) || [];
    list.push(v);
    variationsByParent.set(v.parentId!, list);
  }

  // Apply limit
  const toProcess = opts.limit ? parents.slice(0, opts.limit) : parents;

  console.log(`\nProcessing ${toProcess.length} parent products...`);
  console.log(`   Output: ${checkpoint.csvPath || csvPath}`);
  console.log(`   Batch size: ${opts.batchSize}, Concurrency: ${opts.concurrency}\n`);

  const outputPath = checkpoint.csvPath || csvPath;
  let totalProcessed = 0;

  // Process in batches
  for (let batchStart = 0; batchStart < toProcess.length; batchStart += opts.batchSize) {
    const batch = toProcess.slice(batchStart, batchStart + opts.batchSize);
    const batchRows: CsvRow[] = [];
    let batchErrors = 0;

    // Process parents with concurrency control
    for (let i = 0; i < batch.length; i += opts.concurrency) {
      const chunk = batch.slice(i, i + opts.concurrency);

      // Process parents — pass variation data so LLM can write comprehensive parent descriptions
      const results = await Promise.all(
        chunk.map((product) => {
          const childVariations = variationsByParent.get(product.postId) || [];
          return processProduct(llm, product, {
            variations: childVariations.length > 0 ? childVariations : undefined,
          });
        })
      );

      for (let j = 0; j < results.length; j++) {
        const { row, status, result } = results[j];
        const product = chunk[j];

        batchRows.push(row);
        checkpoint.processedIds.push(product.postId);

        if (status === 'success') checkpoint.successCount++;
        else if (status === 'fallback') checkpoint.fallbackCount++;
        else if (status === 'error') {
          checkpoint.errorCount++;
          batchErrors++;
          checkpoint.errors.push({ postId: product.postId, error: row.enrichment_status });
        }

        // Process variations — pass parent's generated HTML so variations avoid repeating info
        if (product.variationCount > 0 && product.variationCount <= 50) {
          const childVariations = (variationsByParent.get(product.postId) || [])
            .filter((v) => !processedSet.has(v.postId));

          for (const variation of childVariations) {
            const varResult = await processProduct(llm, variation, {
              parentTitle: product.title,
              parentHtml: result.html,
            });
            batchRows.push(varResult.row);
            checkpoint.processedIds.push(variation.postId);
            if (varResult.status === 'success') checkpoint.successCount++;
            else if (varResult.status === 'fallback') checkpoint.fallbackCount++;
            else checkpoint.errorCount++;
          }
        }

        totalProcessed++;
      }
    }

    // Write batch to CSV
    appendCsvRows(outputPath, batchRows);

    // Save checkpoint
    saveCheckpoint(checkpoint);

    const progress = Math.min(batchStart + opts.batchSize, toProcess.length);
    console.log(
      `  Batch ${Math.floor(batchStart / opts.batchSize) + 1}: ` +
        `${progress}/${toProcess.length} parents | ` +
        `✓ ${checkpoint.successCount} | ↩ ${checkpoint.fallbackCount} | ✗ ${checkpoint.errorCount}`
    );

    // Error budget check
    if (shouldPause(batchErrors, batch.length)) {
      console.error(
        `\nError rate too high (${batchErrors}/${batch.length} in last batch). Pausing.`
      );
      console.error('   Review errors in checkpoint, fix issues, then --resume.');
      break;
    }
  }

  // Summary
  printSummary(checkpoint, outputPath, products);
}

function printSummary(checkpoint: CheckpointData, csvPath: string, allProducts: MergedProduct[]): void {
  console.log('\n═══════════════════════════════════════');
  console.log('  ENRICHMENT SUMMARY');
  console.log('═══════════════════════════════════════\n');

  console.log(`Total processed:  ${checkpoint.processedIds.length.toLocaleString()}`);
  console.log(`  Successful:     ${checkpoint.successCount.toLocaleString()}`);
  console.log(`  Fallback:       ${checkpoint.fallbackCount.toLocaleString()}`);
  console.log(`  Errors:         ${checkpoint.errorCount.toLocaleString()}`);
  console.log(`\nOutput CSV: ${csvPath}`);

  if (checkpoint.errors.length > 0) {
    console.log(`\nRecent errors:`);
    for (const err of checkpoint.errors.slice(-5)) {
      console.log(`  Product #${err.postId}: ${err.error}`);
    }
  }

  // Print 5 random successful samples for quick review
  const successIds = new Set(checkpoint.processedIds);
  const samples = allProducts
    .filter((p) => p.postType === 'product' && successIds.has(p.postId))
    .sort(() => Math.random() - 0.5)
    .slice(0, 5);

  if (samples.length > 0) {
    console.log(`\nRandom sample products (check CSV for full content):`);
    for (const s of samples) {
      console.log(`  #${s.postId}: ${s.title} [${s.brand || 'no brand'}]`);
    }
  }
}

// ─── Write-Local Mode ───

async function runWriteLocal(
  llm: LLMProvider,
  products: MergedProduct[],
  opts: CliOptions
): Promise<void> {
  // Safety check: must use --local flag
  if (!process.argv.includes('--local')) {
    console.error('\n✗ --write-local requires --local flag to prevent accidental production writes.');
    process.exit(1);
  }

  const { getConnection } = await import('./lib/db');
  const { writeFileSync, appendFileSync } = await import('fs');
  const db = await getConnection();

  // Load or create checkpoint for auto-resume
  let checkpoint = loadCheckpoint();
  if (checkpoint && checkpoint.processedIds.length > 0) {
    console.log(`\n↻ Resuming from checkpoint (${checkpoint.processedIds.length} already processed: ✓ ${checkpoint.successCount} | ✗ ${checkpoint.errorCount})`);
  } else {
    checkpoint = createCheckpoint('write-local');
  }
  const processedSet = new Set(checkpoint.processedIds);

  // Separate parents and variations, skip already-processed
  let parents = products
    .filter((p) => p.postType === 'product' && !processedSet.has(p.postId));

  if (opts.pathFilter) {
    parents = parents.filter((p) => classifyProduct(p) === opts.pathFilter);
    console.log(`Filtered to ${opts.pathFilter} path: ${parents.length} products remaining`);
  }

  const variationsByParent = new Map<number, MergedProduct[]>();
  for (const v of products.filter((p) => p.postType === 'product_variation')) {
    const list = variationsByParent.get(v.parentId!) || [];
    list.push(v);
    variationsByParent.set(v.parentId!, list);
  }

  // Apply offset then limit (offset is on top of checkpoint skip)
  const afterOffset = opts.offset > 0 ? parents.slice(opts.offset) : parents;
  const toProcess = opts.limit ? afterOffset.slice(0, opts.limit) : afterOffset;

  const totalParents = products.filter((p) => p.postType === 'product').length;
  console.log(`\nProcessing ${toProcess.length} parent products → local DB...`);
  console.log(`   Already done: ${processedSet.size}/${totalParents}`);
  if (opts.offset > 0) console.log(`   Offset: ${opts.offset}`);
  console.log(`   Concurrency: ${opts.concurrency}`);
  console.log(`   Checkpoint: auto-saved every batch\n`);

  // Persistent URL list file (append mode)
  const urlListPath = join(process.cwd(), 'data', 'enriched-urls.txt');
  let sessionSuccess = 0;
  let sessionErrors = 0;
  let sessionVariations = 0;
  let sessionMetaFilled = 0;

  for (let i = 0; i < toProcess.length; i += opts.concurrency) {
    const chunk = toProcess.slice(i, i + opts.concurrency);

    const results = await Promise.all(
      chunk.map((product) => {
        const childVariations = variationsByParent.get(product.postId) || [];
        return processProduct(llm, product, {
          variations: childVariations.length > 0 ? childVariations : undefined,
        });
      })
    );

    for (let j = 0; j < results.length; j++) {
      const { row, status, result } = results[j];
      const product = chunk[j];

      if (status === 'success') {
        // Write parent to DB
        await db.execute(
          'UPDATE wp_posts SET post_content = ?, post_excerpt = ? WHERE ID = ?',
          [row.post_content, row.post_excerpt, product.postId]
        );

        // Write SEO meta if present
        if (row.meta_title) {
          await upsertMeta(db, product.postId, '_yoast_wpseo_title', row.meta_title);
        }
        if (row.meta_description) {
          await upsertMeta(db, product.postId, '_yoast_wpseo_metadesc', row.meta_description);
        }
        if (row.focus_keyword) {
          await upsertMeta(db, product.postId, '_yoast_wpseo_focuskw', row.focus_keyword);
        }

        // Fill missing physical meta from feed data
        sessionMetaFilled += await fillMissingPhysicalMeta(db, product);

        // Append URL to persistent file
        appendFileSync(urlListPath, `/product/${product.slug}\n`);
        checkpoint.successCount++;
        sessionSuccess++;

        // Process variations
        if (product.variationCount > 0 && product.variationCount <= 50) {
          const childVariations = variationsByParent.get(product.postId) || [];
          for (const variation of childVariations) {
            const varResult = await processProduct(llm, variation, {
              parentTitle: product.title,
              parentHtml: result.html,
            });
            if (varResult.status === 'success') {
              await db.execute(
                'UPDATE wp_posts SET post_content = ?, post_excerpt = ? WHERE ID = ?',
                [varResult.row.post_content, varResult.row.post_excerpt, variation.postId]
              );
              sessionVariations++;
            }
            // Fill missing physical meta for variation regardless of description status
            sessionMetaFilled += await fillMissingPhysicalMeta(db, variation);
            checkpoint.processedIds.push(variation.postId);
          }
        }
      } else {
        checkpoint.errorCount++;
        sessionErrors++;
        checkpoint.errors.push({ postId: product.postId, error: result.error || status });
        console.warn(`  ⚠ Skipped #${product.postId} (${status}): ${result.error || 'unknown'}`);
      }

      checkpoint.processedIds.push(product.postId);
    }

    // Save checkpoint after every batch
    saveCheckpoint(checkpoint);

    const progress = Math.min(i + opts.concurrency, toProcess.length);
    const totalDone = checkpoint.successCount + checkpoint.errorCount;
    console.log(`  ${progress}/${toProcess.length} (${totalDone}/${totalParents} total) | ✓ ${sessionSuccess} | ✗ ${sessionErrors} | vars: ${sessionVariations} | meta: ${sessionMetaFilled}`);
  }

  await db.end();

  // Print summary
  console.log('\n═══════════════════════════════════════');
  console.log('  WRITE-LOCAL SUMMARY');
  console.log('═══════════════════════════════════════\n');
  console.log(`This session:`);
  console.log(`  Parents updated:     ${sessionSuccess}`);
  console.log(`  Variations updated:  ${sessionVariations}`);
  console.log(`  Meta fields filled:  ${sessionMetaFilled}`);
  console.log(`  Errors/skipped:      ${sessionErrors}`);
  console.log(`\nAll-time (checkpoint):`);
  console.log(`  Total processed:     ${checkpoint.processedIds.length}`);
  console.log(`  Successful:          ${checkpoint.successCount}`);
  console.log(`  Errors:              ${checkpoint.errorCount}`);
  console.log(`  Remaining:           ~${totalParents - checkpoint.successCount - checkpoint.errorCount}`);

  // Print usage stats if available
  const usage = llm.getUsage?.();
  if (usage && usage.totalCalls > 0) {
    console.log(`\nAPI usage (this session):`);
    console.log(`  Calls: ${usage.totalCalls}`);
    console.log(`  Input tokens: ${usage.inputTokens.toLocaleString()}`);
    console.log(`  Output tokens: ${usage.outputTokens.toLocaleString()}`);
  }

  console.log(`\nURL list: ${urlListPath}`);
  console.log(`Checkpoint: data/enrichment-checkpoint.json`);
  console.log(`\nTo continue: re-run the same command — it auto-resumes from checkpoint.`);
}

/** Fill missing physical product meta (weight, dimensions) from feed data or description text */
async function fillMissingPhysicalMeta(db: any, product: MergedProduct): Promise<number> {
  let filled = 0;
  const fills: Array<[string, string]> = [];

  // Parse dimensions from description as third-tier fallback
  const descDims = (!product.dbWeight || !product.dbLength || !product.dbWidth || !product.dbHeight)
    ? parseDimensionsFromDescription(product.mergedDescription || product.existingDescription)
    : null;

  // Priority: feed data > description text (DB is already filled, so skip those)
  const weight = product.feedWeight || descDims?.weight || '';
  const length = product.feedLength || descDims?.length || '';
  const width = product.feedWidth || descDims?.width || '';
  const height = product.feedHeight || descDims?.height || '';
  const insertableLength = product.feedInsertableLength || descDims?.insertableLength || '';
  const innerDiameter = product.feedInnerDiameter || descDims?.innerDiameter || '';

  if (!product.dbWeight && weight) fills.push(['_weight', weight]);
  if (!product.dbLength && length) fills.push(['_length', length]);
  if (!product.dbWidth && width) fills.push(['_width', width]);
  if (!product.dbHeight && height) fills.push(['_height', height]);
  if (!product.dbInsertableLength && insertableLength) fills.push(['_insertable_length', insertableLength]);
  if (!product.dbInnerDiameter && innerDiameter) fills.push(['_inner_diameter', innerDiameter]);

  for (const [key, value] of fills) {
    await upsertMeta(db, product.postId, key, value);
    filled++;
  }

  return filled;
}

/** Upsert a wp_postmeta row */
async function upsertMeta(db: any, postId: number, metaKey: string, metaValue: string): Promise<void> {
  const [existing] = await db.execute(
    'SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = ? LIMIT 1',
    [postId, metaKey]
  );
  if ((existing as any[]).length > 0) {
    await db.execute(
      'UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = ?',
      [metaValue, postId, metaKey]
    );
  } else {
    await db.execute(
      'INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)',
      [postId, metaKey, metaValue]
    );
  }
}

// ─── Provider Factory ───

function createProvider(opts: CliOptions): LLMProvider {
  switch (opts.provider) {
    case 'claude':
      return new ClaudeProvider({
        model: opts.model,
        timeoutMs: opts.timeoutMs,
      });
    case 'openai':
      return new OpenAIProvider({
        model: opts.model,
        timeoutMs: opts.timeoutMs,
      });
    case 'ollama':
    default:
      return new OllamaProvider({
        model: opts.model,
        numCtx: opts.numCtx,
        timeoutMs: opts.timeoutMs,
      });
  }
}

// ─── Main ───

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log('Product Description Enrichment Pipeline');
  console.log(`   Mode: ${opts.mode} | Provider: ${opts.provider} | Model: ${opts.model}`);
  if (opts.provider === 'ollama') {
    console.log(`   Context: ${opts.numCtx} tokens`);
  }
  if (opts.pathFilter) {
    console.log(`   Path filter: ${opts.pathFilter}`);
  }

  // Step 1: Merge all data sources
  const { products, stats } = await mergeAllSources({ source: opts.source });

  // Step 2: Route to mode
  if (opts.mode === 'analyze') {
    printAnalysis(products, stats);
    return;
  }

  // For dry-run and apply, we need the LLM
  const llm = createProvider(opts);

  try {
    await llm.healthCheck();
  } catch (err: any) {
    console.error(`\n${err.message}`);
    process.exit(1);
  }

  if (opts.mode === 'dry-run') {
    await runDryRun(llm, products, opts.limit || 5, opts.pathFilter);
    return;
  }

  if (opts.mode === 'apply') {
    await runApply(llm, products, opts);
    return;
  }

  if (opts.mode === 'write-local') {
    await runWriteLocal(llm, products, opts);
    return;
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
