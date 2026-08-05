#!/usr/bin/env bun
/**
 * LGBTQ News Agent — Phase 1 orchestrator.
 *
 * Pipeline: discover (RSS) → dedupe (wp_postmeta) → draft (Claude) → publish as DRAFT.
 * Drafts land in the "LGBTQ+ News" category awaiting your approval in WP admin.
 * Nothing is published live and nothing is shared to social in Phase 1.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=… bun run scripts/news-agent/run.ts --local --check-feeds   # feed health only
 *   ANTHROPIC_API_KEY=… bun run scripts/news-agent/run.ts --local                 # DRY RUN (preview drafts)
 *   ANTHROPIC_API_KEY=… bun run scripts/news-agent/run.ts --local --write          # write drafts to local WP
 *   ANTHROPIC_API_KEY=… bun run scripts/news-agent/run.ts --write --yes            # write drafts to PROD
 *
 * DB target follows scripts/lib/db.ts (REMOTE/prod by default; --local for Local by Flywheel).
 * Flags: --limit N  --model NAME  --write  --yes  --check-feeds
 */
import Anthropic from '@anthropic-ai/sdk';
import { getConnection } from '../lib/db';
import { discover } from './discover';
import { filterUnseen } from './dedupe';
import { clusterByStory, type StoryCluster } from './cluster';
import {
  prepareStory,
  buildResearchParams,
  extractResearchBrief,
  buildDraftParams,
  finalizeDraft,
  type DraftedPost,
  type PreparedStory,
} from './draft';
import { MAX_PER_RUN, DRAFT_MODEL, RESEARCH_MODEL, ENABLE_RESEARCH, estimateCost } from './config';

const argv = process.argv;
const has = (f: string) => argv.includes(f);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
};

const IS_LOCAL = has('--local') || process.env.MYSQL_LOCAL === '1';
const WRITE = has('--write');
const YES = has('--yes');
const CHECK_FEEDS = has('--check-feeds');
const SHOW_BODY = has('--show-body'); // dry-run only: print the full article body for review
const LIMIT = flag('--limit') ? parseInt(flag('--limit')!, 10) : MAX_PER_RUN;
if (!Number.isInteger(LIMIT) || LIMIT < 1) {
  console.error(`⛔ --limit must be a positive integer (got "${flag('--limit')}").`);
  process.exit(1);
}
const MODEL = flag('--model') || DRAFT_MODEL;

function banner() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   LGBTQ News Agent · Phase 1 (draft only)  ║');
  console.log('╚════════════════════════════════════════════╝\n');
}

/** Newest publish time in a cluster — the recency half of the ranking. */
function newestAt(c: StoryCluster): number {
  return Math.max(...c.sources.map((s) => s.publishedAt?.getTime() ?? 0));
}

/** Running usage/cost totals across both batch passes. */
const runCost = { research: 0, draft: 0, searches: 0, inTok: 0, outTok: 0, cacheRead: 0 };

function trackUsage(model: string, msg: Anthropic.Message): number {
  const u = msg.usage;
  const searches = (u as any).server_tool_use?.web_search_requests ?? 0;
  const cost = estimateCost(model, u, searches);
  runCost.searches += searches;
  runCost.inTok += u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  runCost.outTok += u.output_tokens;
  runCost.cacheRead += u.cache_read_input_tokens ?? 0;
  return cost;
}

/**
 * Submit one Messages batch (50% pricing) and poll to completion. Returns a map
 * of custom_id → Message for succeeded items; failed items are logged and
 * omitted (callers treat a missing id as a per-story failure). Throws on batch
 * creation failure or timeout — the next cron tick simply retries the stories
 * (dedupe + 36 h freshness make that safe).
 */
async function runBatch(
  client: Anthropic,
  requests: { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[],
  label: string,
  timeoutMs = 30 * 60_000,
): Promise<Map<string, Anthropic.Message>> {
  const batch = await client.messages.batches.create({ requests });
  process.stdout.write(`   ${label}: batch ${batch.id} (${requests.length} request(s)) processing`);
  const start = Date.now();
  let b = batch;
  while (b.processing_status !== 'ended') {
    if (Date.now() - start > timeoutMs) {
      console.log('');
      await client.messages.batches.cancel(batch.id).catch(() => {});
      throw new Error(`${label} batch ${batch.id} timed out after ${Math.round(timeoutMs / 60000)} min`);
    }
    await new Promise((r) => setTimeout(r, 30_000));
    process.stdout.write('.');
    b = await client.messages.batches.retrieve(batch.id);
  }
  console.log(` done in ${Math.round((Date.now() - start) / 1000)}s`);

  const out = new Map<string, Anthropic.Message>();
  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type === 'succeeded') {
      out.set(result.custom_id, result.result.message);
    } else {
      const detail = result.result.type === 'errored' ? ` — ${JSON.stringify(result.result.error).slice(0, 300)}` : '';
      console.log(`   ⚠ ${label} ${result.custom_id}: ${result.result.type}${detail}`);
    }
  }
  return out;
}

