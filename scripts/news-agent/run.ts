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
 *        --no-title-dedupe (skip the 48h duplicate-headline guard)
 *        --no-scope-filter  (skip the news-events-only editorial filter)
 *        --no-skip-memory   (re-consider stories earlier runs rejected)
 *        --dupe-report      (report-only: print each candidate's closest recent-title
 *                            match and exit — no drafting, no API spend)
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
import { fetchRecentTitles, findDuplicateTitle, rememberTitle } from './title-dedupe';
import { classifyNonNews } from './editorial-filter';
import { loadSkipped } from './skipped';
import { buildVetParams, parseVet } from './vet';
import {
  MAX_PER_RUN,
  DRAFT_MODEL,
  RESEARCH_MODEL,
  VET_MODEL,
  ENABLE_RESEARCH,
  RECENT_TITLE_HOURS,
  FRESHNESS_HOURS,
  estimateCost,
} from './config';

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
const NO_TITLE_DEDUPE = has('--no-title-dedupe'); // skip the 48h near-duplicate headline guard
const NO_SCOPE_FILTER = has('--no-scope-filter');  // skip the news-events-only editorial filter
const DUPE_REPORT = has('--dupe-report');         // print every candidate's closest recent-title match
const LIMIT = flag('--limit') ? parseInt(flag('--limit')!, 10) : MAX_PER_RUN;
if (!Number.isInteger(LIMIT) || LIMIT < 1) {
  console.error(`⛔ --limit must be a positive integer (got "${flag('--limit')}").`);
  process.exit(1);
}
const NO_SKIP_MEMORY = has('--no-skip-memory'); // ignore stories rejected by earlier runs
const NO_VET = has('--no-vet');                // skip the pre-research news-event vetting pass
const MODEL = flag('--model') || DRAFT_MODEL;
// How many drafting rounds a run may spend reaching --limit. Vetting (vet.ts) now
// catches most non-news candidates before we pay to write them, but the drafter
// can still reject one on closer reading, so the run tops up rather than ending
// empty-handed — 9 of the 14 runs before 2026-08-24 produced nothing that way.
// Each extra round costs one more draft (~$0.11), so cap it.
const MAX_DRAFT_ROUNDS = Number(process.env.NEWS_AGENT_MAX_ROUNDS ?? 3);
// Candidates vetted per story we still need. Vetting is cheap and batched, so
// over-fetching here is what keeps a rejection from costing a round trip.
const VET_FANOUT = Number(process.env.NEWS_AGENT_VET_FANOUT ?? 3);

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
const runCost = { vet: 0, research: 0, draft: 0, searches: 0, inTok: 0, outTok: 0, cacheRead: 0 };

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
      // A feed with 0 fresh items is only healthy if it PARSED items that were
      // merely too old. 0 parsed = the feed returns nothing at all (dead endpoint,
      // empty channel, or a shape we can't read) — flag it rather than tick it.
      const dead = f.ok && f.parsed === 0;
      const mark = !f.ok ? '✗' : dead ? '⚠' : '✓';
      let detail: string;
      if (!f.ok) detail = `FAILED — ${f.error}`;
      else if (dead) detail = 'returned 0 parseable items — feed may be dead';
      else {
        const age = f.newestAgeHours === null ? 'undated' : `newest ${f.newestAgeHours.toFixed(0)}h old`;
        detail = `${f.count} fresh items (${f.parsed} parsed, ${age})`;
      }
      console.log(`  ${mark} ${f.name.padEnd(18)} ${detail}`);
      if (!f.ok || dead) console.log(`      ${f.feed}`);
    }
    const quiet = feedStatus.filter((f) => f.ok && f.parsed > 0 && f.count === 0).length;
    const dead = feedStatus.filter((f) => f.ok && f.parsed === 0);
    if (quiet) console.log(`\n  ${quiet} feed(s) healthy but with nothing inside the ${FRESHNESS_HOURS}h freshness window.`);
    if (dead.length) console.log(`  ⚠ ${dead.length} feed(s) returned nothing at all: ${dead.map((f) => f.name).join(', ')}`);
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

  // ── 2b. Editorial scope: news events only ───────────────────────────
  // We report events, never another outlet's original creative work (listicles,
  // how-tos, opinion, reviews, interviews, recaps, galleries). Rewriting those
  // would be derivative of their work no matter how much we reword it. Filtered
  // per-ITEM before clustering, so a listicle can't become a cluster's primary
  // OR be cited as corroboration. draft.ts re-checks against the full article.
  let inScope = unseen;
  if (NO_SCOPE_FILTER) {
    console.log('   ⚠ editorial scope filter disabled (--no-scope-filter).');
  } else {
    const rejected: { title: string; kind: string; matched: string }[] = [];
    inScope = unseen.filter((it) => {
      const m = classifyNonNews(it.title);
      if (m) rejected.push({ title: it.title, kind: m.kind, matched: m.matched });
      return !m;
    });
    if (rejected.length) {
      console.log(`   ${rejected.length} item(s) dropped as another outlet's own work (not news events):`);
      for (const r of rejected.slice(0, 10)) {
        console.log(`     ⊘ [${r.kind}] "${r.title.slice(0, 62)}" (matched: ${r.matched})`);
      }
      if (rejected.length > 10) console.log(`     … and ${rejected.length - 10} more`);
    }
  }

  // ── 2c. Cluster same-story coverage across outlets ──────────────────
  const clusters = clusterByStory(inScope);
  const multi = clusters.filter((c) => c.sources.length > 1).length;
  // Rank before slicing: most-corroborated stories first (independent outlets
  // covering the same event is the strongest editorial signal we have), newest
  // first within the same corroboration level. Before 2026-08-05 the order was
  // an accident of clustering (longest feed body won).
  clusters.sort((a, b) => b.sources.length - a.sources.length || newestAt(b) - newestAt(a));
  console.log(`   ${inScope.length} in-scope item(s) → ${clusters.length} stories (${multi} multi-source).`);

  // ── 2d. Drop stories we've already covered under a different URL ─────
  // URL dedupe (step 2) only catches the exact link. This catches the same event
  // re-reported within RECENT_TITLE_HOURS under a new URL and a reworded headline
  // — the duplicate-content case that matters most now that we draft one story a
  // run. Runs BEFORE the slice so a blocked story doesn't consume the limit.
  const recent = await fetchRecentTitles(db);
  let candidates = clusters;
  if (NO_TITLE_DEDUPE) {
    console.log('   ⚠ title dedupe disabled (--no-title-dedupe).');
  } else {
    console.log(
      `   Checking headlines against ${recent.entries.length} title(s) from the last ${RECENT_TITLE_HOURS}h ` +
      `(rarity weighted over ${recent.docs} headline(s))…`,
    );
    const kept: StoryCluster[] = [];
    for (const c of clusters) {
      // A cluster is a duplicate if ANY outlet's headline in it matches.
      let dup = null as ReturnType<typeof findDuplicateTitle>;
      for (const src of c.sources) {
        const m = findDuplicateTitle(src.title, recent);
        if (m && (!dup || m.score > dup.score)) dup = m;
      }
      if (dup) {
        console.log(
          `   ⊘ dup "${c.primary.title.slice(0, 55)}" ≈ #${dup.against.postId} [${dup.against.status}] ` +
          `"${dup.against.postTitle.slice(0, 55)}" (${dup.score.toFixed(2)}: ${dup.shared.join(', ')})`,
        );
        continue;
      }
      kept.push(c);
    }
    const blocked = clusters.length - kept.length;
    if (blocked) console.log(`   ${blocked} story/stories blocked as recent duplicates.`);
    candidates = kept;
  }

  if (DUPE_REPORT) {
    // Report-only: printing scores must never cost an API call, so we stop here
    // rather than falling through to drafting.
    console.log('\n   Closest recent-title match per candidate (--dupe-report):');
    for (const c of clusters.slice(0, 20)) {
      const m = findDuplicateTitle(c.primary.title, recent, 0);
      console.log(
        `     ${(m ? m.score.toFixed(2) : '0.00')}  "${c.primary.title.slice(0, 60)}"` +
        (m ? `  ↔  "${m.against.title.slice(0, 60)}"` : '  (no shared distinctive tokens)'),
      );
    }
    console.log('\n   --dupe-report is report-only — no drafting, no API spend. Re-run without it to draft.\n');
    await db.end();
    return;
  }

  // ── 2e. Drop stories an earlier run already sent to the model and had rejected ──
  // Ranking is deterministic, so without this the same "not a news event" reject
  // sits at the top of the candidate list every run until it ages out of the feed.
  const skipped = loadSkipped();
  if (NO_SKIP_MEMORY) {
    console.log('   ⚠ reject memory disabled (--no-skip-memory).');
  } else if (skipped.size) {
    const before = candidates.length;
    candidates = candidates.filter((c) => !c.sources.some((src) => skipped.has(src.url)));
    const dropped = before - candidates.length;
    if (dropped) {
      console.log(
        `   ${dropped} story/stories dropped — already rejected by an earlier run ` +
        `(${skipped.size} remembered).`,
      );
    }
  }

  if (candidates.length === 0) {
    console.log('   Nothing new to draft this run.');
    await db.end();
    return;
  }
  console.log(`   Drafting up to ${LIMIT} of ${candidates.length} eligible stories.\n`);

  // ── 3. Draft (two batched passes: research → structured draft) ──────
  console.log('③ Drafting with Claude (Batches API, 50% pricing)…');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set. Export it before running the news agent.');
  const client = new Anthropic({ apiKey });

  // Top up to LIMIT across several rounds, drawing from a pool of candidates that
  // have already passed vetting. Two guards feed this:
  //   • vet.ts (below) rejects non-news BEFORE research/drafting — cheap.
  //   • draft.ts re-checks on the assembled material — the backstop, expensive.
  // One round of exactly LIMIT candidates used to return zero whenever the second
  // guard fired (9 of the 14 runs before 2026-08-24), which is why no drafts were
  // reaching the review queue. MAX_DRAFT_ROUNDS bounds the extra spend.
  const drafts: DraftedPost[] = [];
  const vetted: PreparedStory[] = [];
  let cursor = 0;

  /**
   * Fill `vetted` with at least `need` publishable stories: fetch article text for
   * the next slice of candidates, then judge them all in ONE cheap batch. Survivors
   * carry over between rounds, so nothing is prepared or vetted twice.
   */
  async function refillVetted(need: number): Promise<void> {
    while (vetted.length < need && cursor < candidates.length) {
      const want = (need - vetted.length) * (NO_VET ? 1 : VET_FANOUT);
      const slice = candidates.slice(cursor, cursor + want);
      cursor += slice.length;

      // Article text — network only, no API spend. Both the vet pass and the
      // drafter reuse this, so a vetted story costs nothing extra to draft.
      const prepared: PreparedStory[] = await Promise.all(slice.map((c) => prepareStory(c)));
      if (NO_VET) {
        vetted.push(...prepared);
        continue;
      }

      const reqs = prepared.map((p, i) => ({ custom_id: `vet-${i}`, params: buildVetParams(p) }));
      let verdicts = new Map<string, Anthropic.Message>();
      try {
        verdicts = await runBatch(client, reqs, 'vet     ');
      } catch (e: any) {
        // Vetting is an optimization, not a gate — if the batch dies, fall through
        // to the drafter's own check rather than dropping the whole round.
        console.log(`   ⚠ vetting batch failed (${e.message}); relying on the drafter's own check`);
        vetted.push(...prepared);
        continue;
      }

      for (let i = 0; i < prepared.length; i++) {
        const prep = prepared[i];
        const title = prep.cluster.primary.title;
        const msg = verdicts.get(`vet-${i}`);
        // A missing or unparseable verdict FAILS OPEN: let the drafter decide
        // rather than silently losing a story to a flaky call.
        if (!msg) {
          vetted.push(prep);
          continue;
        }
        runCost.vet += trackUsage(VET_MODEL, msg);
        const v = parseVet(msg);
        if (!v || v.isNewsEvent) {
          vetted.push(prep);
          continue;
        }
        console.log(`   ⊘ vetted out "${title.slice(0, 55)}" — ${v.format}: ${v.reason.slice(0, 90)}`);
        skipped.record(prep.cluster.sources.map((src) => src.url), title, `${v.format}: ${v.reason}`);
      }
    }
  }

  for (let round = 1; round <= MAX_DRAFT_ROUNDS && drafts.length < LIMIT; round++) {
    const need = LIMIT - drafts.length;
    await refillVetted(need);
    const batch = vetted.splice(0, need);
    if (batch.length === 0) break;   // candidate pool exhausted
    if (round > 1) {
      console.log(
        `\n   ↻ round ${round}/${MAX_DRAFT_ROUNDS}: ${need} more needed — ` +
        `drafting the next ${batch.length} vetted candidate(s).`,
      );
    }

    const prepared = batch;

    // Pass 1 — research briefs (Haiku + web_search), one batch for the round.
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
    const draftMsgs = prepared.length > 0
      ? await runBatch(client, draftReqs, 'draft   ')
      : new Map<string, Anthropic.Message>();

    for (let i = 0; i < prepared.length; i++) {
      const prep = prepared[i];
      const cluster = prep.cluster;
      const srcUrls = cluster.sources.map((src) => src.url);
      const srcLabel = cluster.sources.map((src) => src.sourceName).join(' + ');
      const msg = draftMsgs.get(`story-${i}`);
      if (!msg) {
        // A batch-level failure is transient — don't remember it as a rejection.
        console.log(`   ✗ draft failed for "${cluster.primary.title.slice(0, 55)}" (batch item did not succeed)`);
        continue;
      }
      const cost = trackUsage(MODEL, msg);
      runCost.draft += cost;
      try {
        const d = await finalizeDraft(prep, msg);
        const brief = briefs.get(`story-${i}`) || '';
        if (!d.publishable) {
          const reason = d.skipReason || 'not publishable';
          console.log(`   ⊘ skip "${cluster.primary.title.slice(0, 55)}" — ${reason}`);
          skipped.record(srcUrls, cluster.primary.title, reason);
          continue;
        }
        // Second guard: Claude's rewritten headline can land on a recent story even
        // when the source headline didn't (and two stories drafted in the SAME run
        // can converge). `recent` is appended to below, so this covers both.
        if (!NO_TITLE_DEDUPE) {
          const dup = findDuplicateTitle(d.title, recent);
          if (dup) {
            console.log(
              `   ⊘ dup drafted title "${d.title.slice(0, 55)}" ≈ #${dup.against.postId} ` +
              `[${dup.against.status}] "${dup.against.postTitle.slice(0, 55)}" (${dup.score.toFixed(2)}) — discarded`,
            );
            skipped.record(srcUrls, cluster.primary.title, `duplicate of post #${dup.against.postId}`);
            continue;
          }
        }
        rememberTitle(recent, 0, d.title);
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
  }
  skipped.save();

  if (drafts.length < LIMIT) {
    console.log(
      `\n   ⚠ ${drafts.length}/${LIMIT} drafted — ` +
      (cursor >= candidates.length
        ? 'ran out of eligible candidates.'
        : `stopped after ${MAX_DRAFT_ROUNDS} round(s); the rest of the queue keeps for the next run.`),
    );
  }
  const totalCost = runCost.vet + runCost.research + runCost.draft;
  console.log(
    `\n   Run cost: ~$${totalCost.toFixed(3)} (vetting $${runCost.vet.toFixed(3)} + research $${runCost.research.toFixed(3)} + drafts $${runCost.draft.toFixed(3)})` +
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
