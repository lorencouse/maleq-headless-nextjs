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
import { getConnection } from '../lib/db';
import { discover } from './discover';
import { filterUnseen } from './dedupe';
import { clusterByStory } from './cluster';
import { draftPost, type DraftedPost } from './draft';
import { MAX_PER_RUN, DRAFT_MODEL } from './config';

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
const LIMIT = flag('--limit') ? parseInt(flag('--limit')!, 10) : MAX_PER_RUN;
const MODEL = flag('--model') || DRAFT_MODEL;

function banner() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   LGBTQ News Agent · Phase 1 (draft only)  ║');
  console.log('╚════════════════════════════════════════════╝\n');
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
  console.log(`   ${unseen.length} new item(s) → ${clusters.length} stories (${multi} multi-source). Drafting up to ${LIMIT}.\n`);
  const batch = clusters.slice(0, LIMIT);

  // ── 3. Draft ────────────────────────────────────────────────────────
  console.log('③ Drafting with Claude…');
  const drafts: DraftedPost[] = [];
  for (const cluster of batch) {
    const srcLabel = cluster.sources.map((s) => s.sourceName).join(' + ');
    try {
      const d = await draftPost(cluster, MODEL);
      if (!d.publishable) {
        console.log(`   ⊘ skip "${cluster.primary.title.slice(0, 55)}" — ${d.skipReason || 'not publishable'}`);
        continue;
      }
      drafts.push(d);
      const usedCount = d.usedSourceUrls.length;
      console.log(`   ✓ "${d.title}"  [${srcLabel}${usedCount > 1 ? ` → ${usedCount} cited` : ''}]`);
    } catch (e: any) {
      console.log(`   ✗ draft failed for "${cluster.primary.title.slice(0, 55)}": ${e.message}`);
    }
  }
  console.log('');

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