async function main() {
  banner();

  // ── Feed health check ───────────────────────────────────────────────
  if (CHECK_FEEDS) {
    const { feedStatus, items } = await discover();
    console.log('Feed status:\n');
    for (const f of feedStatus) {
      const mark = f.ok ? '✓' : '✗';
      console.log(`  ${mark} ${f.name.padEnd(18)} ${f.ok ? `${f.count} fresh items` : `FAILED — ${f.error}`}`);
      if (!f.ok) console.log(`      ${f.feed}`);
    }
    console.log(`\nTotal fresh, de-duplicated items across feeds: ${items.length}`);
    return;
  }

  // ── Prod-write safety (per CLAUDE.md DB backup policy) ──────────────
  if (WRITE && !IS_LOCAL && !YES) {
    console.error(
      '⛔ Refusing to write drafts to the REMOTE/production DB without --yes.\n' +
      '   These are drafts (not published), but per policy create a prod backup first,\n' +
      '   then re-run with --write --yes. Use --local to target Local by Flywheel.\n',
    );
    process.exit(1);
  }

  console.log(`Mode:   ${WRITE ? (IS_LOCAL ? 'WRITE (local)' : 'WRITE (PROD)') : 'DRY RUN (no DB writes)'}`);
  console.log(`Model:  ${MODEL}`);
  console.log(`Limit:  ${LIMIT} stories\n`);

  // ── 1. Discover ─────────────────────────────────────────────────────
  console.log('① Discovering from feeds…');
  const { items, feedStatus } = await discover();
  const failed = feedStatus.filter((f) => !f.ok);
  if (failed.length) {
    console.log(`   ⚠ ${failed.length} feed(s) unavailable: ${failed.map((f) => f.name).join(', ')}`);
  }
  console.log(`   ${items.length} fresh candidate(s) found.\n`);
  if (items.length === 0) return;

  // ── 2. Dedupe ───────────────────────────────────────────────────────
  const db = await getConnection();
  console.log('② Removing already-posted stories…');
  const unseen = await filterUnseen(db, items);

  // ── 2b. Cluster same-story coverage across outlets ──────────────────
  const clusters = clusterByStory(unseen);
  const multi = clusters.filter((c) => c.sources.length > 1).length;
  // Rank before slicing: most-corroborated stories first (independent outlets
  // covering the same event is the strongest editorial signal we have), newest
  // first within the same corroboration level. Before 2026-08-05 the order was
  // an accident of clustering (longest feed body won).
  clusters.sort((a, b) => b.sources.length - a.sources.length || newestAt(b) - newestAt(a));
  console.log(`   ${unseen.length} new item(s) → ${clusters.length} stories (${multi} multi-source). Drafting up to ${LIMIT}.\n`);
  const batch = clusters.slice(0, LIMIT);

  // ── 3. Draft (two batched passes: research → structured draft) ──────
  console.log('③ Drafting with Claude (Batches API, 50% pricing)…');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set. Export it before running the news agent.');
  const client = new Anthropic({ apiKey });

  // Fetch + rank article material for every story in parallel.
  const prepared: PreparedStory[] = await Promise.all(batch.map((c) => prepareStory(c)));

  // Pass 1 — research briefs (Haiku + web_search), one batch for the whole run.
  const briefs = new Map<string, string>();
  if (ENABLE_RESEARCH && prepared.length > 0) {
    const reqs = prepared.map((p, i) => ({ custom_id: `story-${i}`, params: buildResearchParams(p) }));
    try {
      const msgs = await runBatch(client, reqs, 'research');
      for (const [id, msg] of msgs) {
        runCost.research += trackUsage(RESEARCH_MODEL, msg);
        briefs.set(id, extractResearchBrief(msg));
      }
    } catch (e: any) {
      // Research is best-effort — a failed batch degrades every story to
      // source-only synthesis, same as a failed individual call always has.
      console.log(`   ⚠ research batch failed (${e.message}); drafting from sources only`);
    }
  }

  // Pass 2 — structured drafts (Sonnet), second batch.
  const draftReqs = prepared.map((p, i) => ({
    custom_id: `story-${i}`,
    params: buildDraftParams(p, briefs.get(`story-${i}`) || '', MODEL),
  }));
  const draftMsgs = prepared.length > 0 ? await runBatch(client, draftReqs, 'draft   ') : new Map<string, Anthropic.Message>();

  const drafts: DraftedPost[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const prep = prepared[i];
    const cluster = prep.cluster;
    const srcLabel = cluster.sources.map((s) => s.sourceName).join(' + ');
    const msg = draftMsgs.get(`story-${i}`);
    if (!msg) {
      console.log(`   ✗ draft failed for "${cluster.primary.title.slice(0, 55)}" (batch item did not succeed)`);
      continue;
    }
    const cost = trackUsage(MODEL, msg);
    runCost.draft += cost;
    try {
      const d = await finalizeDraft(prep, msg);
      const brief = briefs.get(`story-${i}`) || '';
      if (!d.publishable) {
        console.log(`   ⊘ skip "${cluster.primary.title.slice(0, 55)}" — ${d.skipReason || 'not publishable'}`);
        continue;
      }
      drafts.push(d);
      const usedCount = d.usedSourceUrls.length;
      console.log(
        `   ✓ "${d.title}"  [${srcLabel}${usedCount > 1 ? ` → ${usedCount} cited` : ''}]` +
        `  (research: ${brief ? `${brief.length} chars` : 'none'} · ${msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0)}in/${msg.usage.output_tokens}out · ~$${cost.toFixed(3)})`,
      );
    } catch (e: any) {
      console.log(`   ✗ draft failed for "${cluster.primary.title.slice(0, 55)}": ${e.message}`);
    }
  }
  const totalCost = runCost.research + runCost.draft;
  console.log(
    `\n   Run cost: ~$${totalCost.toFixed(3)} (research $${runCost.research.toFixed(3)} + drafts $${runCost.draft.toFixed(3)})` +
    ` · ${runCost.inTok.toLocaleString()} in / ${runCost.outTok.toLocaleString()} out tok` +
    `${runCost.cacheRead ? ` (${runCost.cacheRead.toLocaleString()} cached)` : ''}` +
    `${runCost.searches ? ` · ${runCost.searches} web search(es)` : ''}\n`,
  );

  // ── 4. Publish as draft (or preview) ────────────────────────────────
  if (!WRITE) {
    console.log('④ DRY RUN — drafts that WOULD be created:\n');
    for (const d of drafts) {
      const words = d.bodyHtml.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length;
      const headings = (d.bodyHtml.match(/<h2>/g) || []).length;
      console.log(`──────────────────────────────────────────────`);
      console.log(`TITLE:    ${d.title}`);
      console.log(`SLUG:     ${d.slug}`);
      console.log(`SOURCES:  ${d.usedSourceUrls.length} cited — ${d.usedSourceUrls.join(', ')}`);
      console.log(`LENGTH:   ~${words} words, ${headings} subheading(s)`);
      console.log(`TAGS:     ${d.tags.join(', ')}`);
      console.log(`EXCERPT:  ${d.excerpt}`);
      console.log(`SEO:      ${d.seoDescription}`);
      if (SHOW_BODY) {
        console.log(`\nBODY:\n${d.bodyHtml}\n`);
      }
    }
    console.log(`\nDRY RUN complete — ${drafts.length} draft(s) ready. Re-run with --write to create them.`);
    await db.end();
    return;
  }

  console.log('④ Creating drafts in WordPress…\n');
  const { publishDraft } = await import('./publish');
  const created: { title: string; editUrl: string }[] = [];
  for (const d of drafts) {
    try {
      const res = await publishDraft(db, d);
      created.push({ title: res.title, editUrl: res.editUrl });
      console.log(`   ✓ #${res.id}  ${res.title}`);
    } catch (e: any) {
      console.log(`   ✗ publish failed for "${d.title}": ${e.message}`);
    }
  }
  await db.end();

  // ── Approval digest ─────────────────────────────────────────────────
  console.log(`\n╔═══════════ APPROVAL QUEUE (${created.length}) ═══════════╗`);
  for (const c of created) {
    console.log(`\n  • ${c.title}`);
    console.log(`    Review/edit → ${c.editUrl}`);
  }
  console.log(`\n╚═══════════════════════════════════════════════╝`);
  console.log('\nNext: review each draft in WP admin, then publish the keepers.');
  console.log('(Phase 2 will auto-share approved posts to Bluesky/Mastodon/Meta.)');
  if (!IS_LOCAL) {
    console.log('\n⚠ Prod write done — run `wp cache flush` on the server so WPGraphQL/Redis see the new drafts.');
  }
}

main().catch((e) => {
  console.error('\nFatal:', e);
  process.exit(1);
});
