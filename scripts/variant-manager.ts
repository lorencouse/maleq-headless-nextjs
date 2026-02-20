#!/usr/bin/env bun

/**
 * Unified Variant Manager — single pipeline replacing 4 separate scripts.
 *
 * Faithfully implements docs/VARIANT-RULES.md with a modular, phased pipeline:
 *   Phase 1: Parse feeds → build unified index
 *   Phase 2: Audit parents → detect issues
 *   Phase 3: Generate prioritized action plan
 *   Phase 4: Execute actions with transactions + checkpoints
 *
 * Usage:
 *   bun scripts/variant-manager.ts [mode] [options]
 *
 * Modes:
 *   --analyze          Phases 1-3, write plan JSON (default)
 *   --dry-run          Phases 1-3, print plan summary
 *   --apply            All 4 phases (or phase 4 only with --plan-file)
 *
 * Options:
 *   --local            Connect to local DB
 *   --output <file>    Plan output path (default: scripts/output/variant-plan.json)
 *   --plan-file <f>    Execute existing plan (skip phases 1-3)
 *   --parent <id>      Only process one parent
 *   --limit <n>        Limit parents to scan
 *   --min-confidence <n> Skip actions below threshold (default: 0.0)
 *   --action-types <t> Comma-separated filter (e.g., split-product-lines,delete-discontinued)
 *   --resume           Resume from checkpoint
 *   --verbose          Extra debug output
 *   --help, -h         Show help
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { getConnection } from './lib/db';
import type { VariantManagerOptions, PipelinePlan, PlannedAction, ActionType, ExecutionLog } from './lib/variant-manager/types';
import { buildFeedIndex } from './lib/variant-manager/feed-index';
import { auditAll } from './lib/variant-manager/auditor';
import { generatePlan } from './lib/variant-manager/planner';
import { executePlan } from './lib/variant-manager/executor';

// ==================== Argument Parsing ====================

function parseArgs(): VariantManagerOptions {
  const args = process.argv.slice(2);
  const opts: VariantManagerOptions = {
    mode: 'analyze',
    output: 'scripts/output/variant-plan.json',
    minConfidence: 0.0,
    resume: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--analyze':
        opts.mode = 'analyze';
        break;
      case '--dry-run':
        opts.mode = 'dry-run';
        break;
      case '--apply':
        opts.mode = 'apply';
        break;
      case '--output':
        opts.output = args[++i];
        break;
      case '--plan-file':
        opts.planFile = args[++i];
        break;
      case '--parent':
        opts.parentId = parseInt(args[++i], 10);
        break;
      case '--limit':
        opts.limit = parseInt(args[++i], 10);
        break;
      case '--min-confidence':
        opts.minConfidence = parseFloat(args[++i]);
        break;
      case '--action-types':
        opts.actionTypes = args[++i].split(',') as ActionType[];
        break;
      case '--resume':
        opts.resume = true;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      // Skip flags handled by lib/db.ts
      case '--local':
      case '--remote':
        break;
      case '--db':
        i++;
        break;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Unified Variant Manager
=======================
Single pipeline replacing split-variation-products, fix-duplicate-variations,
enforce-single-attribute, and detect-missed-variations.

Implements docs/VARIANT-RULES.md faithfully with correct SKU pattern matching,
category-aware attribute selection, and discontinued product handling.

Usage: bun scripts/variant-manager.ts [mode] [options]

Modes:
  --analyze          Phases 1-3, write plan JSON (default)
  --dry-run          Phases 1-3, print plan summary
  --apply            All 4 phases (or phase 4 only with --plan-file)

Options:
  --local            Connect to local DB (via socket)
  --output <file>    Plan output path (default: scripts/output/variant-plan.json)
  --plan-file <f>    Execute existing plan (skip phases 1-3)
  --parent <id>      Only process a specific parent product ID
  --limit <n>        Limit number of parents to scan
  --min-confidence <n>  Skip actions below threshold (default: 0.0)
  --action-types <t>    Comma-separated filter
                        Types: convert-to-draft, delete-discontinued, split-product-lines,
                               fix-duplicate-attrs, reduce-to-single-attr, reclassify-attribute,
                               convert-simple-to-variable
  --resume           Resume from checkpoint
  --verbose          Extra debug output
  --help, -h         Show this help
`);
}

// ==================== Review Markdown Generation ====================

const SITE_URL = 'http://localhost:3000';

function generateReviewMarkdown(plan: PipelinePlan): string {
  const lines: string[] = [];
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  lines.push(`# Variant Manager — Plan Review`);
  lines.push(`Generated: ${ts}\n`);

  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Parents scanned | ${plan.summary.totalParentsScanned} |`);
  lines.push(`| Actions planned | ${plan.summary.totalActionsPlanned} |`);
  lines.push(`| Variations affected | ${plan.summary.totalVariationsAffected} |`);
  lines.push(`| New parents to create | ${plan.summary.totalNewParentsToCreate} |`);
  lines.push(`| Skipped | ${plan.skipped.length} |`);
  lines.push('');

  // Group actions by type
  const byType = new Map<string, PlannedAction[]>();
  for (const a of plan.actions) {
    if (!byType.has(a.type)) byType.set(a.type, []);
    byType.get(a.type)!.push(a);
  }

  // Splits
  const splits = byType.get('split-product-lines') || [];
  if (splits.length > 0) {
    lines.push(`## Splits (${splits.length})\n`);
    for (const action of splits) {
      const url = `${SITE_URL}/product/${action.parentSlug}`;
      const flags = action.confidenceFlags.length > 0 ? ` — _${action.confidenceFlags.join('; ')}_` : '';
      lines.push(`### ${action.parentTitle} (ID: ${action.parentId}) — conf: ${action.confidence.toFixed(2)}${flags}`);
      if (action.splitGroups) {
        for (const g of action.splitGroups) {
          const prefix = g.isKeepGroup ? '**Keep:**' : '**New:**';
          const groupUrl = g.isKeepGroup ? url : `${SITE_URL}/product/${g.newParentSlug}`;
          lines.push(`- ${prefix} [${g.newParentTitle}](${groupUrl}) — ${g.variationIds.length} vars (SKU prefix: \`${g.skuPrefix || 'n/a'}\`)`);
        }
      }
      lines.push('');
    }
  }

  // Delete discontinued
  const deletes = byType.get('delete-discontinued') || [];
  if (deletes.length > 0) {
    lines.push(`## Delete Discontinued Variations (${deletes.length})\n`);
    for (const action of deletes) {
      const url = `${SITE_URL}/product/${action.parentSlug}`;
      const count = action.deleteVarIds?.length || 0;
      lines.push(`${deletes.indexOf(action) + 1}. [${action.parentTitle}](${url}) (ID: ${action.parentId}) — delete ${count} discontinued variations, conf: ${action.confidence.toFixed(2)}`);
    }
    lines.push('');
  }

  // Convert to draft
  const drafts = byType.get('convert-to-draft') || [];
  if (drafts.length > 0) {
    lines.push(`## Convert to Draft (${drafts.length})\n`);
    lines.push(`All variations discontinued — set parent to draft.\n`);
    for (const action of drafts) {
      const url = `${SITE_URL}/product/${action.parentSlug}`;
      lines.push(`${drafts.indexOf(action) + 1}. [${action.parentTitle}](${url}) (ID: ${action.parentId})`);
    }
    lines.push('');
  }

  // Fix duplicate attrs
  const fixes = byType.get('fix-duplicate-attrs') || [];
  if (fixes.length > 0) {
    lines.push(`## Fix Duplicate Attributes (${fixes.length})\n`);
    for (const action of fixes) {
      const url = `${SITE_URL}/product/${action.parentSlug}`;
      const changeCount = action.attrChanges?.length || 0;
      const flags = action.confidenceFlags.length > 0 ? ` — _${action.confidenceFlags.join('; ')}_` : '';
      lines.push(`${fixes.indexOf(action) + 1}. [${action.parentTitle}](${url}) (ID: ${action.parentId}) — ${changeCount} attr changes, conf: ${action.confidence.toFixed(2)}${flags}`);
    }
    lines.push('');
  }

  // Reduce to single attr
  const reduces = byType.get('reduce-to-single-attr') || [];
  if (reduces.length > 0) {
    lines.push(`## Reduce to Single Attribute (${reduces.length})\n`);
    for (const action of reduces) {
      const url = `${SITE_URL}/product/${action.parentSlug}`;
      const flags = action.confidenceFlags.length > 0 ? ` — _${action.confidenceFlags.join('; ')}_` : '';
      lines.push(`${reduces.indexOf(action) + 1}. [${action.parentTitle}](${url}) (ID: ${action.parentId}) — keep \`${action.keepDimension}\`, remove \`${action.removeDimension}\`, conf: ${action.confidence.toFixed(2)}${flags}`);
    }
    lines.push('');
  }

  // Reclassify
  const reclassifies = byType.get('reclassify-attribute') || [];
  if (reclassifies.length > 0) {
    lines.push(`## Reclassify Attribute (${reclassifies.length})\n`);
    for (const action of reclassifies) {
      const url = `${SITE_URL}/product/${action.parentSlug}`;
      lines.push(`${reclassifies.indexOf(action) + 1}. [${action.parentTitle}](${url}) (ID: ${action.parentId}) — \`${action.reclassifyFrom}\` → \`${action.reclassifyTo}\`, conf: ${action.confidence.toFixed(2)}`);
    }
    lines.push('');
  }

  // Skipped
  if (plan.skipped.length > 0) {
    lines.push(`## Skipped (${plan.skipped.length})\n`);
    for (const s of plan.skipped) {
      lines.push(`- **${s.parentTitle}** (ID: ${s.parentId}) — ${s.reason}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateAppliedReviewMarkdown(plan: PipelinePlan, log: ExecutionLog): string {
  const lines: string[] = [];
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  lines.push(`# Variant Manager — Applied Changes Review`);
  lines.push(`Applied: ${ts}\n`);

  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total executed | ${log.summary.total} |`);
  lines.push(`| Succeeded | ${log.summary.succeeded} |`);
  lines.push(`| Failed | ${log.summary.failed} |`);
  lines.push(`| Skipped | ${log.summary.skipped} |`);
  lines.push('');

  // Succeeded actions with review URLs
  const succeeded = log.results.filter(r => r.success);
  if (succeeded.length > 0) {
    lines.push(`## Succeeded (${succeeded.length})\n`);

    for (const result of succeeded) {
      const a = result.action;
      const url = `${SITE_URL}/product/${a.parentSlug}`;

      switch (a.type) {
        case 'split-product-lines': {
          lines.push(`### Split: [${a.parentTitle}](${url}) (ID: ${a.parentId})`);
          if (a.splitGroups) {
            // Build lookup of real slugs from execution result
            const realParents = new Map<number, { title: string; slug: string }>();
            if (result.newParents) {
              for (const np of result.newParents) {
                realParents.set(np.id, { title: np.title, slug: np.slug });
              }
            }

            let newIdx = 0;
            for (const g of a.splitGroups) {
              if (g.isKeepGroup) {
                lines.push(`- **Keep:** [${a.parentTitle}](${url}) — ${g.variationIds.length} vars`);
              } else {
                // Use real slug from DB if available
                const real = result.newParents?.[newIdx];
                const realSlug = real?.slug || g.newParentSlug;
                const realTitle = real?.title || g.newParentTitle;
                const groupUrl = `${SITE_URL}/product/${realSlug}`;
                lines.push(`- **New:** [${realTitle}](${groupUrl}) (ID: ${real?.id || '?'}) — ${g.variationIds.length} vars`);
                newIdx++;
              }
            }
          }
          lines.push('');
          break;
        }
        case 'delete-discontinued': {
          const count = a.deleteVarIds?.length || 0;
          lines.push(`- **Deleted ${count} discontinued vars:** [${a.parentTitle}](${url}) (ID: ${a.parentId})`);
          break;
        }
        case 'convert-to-draft': {
          lines.push(`- **Drafted:** [${a.parentTitle}](${url}) (ID: ${a.parentId})`);
          break;
        }
        case 'fix-duplicate-attrs': {
          const count = a.attrChanges?.length || 0;
          lines.push(`- **Fixed ${count} duplicate attrs:** [${a.parentTitle}](${url}) (ID: ${a.parentId})`);
          break;
        }
        case 'reduce-to-single-attr': {
          lines.push(`- **Reduced attrs** (keep \`${a.keepDimension}\`): [${a.parentTitle}](${url}) (ID: ${a.parentId})`);
          break;
        }
        case 'reclassify-attribute': {
          lines.push(`- **Reclassified** \`${a.reclassifyFrom}\` → \`${a.reclassifyTo}\`: [${a.parentTitle}](${url}) (ID: ${a.parentId})`);
          break;
        }
      }
    }
    lines.push('');
  }

  // Failed actions
  const failed = log.results.filter(r => !r.success);
  if (failed.length > 0) {
    lines.push(`## Failed (${failed.length})\n`);
    for (const result of failed) {
      const a = result.action;
      lines.push(`- **${a.type}** [${a.parentTitle}](${SITE_URL}/product/${a.parentSlug}) (ID: ${a.parentId}) — ${result.error}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ==================== Main ====================

async function main() {
  const opts = parseArgs();
  const startTime = Date.now();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Variant Manager — mode: ${opts.mode}`);
  console.log(`${'='.repeat(60)}`);

  let plan: PipelinePlan;

  if (opts.planFile) {
    // Skip phases 1-3, load existing plan
    console.log(`\nLoading existing plan: ${opts.planFile}`);
    if (!existsSync(opts.planFile)) {
      console.error(`Plan file not found: ${opts.planFile}`);
      process.exit(1);
    }
    plan = JSON.parse(readFileSync(opts.planFile, 'utf-8'));
    console.log(`  Loaded plan with ${plan.actions.length} actions`);
  } else {
    // Phase 1: Build feed index
    const feedIndex = await buildFeedIndex();

    // Phase 2: Audit + Phase 3: Plan require DB
    const db = await getConnection();

    try {
      const audits = await auditAll(db, feedIndex, opts);
      plan = generatePlan(audits, feedIndex);

      // Write plan to file
      const outputDir = opts.output.substring(0, opts.output.lastIndexOf('/'));
      if (outputDir && !existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }
      writeFileSync(opts.output, JSON.stringify(plan, null, 2));
      console.log(`\n  Plan written to: ${opts.output}`);

      // Write review markdown
      const reviewPath = opts.output.replace('.json', '-review.md');
      writeFileSync(reviewPath, generateReviewMarkdown(plan));
      console.log(`  Review file written to: ${reviewPath}`);

      // Print summary
      printPlanSummary(plan, opts);

      if (opts.mode === 'apply') {
        // Phase 4: Execute
        const log = await executePlan(db, plan, feedIndex, opts);

        // Write execution log
        const logPath = opts.output.replace('.json', '-log.json');
        writeFileSync(logPath, JSON.stringify(log, null, 2));
        console.log(`  Execution log written to: ${logPath}`);

        // Write post-apply review with results
        const appliedReviewPath = opts.output.replace('.json', `-applied-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.md`);
        writeFileSync(appliedReviewPath, generateAppliedReviewMarkdown(plan, log));
        console.log(`  Applied review written to: ${appliedReviewPath}`);
      }
    } finally {
      await db.end();
    }
  }

  if (opts.planFile && opts.mode === 'apply') {
    // Execute plan from file
    const feedIndex = await buildFeedIndex();
    const db = await getConnection();

    try {
      const log = await executePlan(db, plan, feedIndex, opts);
      const logPath = opts.output.replace('.json', '-log.json');
      writeFileSync(logPath, JSON.stringify(log, null, 2));
      console.log(`  Execution log written to: ${logPath}`);

      const appliedReviewPath = opts.output.replace('.json', `-applied-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.md`);
      writeFileSync(appliedReviewPath, generateAppliedReviewMarkdown(plan, log));
      console.log(`  Applied review written to: ${appliedReviewPath}`);
    } finally {
      await db.end();
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
}

function printPlanSummary(plan: PipelinePlan, opts: VariantManagerOptions) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log('  PLAN SUMMARY');
  console.log(`${'─'.repeat(50)}`);
  console.log(`  Parents scanned:      ${plan.summary.totalParentsScanned}`);
  console.log(`  Actions planned:      ${plan.summary.totalActionsPlanned}`);
  console.log(`  Variations affected:  ${plan.summary.totalVariationsAffected}`);
  console.log(`  New parents to create:${plan.summary.totalNewParentsToCreate}`);
  console.log(`  Skipped:              ${plan.skipped.length}`);

  if (Object.keys(plan.summary.actionsByType).length > 0) {
    console.log(`\n  Actions by type:`);
    for (const [type, count] of Object.entries(plan.summary.actionsByType)) {
      console.log(`    ${type}: ${count}`);
    }
  }

  // Confidence distribution
  if (plan.actions.length > 0) {
    const high = plan.actions.filter(a => a.confidence >= 0.8).length;
    const medium = plan.actions.filter(a => a.confidence >= 0.5 && a.confidence < 0.8).length;
    const low = plan.actions.filter(a => a.confidence < 0.5).length;
    console.log(`\n  Confidence distribution:`);
    console.log(`    High (≥0.8):   ${high}`);
    console.log(`    Medium (0.5-0.8): ${medium}`);
    console.log(`    Low (<0.5):    ${low}`);
  }

  if (opts.verbose && plan.actions.length > 0) {
    console.log(`\n  Top 20 actions:`);
    for (const action of plan.actions.slice(0, 20)) {
      const flags = action.confidenceFlags.length > 0 ? ` [${action.confidenceFlags.join('; ')}]` : '';
      console.log(`    [${action.confidence.toFixed(2)}] ${action.type} #${action.parentId} "${action.parentTitle}"${flags}`);
    }
  }
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
