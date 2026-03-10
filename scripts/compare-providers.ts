#!/usr/bin/env bun

/**
 * LLM Provider Comparison Script
 *
 * Runs the same set of products through multiple LLM providers and outputs
 * a side-by-side HTML comparison report for quality evaluation.
 *
 * Usage:
 *   bun scripts/compare-providers.ts                           # 100 products, claude vs openai
 *   bun scripts/compare-providers.ts --limit 50                # Custom sample size
 *   bun scripts/compare-providers.ts --providers claude,openai,ollama  # Include Ollama
 *   bun scripts/compare-providers.ts --concurrency 5           # Parallel API calls
 *   bun scripts/compare-providers.ts --source xml_active       # Filter by data source
 *
 * Requires:
 *   ANTHROPIC_API_KEY   (for claude)
 *   OPENAI_API_KEY      (for openai)
 *   Ollama running       (for ollama)
 */

import { join } from 'path';
import { writeFileSync } from 'fs';
import { OllamaProvider, type LLMProvider, type TokenUsage } from './lib/llm-provider';
import { ClaudeProvider } from './lib/claude-provider';
import { OpenAIProvider } from './lib/openai-provider';
import {
  mergeAllSources,
  type MergedProduct,
  type MergeOptions,
} from './lib/product-data-merger';
import {
  generateDescription,
  classifyProduct,
  matchCategoryProfile,
  type GeneratedDescription,
} from './lib/description-generator';
import { embedImages } from './lib/image-embedder';

// ─── Types ───

interface ProviderResult {
  providerName: string;
  model: string;
  result: GeneratedDescription;
  durationMs: number;
  inputTokensEstimate: number;
  outputTokensEstimate: number;
}

interface ProductComparison {
  product: MergedProduct;
  enrichPath: string;
  categoryProfile: string;
  results: ProviderResult[];
}

interface ComparisonStats {
  providerName: string;
  model: string;
  totalProducts: number;
  successCount: number;
  fallbackCount: number;
  errorCount: number;
  avgDurationMs: number;
  totalDurationMs: number;
  estimatedCostUsd: number;
  avgDescriptionLength: number;
  avgMetaTitleLength: number;
  avgMetaDescLength: number;
  htmlValidationRate: number;
  // Real API usage (populated when provider tracks usage)
  realInputTokens?: number;
  realOutputTokens?: number;
  realReasoningTokens?: number;
  realTotalCalls?: number;
  realCostUsd?: number;
}

// ─── CLI Parsing ───

