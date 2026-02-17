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
 */

import { join } from 'path';
import { OllamaProvider } from './lib/llm-provider';
import { mergeAllSources, type MergedProduct, type MergeOptions } from './lib/product-data-merger';
import {
  generateDescription,
  classifyProduct,
  matchCategoryProfile,
  type GeneratedDescription,
} from './lib/description-generator';
import { embedImages } from './lib/image-embedder';
import { writeCsvHeader, appendCsvRows, type CsvRow } from './lib/csv-writer';
import {
  loadCheckpoint,
  saveCheckpoint,
  createCheckpoint,
  shouldPause,
  type CheckpointData,
} from './lib/checkpoint';

// ─── CLI Parsing ───

interface CliOptions {
  mode: 'analyze' | 'dry-run' | 'apply';
  limit?: number;
  resume: boolean;
  batchSize: number;
  concurrency: number;
  source: MergeOptions['source'];
  model: string;
  numCtx: number;
  timeoutMs: number;
  pathFilter?: 'reformat' | 'generate';
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    mode: 'analyze',
    resume: false,
    batchSize: 50,
    concurrency: 1,
    source: 'all',
    model: 'qwen3:8b',
    numCtx: 4096,
    timeoutMs: 180_000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--analyze') opts.mode = 'analyze';
    else if (arg === '--dry-run') opts.mode = 'dry-run';
    else if (arg === '--apply') opts.mode = 'apply';
    else if (arg === '--resume') opts.resume = true;
    else if (arg === '--limit' && i + 1 < args.length) {
      opts.limit = parseInt(args[++i], 10);
    } else if (arg === '--batch-size' && i + 1 < args.length) {
      opts.batchSize = parseInt(args[++i], 10);
    } else if (arg === '--concurrency' && i + 1 < args.length) {
      opts.concurrency = parseInt(args[++i], 10);
    } else if (arg === '--source' && i + 1 < args.length) {
      opts.source = args[++i] as MergeOptions['source'];
    } else if (arg === '--model' && i + 1 < args.length) {
      opts.model = args[++i];
    } else if (arg === '--num-ctx' && i + 1 < args.length) {
      opts.numCtx = parseInt(args[++i], 10);
    } else if (arg === '--timeout' && i + 1 < args.length) {
      opts.timeoutMs = parseInt(args[++i], 10) * 1000;
    } else if (arg === '--path' && i + 1 < args.length) {
      const val = args[++i];
      if (val === 'reformat' || val === 'generate') {
        opts.pathFilter = val;
      } else {
        console.error(`Invalid --path value: ${val}. Use "reformat" or "generate".`);
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

Options:
  --limit <n>              Max products to process
  --resume                 Resume from checkpoint
  --batch-size <n>         Products per batch (default: 50)
  --concurrency <n>        Parallel LLM calls (default: 1)
  --source <type>          Filter: xml_active | xml_inactive | stc | all (default: all)
  --model <name>           Ollama model (default: gpt-oss:20b)
  --num-ctx <n>            Context window tokens (default: 4096, lower = less RAM)
  --timeout <seconds>      Per-request timeout (default: 180)
  --path <type>            Filter by enrichment path: reformat | generate
  --help                   Show this help
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
  const reformatCount = parents.filter((p) => classifyProduct(p) === 'reformat').length;
  const generateCount = parents.length - reformatCount;
  console.log(`\nEnrichment path distribution:`);
  console.log(`  Reformat (>= 300 chars): ${reformatCount.toLocaleString()} (${pct(reformatCount, parents.length)})`);
  console.log(`  Generate (< 300 chars):  ${generateCount.toLocaleString()} (${pct(generateCount, parents.length)})`);

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
  llm: OllamaProvider,
  product: MergedProduct,
  parentTitle?: string
): Promise<{ row: CsvRow; status: string; result: GeneratedDescription }> {
  const result = await generateDescription(llm, product, parentTitle);

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
  llm: OllamaProvider,
  products: MergedProduct[],
  limit: number,
  pathFilter?: 'reformat' | 'generate'
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

    const { row, status, result } = await processProduct(llm, product);

    console.log(`\nStatus: ${status}`);
    console.log(`SEO Title: ${row.meta_title}`);
    console.log(`SEO Description: ${row.meta_description}`);
    console.log(`Excerpt: ${row.post_excerpt}`);
    console.log('');
  }
}

// ─── Apply Mode ───

async function runApply(
  llm: OllamaProvider,
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

      const results = await Promise.all(
        chunk.map((product) => processProduct(llm, product))
      );

      for (let j = 0; j < results.length; j++) {
        const { row, status } = results[j];
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

        // Process variations for this parent (if not too many)
        if (product.variationCount > 0 && product.variationCount <= 50) {
          const childVariations = (variationsByParent.get(product.postId) || [])
            .filter((v) => !processedSet.has(v.postId));

          for (const variation of childVariations) {
            const varResult = await processProduct(llm, variation, product.title);
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

// ─── Main ───

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log('Product Description Enrichment Pipeline');
  console.log(`   Mode: ${opts.mode} | Source: ${opts.source} | Model: ${opts.model} | Context: ${opts.numCtx} tokens`);
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
  const llm = new OllamaProvider({
    model: opts.model,
    numCtx: opts.numCtx,
    timeoutMs: opts.timeoutMs,
  });

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
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