interface CliOptions {
  limit: number;
  providers: string[];
  concurrency: number;
  source: MergeOptions['source'];
  claudeModel: string;
  openaiModel: string;
  ollamaModel: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    limit: 100,
    providers: ['openai'],
    concurrency: 3,
    source: 'all',
    claudeModel: 'claude-haiku-4-5-20251001',
    openaiModel: 'gpt-4.1-nano',
    ollamaModel: 'qwen3:14b',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit' && i + 1 < args.length) {
      opts.limit = parseInt(args[++i], 10);
    } else if (arg === '--providers' && i + 1 < args.length) {
      opts.providers = args[++i].split(',').map((s) => s.trim());
    } else if (arg === '--concurrency' && i + 1 < args.length) {
      opts.concurrency = parseInt(args[++i], 10);
    } else if (arg === '--source' && i + 1 < args.length) {
      opts.source = args[++i] as MergeOptions['source'];
    } else if (arg === '--claude-model' && i + 1 < args.length) {
      opts.claudeModel = args[++i];
    } else if (arg === '--openai-model' && i + 1 < args.length) {
      opts.openaiModel = args[++i];
    } else if (arg === '--ollama-model' && i + 1 < args.length) {
      opts.ollamaModel = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
LLM Provider Comparison

Usage:
  bun scripts/compare-providers.ts [options]

Options:
  --limit <n>              Products to compare (default: 100)
  --providers <list>       Comma-separated: claude,openai,ollama (default: openai)
  --concurrency <n>        Parallel calls per provider (default: 3)
  --source <type>          Filter: xml_active | xml_inactive | stc | all (default: all)
  --claude-model <name>    Claude model (default: claude-haiku-4-5-20251001)
  --openai-model <name>    OpenAI model (default: gpt-4.1-nano)
  --ollama-model <name>    Ollama model (default: qwen3:14b)
  --help                   Show this help
`);
      process.exit(0);
    }
  }

  return opts;
}

// ─── Provider Factory ───

function createProviders(opts: CliOptions): Map<string, { llm: LLMProvider; model: string }> {
  const providers = new Map<string, { llm: LLMProvider; model: string }>();

  for (const name of opts.providers) {
    switch (name) {
      case 'claude':
        providers.set('claude', {
          llm: new ClaudeProvider({ model: opts.claudeModel }),
          model: opts.claudeModel,
        });
        break;
      case 'openai':
        providers.set('openai', {
          llm: new OpenAIProvider({ model: opts.openaiModel }),
          model: opts.openaiModel,
        });
        break;
      case 'ollama':
        providers.set('ollama', {
          llm: new OllamaProvider({ model: opts.ollamaModel }),
          model: opts.ollamaModel,
        });
        break;
      default:
        console.error(`Unknown provider: ${name}`);
        process.exit(1);
    }
  }

  return providers;
}

// ─── Token Estimation ───

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English
  return Math.ceil(text.length / 4);
}

// ─── Pricing (per 1M tokens) ───

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'gpt-5-nano': { input: 0.05, output: 0.40 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  // Ollama is free (local)
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

// ─── Sample Selection ───

function selectDiverseSample(products: MergedProduct[], limit: number): MergedProduct[] {
  const parents = products.filter((p) => p.postType === 'product');

  // Group by category profile and enrichment path
  const buckets = new Map<string, MergedProduct[]>();
  for (const p of parents) {
    const profile = matchCategoryProfile(p);
    const path = classifyProduct(p);
    const key = `${profile.id}:${path}`;
    const list = buckets.get(key) || [];
    list.push(p);
    buckets.set(key, list);
  }

  // Round-robin sample from each bucket
  const selected: MergedProduct[] = [];
  const bucketEntries = Array.from(buckets.entries()).sort(
    (a, b) => b[1].length - a[1].length
  );

  let idx = 0;
  while (selected.length < limit && idx < limit * 10) {
    for (const [, items] of bucketEntries) {
      if (selected.length >= limit) break;
      const itemIdx = Math.floor(idx / bucketEntries.length);
      if (itemIdx < items.length) {
        selected.push(items[itemIdx]);
      }
    }
    idx++;
  }

  // If we still need more, fill from the largest bucket
  if (selected.length < limit) {
    const remaining = parents.filter((p) => !selected.includes(p));
    selected.push(...remaining.slice(0, limit - selected.length));
  }

  return selected.slice(0, limit);
}

// ─── Process Single Product ───

async function processWithProvider(
  llm: LLMProvider,
  providerName: string,
  model: string,
  product: MergedProduct,
  variations?: MergedProduct[]
): Promise<ProviderResult> {
  const start = performance.now();

  const result = await generateDescription(llm, product, {
    variations: variations && variations.length > 0 ? variations : undefined,
  });

  const durationMs = Math.round(performance.now() - start);

  // Estimate tokens from the product context (input) and output
  const inputEstimate = estimateTokens(
    [product.title, product.brand, product.mergedDescription, product.mergedFeatures.join(' ')]
      .filter(Boolean)
      .join(' ')
  ) + 500; // system prompt overhead

  const outputEstimate = estimateTokens(result.html + result.excerpt + result.metaTitle + result.metaDescription);

  return {
    providerName,
    model,
    result,
    durationMs,
    inputTokensEstimate: inputEstimate,
    outputTokensEstimate: outputEstimate,
  };
}

// ─── Run Comparison ───

async function runComparison(
  providers: Map<string, { llm: LLMProvider; model: string }>,
  products: MergedProduct[],
  concurrency: number,
  allProducts?: MergedProduct[]
): Promise<ProductComparison[]> {
  // Build variation lookup so parent prompts include child variation data
  const variationsByParent = new Map<number, MergedProduct[]>();
  if (allProducts) {
    for (const p of allProducts) {
      if (p.postType === 'product_variation' && p.parentId) {
        const list = variationsByParent.get(p.parentId) || [];
        list.push(p);
        variationsByParent.set(p.parentId, list);
      }
    }
  }
  const comparisons: ProductComparison[] = [];
  const total = products.length;

  for (let i = 0; i < total; i += concurrency) {
    const batch = products.slice(i, i + concurrency);

    // Process batch: all products × all providers
    const batchResults = await Promise.all(
      batch.map(async (product) => {
        const profile = matchCategoryProfile(product);
        const path = classifyProduct(product);

        // Start with the original description as a pseudo-provider for comparison
        const originalHtml = product.existingDescription || product.mergedDescription || '';
        const providerResults: ProviderResult[] = [{
          providerName: 'original',
          model: 'database',
          result: {
            html: originalHtml,
            excerpt: product.existingExcerpt || '',
            metaTitle: '',
            metaDescription: '',
            status: originalHtml ? 'success' : 'fallback',
            path: path as any,
          },
          durationMs: 0,
          inputTokensEstimate: 0,
          outputTokensEstimate: 0,
        }];

        const childVariations = variationsByParent.get(product.postId) || [];

        // Run LLM providers sequentially per product to keep prompts deterministic
        for (const [name, { llm, model }] of Array.from(providers.entries())) {
          try {
            const result = await processWithProvider(llm, name, model, product, childVariations);
            providerResults.push(result);
          } catch (err: any) {
            providerResults.push({
              providerName: name,
              model,
              result: {
                html: '',
                excerpt: '',
                metaTitle: '',
                metaDescription: '',
                status: 'error',
                error: err.message,
                path: path as any,
              },
              durationMs: 0,
              inputTokensEstimate: 0,
              outputTokensEstimate: 0,
            });
          }
        }

        return {
          product,
          enrichPath: path,
          categoryProfile: profile.id,
          results: providerResults,
        };
      })
    );

    comparisons.push(...batchResults);

    const progress = Math.min(i + concurrency, total);
    const pct = ((progress / total) * 100).toFixed(0);
    console.log(`  ${progress}/${total} products (${pct}%)`);
  }

  return comparisons;
}

// ─── Stats Calculation ───

function calculateStats(
  providerName: string,
  model: string,
  comparisons: ProductComparison[]
): ComparisonStats {
  const results = comparisons
    .map((c) => c.results.find((r) => r.providerName === providerName))
    .filter((r): r is ProviderResult => !!r);

  const successful = results.filter((r) => r.result.status === 'success');
  const durations = results.map((r) => r.durationMs).filter((d) => d > 0);

  const totalInput = results.reduce((sum, r) => sum + r.inputTokensEstimate, 0);
  const totalOutput = results.reduce((sum, r) => sum + r.outputTokensEstimate, 0);

  const descLengths = successful.map((r) => r.result.html.length).filter((l) => l > 0);
  const titleLengths = successful.map((r) => r.result.metaTitle.length).filter((l) => l > 0);
  const descMetaLengths = successful.map((r) => r.result.metaDescription.length).filter((l) => l > 0);

  const hasHeading = successful.filter((r) => /<h[23]>/i.test(r.result.html));
  const hasParagraph = successful.filter((r) => /<p>/i.test(r.result.html));
  const validHtml = successful.filter(
    (r) => /<h[23]>/i.test(r.result.html) && /<p>/i.test(r.result.html) && r.result.html.length >= 200
  );

  return {
    providerName,
    model,
    totalProducts: results.length,
    successCount: successful.length,
    fallbackCount: results.filter((r) => r.result.status === 'fallback').length,
    errorCount: results.filter((r) => r.result.status === 'error').length,
    avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    totalDurationMs: durations.reduce((a, b) => a + b, 0),
    estimatedCostUsd: estimateCost(model, totalInput, totalOutput),
    avgDescriptionLength: descLengths.length ? Math.round(descLengths.reduce((a, b) => a + b, 0) / descLengths.length) : 0,
    avgMetaTitleLength: titleLengths.length ? Math.round(titleLengths.reduce((a, b) => a + b, 0) / titleLengths.length) : 0,
    avgMetaDescLength: descMetaLengths.length ? Math.round(descMetaLengths.reduce((a, b) => a + b, 0) / descMetaLengths.length) : 0,
    htmlValidationRate: successful.length ? validHtml.length / successful.length : 0,
  };
}

// ─── HTML Report Generation ───

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateHtmlReport(
  comparisons: ProductComparison[],
  allStats: ComparisonStats[],
  providerNames: string[]
): string {
  const statsTableRows = allStats
    .map(
      (s) => {
        const cost = s.realCostUsd ?? s.estimatedCostUsd;
        const scale = 31000 / s.totalProducts;
        const tokenInfo = s.realTotalCalls
          ? `${s.realInputTokens!.toLocaleString()} in / ${s.realOutputTokens!.toLocaleString()} out${s.realReasoningTokens ? ` (${s.realReasoningTokens.toLocaleString()} reasoning)` : ''}`
          : 'estimated';
        return `
      <tr>
        <td><strong>${escapeHtml(s.providerName)}</strong></td>
        <td>${escapeHtml(s.model)}</td>
        <td>${s.successCount}/${s.totalProducts}</td>
        <td>${s.errorCount}</td>
        <td>${(s.htmlValidationRate * 100).toFixed(0)}%</td>
        <td>${s.avgDurationMs}ms</td>
        <td>${(s.totalDurationMs / 1000).toFixed(1)}s</td>
        <td>$${cost.toFixed(4)}</td>
        <td>$${(cost * scale).toFixed(2)}</td>
        <td>${tokenInfo}</td>
        <td>${s.avgDescriptionLength}</td>
        <td>${s.avgMetaTitleLength}</td>
      </tr>`;
      }
    )
    .join('\n');

  const productRows = comparisons
    .map((comp, idx) => {
      const resultCells = providerNames
        .map((name) => {
          const r = comp.results.find((r) => r.providerName === name);
          if (!r || r.result.status === 'error') {
            return `<td class="result-cell error"><em>Error: ${escapeHtml(r?.result.error || 'unknown')}</em></td>`;
          }

          // Original column: just show the raw description, no meta fields
          if (name === 'original') {
            const wordCount = r.result.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean).length;
            return `
            <td class="result-cell">
              <div class="meta-info">
                <span class="badge ${r.result.status}">original</span>
                <span class="duration">${wordCount} words / ${r.result.html.length} chars</span>
              </div>
              <details open>
                <summary>Original Description</summary>
                <div class="description-preview">${r.result.html}</div>
                <details>
                  <summary>Raw HTML</summary>
                  <pre class="raw-html">${escapeHtml(r.result.html)}</pre>
                </details>
              </details>
            </td>`;
          }

          return `
            <td class="result-cell">
              <div class="meta-info">
                <span class="badge ${r.result.status}">${r.result.status}</span>
                <span class="duration">${r.durationMs}ms</span>
              </div>
              <div class="meta-fields">
                <div class="meta-title"><strong>Title:</strong> ${escapeHtml(r.result.metaTitle)}</div>
                <div class="meta-desc"><strong>Meta:</strong> ${escapeHtml(r.result.metaDescription)}</div>
                <div class="excerpt"><strong>Excerpt:</strong> ${escapeHtml(r.result.excerpt)}</div>
              </div>
              <details>
                <summary>View HTML Description (${r.result.html.length} chars)</summary>
                <div class="description-preview">${r.result.html}</div>
                <details>
                  <summary>Raw HTML</summary>
                  <pre class="raw-html">${escapeHtml(r.result.html)}</pre>
                </details>
              </details>
            </td>`;
        })
        .join('\n');

      return `
        <tr class="product-row">
          <td class="product-info">
            <strong>#${comp.product.postId}</strong><br>
            ${escapeHtml(comp.product.title)}<br>
            <span class="tag">${comp.enrichPath}</span>
            <span class="tag">${comp.categoryProfile}</span>
            ${comp.product.brand ? `<span class="tag brand">${escapeHtml(comp.product.brand)}</span>` : ''}
            ${comp.product.variationCount > 0 ? `<span class="tag">${comp.product.variationCount} variations</span>` : ''}
            <br><small>Sources: ${comp.product.dataSources.join(', ')}</small>
          </td>
          ${resultCells}
        </tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Provider Comparison Report</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f5f5f5; color: #333; }
    h1 { margin-bottom: 5px; }
    .subtitle { color: #666; margin-bottom: 30px; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 30px; }
    th { background: #1a1a2e; color: white; padding: 12px 16px; text-align: left; font-size: 13px; }
    td { padding: 12px 16px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 14px; }
    tr:hover td { background: #fafafa; }
    .stats-table td { text-align: center; }
    .stats-table td:first-child { text-align: left; }
    .product-info { min-width: 200px; max-width: 250px; }
    .result-cell { min-width: 350px; }
    .result-cell.error { background: #fff5f5; color: #c53030; }
    .tag { display: inline-block; background: #e2e8f0; color: #4a5568; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin: 2px 2px; }
    .tag.brand { background: #bee3f8; color: #2a69ac; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge.success { background: #c6f6d5; color: #276749; }
    .badge.fallback { background: #fefcbf; color: #975a16; }
    .badge.error { background: #fed7d7; color: #9b2c2c; }
    .duration { color: #999; font-size: 12px; margin-left: 8px; }
    .meta-info { margin-bottom: 8px; }
    .meta-fields { margin-bottom: 8px; font-size: 13px; }
    .meta-fields div { margin-bottom: 4px; }
    .meta-title { color: #1a0dab; }
    .meta-desc { color: #545454; }
    .excerpt { color: #666; font-style: italic; }
    .description-preview { padding: 12px; background: #fafafa; border: 1px solid #e2e8f0; border-radius: 4px; margin-top: 8px; font-size: 13px; line-height: 1.5; max-height: 400px; overflow-y: auto; }
    .description-preview h2 { font-size: 16px; margin: 12px 0 8px; }
    .description-preview h3 { font-size: 14px; margin: 10px 0 6px; }
    .description-preview p { margin: 8px 0; }
    .description-preview ul { margin: 8px 0; padding-left: 20px; }
    .raw-html { background: #1a1a2e; color: #a0aec0; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
    details { margin-top: 8px; }
    summary { cursor: pointer; color: #4a90d9; font-size: 13px; }
    summary:hover { text-decoration: underline; }
    .comparison-table { display: block; overflow-x: auto; }
    .highlight-best { background: #f0fff4 !important; }
    .cost-projection { background: #fffaf0; padding: 20px; border-radius: 8px; margin-bottom: 30px; border: 1px solid #fbd38d; }
    .cost-projection h3 { margin-top: 0; }
  </style>
</head>
<body>
  <h1>LLM Provider Comparison Report</h1>
  <p class="subtitle">Generated ${new Date().toISOString()} | ${comparisons.length} products compared</p>

  <h2>Summary Statistics</h2>
  <table class="stats-table">
    <thead>
      <tr>
        <th>Provider</th>
        <th>Model</th>
        <th>Success</th>
        <th>Errors</th>
        <th>HTML Valid</th>
        <th>Avg Time</th>
        <th>Total Time</th>
        <th>Sample Cost</th>
        <th>Est. 31K Cost</th>
        <th>Token Usage</th>
        <th>Avg Desc Len</th>
        <th>Avg Title Len</th>
      </tr>
    </thead>
    <tbody>
      ${statsTableRows}
    </tbody>
  </table>

  <div class="cost-projection">
    <h3>Cost Projection for Full Catalog (~31,000 products)</h3>
    <p>Extrapolated from this ${comparisons.length}-product sample. Actual costs may vary based on description length distribution.</p>
    <table>
      <tr>
        <th>Provider</th>
        <th>Model</th>
        <th>Estimated Cost</th>
        <th>Estimated Time</th>
        <th>Success Rate</th>
      </tr>
      ${allStats
        .map((s) => {
          const scale = 31000 / s.totalProducts;
          const cost = s.realCostUsd ?? s.estimatedCostUsd;
          const projectedCost = cost * scale;
          const projectedTimeMin = (s.totalDurationMs * scale) / 60000;
          const successRate = s.totalProducts ? ((s.successCount / s.totalProducts) * 100).toFixed(1) : '0';
          const costLabel = s.realCostUsd !== undefined ? '(actual)' : '(estimated)';
          return `<tr>
            <td>${escapeHtml(s.providerName)}</td>
            <td>${escapeHtml(s.model)}</td>
            <td><strong>$${projectedCost.toFixed(2)}</strong> ${costLabel}</td>
            <td>${projectedTimeMin.toFixed(0)} min (at concurrency used)</td>
            <td>${successRate}%</td>
          </tr>`;
        })
        .join('\n')}
    </table>
  </div>

  <h2>Product-by-Product Comparison</h2>
  <div class="comparison-table">
    <table>
      <thead>
        <tr>
          <th>Product</th>
          ${providerNames.map((n) => `<th>${escapeHtml(n)}</th>`).join('\n')}
        </tr>
      </thead>
      <tbody>
        ${productRows}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

// ─── JSON Report ───

function generateJsonReport(
  comparisons: ProductComparison[],
  allStats: ComparisonStats[]
): object {
  return {
    generatedAt: new Date().toISOString(),
    sampleSize: comparisons.length,
    stats: allStats,
    products: comparisons.map((c) => ({
      postId: c.product.postId,
      title: c.product.title,
      brand: c.product.brand,
      categories: c.product.categories,
      enrichPath: c.enrichPath,
      categoryProfile: c.categoryProfile,
      dataSources: c.product.dataSources,
      results: c.results.map((r) => ({
        provider: r.providerName,
        model: r.model,
        status: r.result.status,
        durationMs: r.durationMs,
        metaTitle: r.result.metaTitle,
        metaDescription: r.result.metaDescription,
        excerpt: r.result.excerpt,
        htmlLength: r.result.html.length,
        html: r.result.html,
        error: r.result.error,
      })),
    })),
  };
}

// ─── Main ───

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log('LLM Provider Comparison');
  console.log(`  Providers: ${opts.providers.join(', ')}`);
  console.log(`  Sample size: ${opts.limit}`);
  console.log(`  Concurrency: ${opts.concurrency}`);

  // Step 1: Load and merge product data
  console.log('\nLoading product data...');
  const { products, stats } = await mergeAllSources({ source: opts.source });
  console.log(`  ${products.length} total products loaded`);

  // Step 2: Select diverse sample
  const sample = selectDiverseSample(products, opts.limit);
  console.log(`  ${sample.length} products selected for comparison`);

  // Show sample distribution
  const pathDist = new Map<string, number>();
  const profileDist = new Map<string, number>();
  for (const p of sample) {
    const path = classifyProduct(p);
    const profile = matchCategoryProfile(p);
    pathDist.set(path, (pathDist.get(path) || 0) + 1);
    profileDist.set(profile.id, (profileDist.get(profile.id) || 0) + 1);
  }
  console.log(`\n  Path distribution:`);
  for (const [path, count] of Array.from(pathDist.entries())) {
    console.log(`    ${path}: ${count}`);
  }
  console.log(`  Category distribution:`);
  for (const [profile, count] of Array.from(profileDist.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${profile}: ${count}`);
  }

  // Step 3: Initialize providers
  console.log('\nInitializing providers...');
  const providers = createProviders(opts);

  for (const [name, { llm }] of Array.from(providers.entries())) {
    try {
      await llm.healthCheck();
    } catch (err: any) {
      console.error(`\n✗ ${name}: ${err.message}`);
      process.exit(1);
    }
  }

  // Step 4: Run comparison
  console.log(`\nRunning comparison (${sample.length} products × ${providers.size} providers + original)...\n`);

  const startTime = performance.now();
  const comparisons = await runComparison(providers, sample, opts.concurrency, products);
  const totalTime = Math.round(performance.now() - startTime);

  console.log(`\nComparison complete in ${(totalTime / 1000).toFixed(1)}s`);

  // Step 5: Calculate stats + real usage
  const llmProviderNames = Array.from(providers.keys());
  const providerNames = ['original', ...llmProviderNames]; // Include original in report columns
  const allStats = llmProviderNames.map((name) => {
    const { model, llm } = providers.get(name)!;
    const stats = calculateStats(name, model, comparisons);
    // Override with real API usage if available
    const usage = llm.getUsage?.();
    if (usage && usage.totalCalls > 0) {
      stats.realInputTokens = usage.inputTokens;
      stats.realOutputTokens = usage.outputTokens;
      stats.realReasoningTokens = usage.reasoningTokens;
      stats.realTotalCalls = usage.totalCalls;
      stats.realCostUsd = estimateCost(model, usage.inputTokens, usage.outputTokens);
    }
    return stats;
  });

  // Print summary to console
  console.log('\n═══════════════════════════════════════');
  console.log('  COMPARISON SUMMARY');
  console.log('═══════════════════════════════════════\n');

  for (const s of allStats) {
    const scale31k = 31000 / s.totalProducts;
    console.log(`${s.providerName} (${s.model}):`);
    console.log(`  Success: ${s.successCount}/${s.totalProducts} (${((s.successCount / s.totalProducts) * 100).toFixed(0)}%)`);
    console.log(`  HTML validation rate: ${(s.htmlValidationRate * 100).toFixed(0)}%`);
    console.log(`  Avg time: ${s.avgDurationMs}ms | Total: ${(s.totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`  Avg desc length: ${s.avgDescriptionLength} chars`);
    console.log(`  Avg meta title: ${s.avgMetaTitleLength} chars | meta desc: ${s.avgMetaDescLength} chars`);
    if (s.realTotalCalls) {
      console.log(`  API calls: ${s.realTotalCalls}`);
      console.log(`  Tokens — input: ${s.realInputTokens!.toLocaleString()} | output: ${s.realOutputTokens!.toLocaleString()}${s.realReasoningTokens ? ` (reasoning: ${s.realReasoningTokens.toLocaleString()})` : ''}`);
      console.log(`  Actual cost: $${s.realCostUsd!.toFixed(4)}`);
      console.log(`  Projected 31K cost: $${(s.realCostUsd! * scale31k).toFixed(2)}`);
    } else {
      console.log(`  Estimated cost: $${s.estimatedCostUsd.toFixed(4)}`);
      console.log(`  Projected 31K cost: $${(s.estimatedCostUsd * scale31k).toFixed(2)}`);
    }
    console.log('');
  }

  // Step 6: Generate reports
  const timestamp = Date.now();
  const htmlPath = join(process.cwd(), 'data', `provider-comparison-${timestamp}.html`);
  const jsonPath = join(process.cwd(), 'data', `provider-comparison-${timestamp}.json`);

  const htmlReport = generateHtmlReport(comparisons, allStats, providerNames);
  writeFileSync(htmlPath, htmlReport);
  console.log(`HTML report: ${htmlPath}`);

  const jsonReport = generateJsonReport(comparisons, allStats);
  writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
  console.log(`JSON report: ${jsonPath}`);
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
