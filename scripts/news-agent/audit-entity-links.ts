#!/usr/bin/env bun
/**
 * Audit + correct the entity links already injected into published News posts,
 * after the resolveEntity() near-namesake fix (e.g. "Blue Film" had linked to
 * Blue Beetle's IMDb page).
 *
 * For each entity link in a post BODY we reverse-validate the link: we read the
 * canonical NAME of whatever the link points at and check it actually denotes the
 * anchor text (same set-containment test the resolver now uses). If it doesn't,
 * the link is wrong — we re-resolve the anchor with the fixed resolver and either
 * correct the href or, when nothing resolves, unlink it (leaving the plain text).
 * A correct link is never touched.
 *
 * Reverse-validation is only done for links we can verify cleanly:
 *   - IMDb (P345)        — title/name/company id → Wikidata label
 *   - Wikipedia          — article title from the URL
 * Other entity-link domains (Rotten Tomatoes, Goodreads, AllMusic, Steam, official
 * sites) are LEFT AS-IS and reported, so the audit can't introduce a wrong link.
 * Source-attribution and image-credit lines (the appended tail) are never touched.
 *
 * Pure post_content rewrite — no wp-cli/media — so it runs over the SSH tunnel.
 * DRY RUN by default.
 *
 * Usage:
 *   bun run scripts/news-agent/audit-entity-links.ts                 # DRY RUN (prod via tunnel)
 *   bun run scripts/news-agent/audit-entity-links.ts --write --yes    # apply (PROD)
 *   ...--local [--write]                                             # Local by Flywheel
 * Flags: --limit N (default 500, newest first)
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getConnection } from '../lib/db';
import { NEWS_CATEGORY } from './config';
import { resolveEntity, titleMatchesQuery, tokens, type EntityKind } from './entity-links';

/** Exact significant-token-set equality — stricter than titleMatchesQuery's containment. */
function namesEqual(a: string, b: string): boolean {
  const ta = new Set(tokens(a)), tb = new Set(tokens(b));
  return ta.size > 0 && ta.size === tb.size && [...ta].every((t) => tb.has(t));
}

const WD_API = 'https://www.wikidata.org/w/api.php';
const UA = 'MaleQ-NewsAgent/1.0 (https://maleq.com; entity-link audit)';

const argv = process.argv;
const has = (f: string) => argv.includes(f);
const flag = (n: string) => { const i = argv.indexOf(n); return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined; };
const IS_LOCAL = has('--local') || process.env.MYSQL_LOCAL === '1';
const WRITE = has('--write');
const YES = has('--yes');
const LIMIT = flag('--limit') ? parseInt(flag('--limit')!, 10) : 500;

const ENTITY_DOMAINS = ['imdb.com', 'rottentomatoes.com', 'metacritic.com', 'goodreads.com', 'allmusic.com', 'store.steampowered.com', 'en.wikipedia.org'];

async function api(params: Record<string, string>): Promise<any> {
  const url = `${WD_API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`wd HTTP ${res.status}`);
  return res.json();
}

/** The Wikidata English label of the entity whose IMDb id (P345) is `imdbId`. */
async function imdbName(imdbId: string): Promise<string | null> {
  try {
    const s = await api({ action: 'query', list: 'search', srsearch: `haswbstatement:P345=${imdbId}`, srlimit: '1' });
    const qid: string | undefined = s?.query?.search?.[0]?.title;
    if (!qid || !/^Q\d+$/.test(qid)) return null;
    const e = await api({ action: 'wbgetentities', ids: qid, props: 'labels', languages: 'en' });
    return e?.entities?.[qid]?.labels?.en?.value ?? null;
  } catch {
    return null;
  }
}

/** The article title encoded in an en.wikipedia.org/wiki/<Title> URL. */
function wikiTitleFromUrl(url: string): string | null {
  const m = /\/wiki\/([^#?]+)/.exec(url);
  if (!m) return null;
  try { return decodeURIComponent(m[1]).replace(/_/g, ' '); } catch { return m[1].replace(/_/g, ' '); }
}

type Verify = 'imdb' | 'wiki' | 'skip';
/** Classify a link href: which kind to re-resolve as, and whether we can verify it. */
function classify(href: string): { verify: Verify; kind: EntityKind; imdbId?: string } {
  let m: RegExpExecArray | null;
  if ((m = /imdb\.com\/title\/(tt\d+)/.exec(href))) return { verify: 'imdb', kind: 'film', imdbId: m[1] };
  if ((m = /imdb\.com\/name\/(nm\d+)/.exec(href))) return { verify: 'imdb', kind: 'person', imdbId: m[1] };
  if ((m = /imdb\.com\/company\/(co\d+)/.exec(href))) return { verify: 'imdb', kind: 'organization', imdbId: m[1] };
  if (/en\.wikipedia\.org\/wiki\//.test(href)) return { verify: 'wiki', kind: 'other' };
  return { verify: 'skip', kind: 'other' };
}

const normUrl = (u: string) => u.replace(/\/+$/, '').toLowerCase();

/** Split the article body from the appended attribution/credit tail. */
function splitBody(content: string): { head: string; tail: string } {
  const m = /<p class="(?:news-source|image-credit)">/i.exec(content);
  return m ? { head: content.slice(0, m.index), tail: content.slice(m.index) } : { head: content, tail: '' };
}

interface Candidate { id: number; title: string; content: string; }

async function findPosts(db: any): Promise<Candidate[]> {
  const likes = ENTITY_DOMAINS.map(() => 'p.post_content LIKE ?').join(' OR ');
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.ID, p.post_title, p.post_content
       FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
       JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug = ?
      WHERE p.post_type = 'post' AND p.post_status IN ('draft','publish')
        AND (${likes})
      ORDER BY p.post_date DESC
      LIMIT ?`,
    [NEWS_CATEGORY.slug, ...ENTITY_DOMAINS.map((d) => `%${d}%`), LIMIT],
  );
  return rows.map((r) => ({ id: Number(r.ID), title: String(r.post_title), content: String(r.post_content || '') }));
}

const LINK_RE = /<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis;

const imdbId = (url: string): string | null => (/imdb\.com\/(?:title|name|company)\/((?:tt|nm|co)\d+)/.exec(url) || [])[1] || null;

interface Change {
  anchor: string;
  full: string;
  from: string;
  to: string | null;       // new href, or null = unlink
  targetName: string | null; // canonical name the OLD link pointed at
  newName: string | null;    // canonical name the proposed link points at (IMDb only)
  safe: boolean;             // high-confidence IMDb→IMDb correction we may auto-apply
}

async function auditPost(c: Candidate): Promise<Change[]> {
  const { head } = splitBody(c.content);
  const changes: Change[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(head)) !== null) {
    const full = m[0];
    const href = m[1];
    const anchor = m[2].replace(/<[^>]+>/g, '').trim(); // plain anchor text
    if (!anchor || seen.has(full)) continue;
    seen.add(full);

    const { verify, kind, imdbId: oldImdbId } = classify(href);
    if (verify === 'skip') continue; // unverifiable domain — leave as-is

    const targetName = verify === 'imdb' ? await imdbName(oldImdbId!) : wikiTitleFromUrl(href);
    if (!targetName) continue; // couldn't read target — be conservative, leave it

    if (titleMatchesQuery(anchor, targetName)) continue; // link is correct — leave it

    // The existing link's target does NOT denote the anchor → wrong. Re-resolve.
    const hit = await resolveEntity(anchor, kind);
    const to = hit && normUrl(hit.url) !== normUrl(href) ? hit.url : hit ? null : null;
    if (hit && normUrl(hit.url) === normUrl(href)) continue; // paradox — leave untouched

    // SAFE iff: old link was IMDb, the new link is also IMDb, and the new IMDb
    // target's own name actually denotes the anchor (so we know the new link is
    // right, not just "different"). Everything else is reported for manual review.
    let safe = false;
    let newName: string | null = null;
    if (hit) {
      const newId = imdbId(hit.url);
      if (verify === 'imdb' && newId) {
        newName = await imdbName(newId);
        // Strict: the new IMDb target's own name must EXACTLY match the anchor's
        // significant tokens — so we never swap one near-namesake for another.
        safe = !!newName && namesEqual(anchor, newName);
      }
    }
    changes.push({ anchor, full, from: href, to: hit ? hit.url : null, targetName, newName, safe });
  }
  return changes;
}

function applyChanges(content: string, changes: Change[]): string {
  const { head, tail } = splitBody(content);
  let out = head;
  for (const ch of changes) {
    const replacement = ch.to
      ? ch.full.replace(`href="${ch.from}"`, `href="${ch.to.replace(/"/g, '%22')}"`)
      : ch.anchor; // unlink → plain text
    out = out.replace(ch.full, replacement); // first occurrence
  }
  return out + tail;
}

async function main() {
  console.log('\n── News Agent · audit entity links ──\n');
  if (WRITE && !IS_LOCAL && !YES) { console.error('⛔ Writing to PROD. Re-run with --write --yes.\n'); process.exit(1); }
  console.log(`Mode: ${WRITE ? (IS_LOCAL ? 'WRITE (local)' : 'WRITE (PROD)') : 'DRY RUN'}  |  limit: ${LIMIT}\n`);

  const db = await getConnection();
  const posts = await findPosts(db);
  console.log(`${posts.length} News post(s) with entity links to audit.\n`);

  let safeCount = 0, reviewCount = 0, postsWritten = 0;
  const reviewLines: string[] = [];

  for (const c of posts) {
    const changes = await auditPost(c);
    if (!changes.length) continue;
    const safe = changes.filter((ch) => ch.safe);
    const review = changes.filter((ch) => !ch.safe);

    if (safe.length) {
      console.log(`#${c.id} "${c.title.slice(0, 56)}"  — ${safe.length} SAFE correction(s)`);
      for (const ch of safe) {
        safeCount++;
        console.log(`   ✓ "${ch.anchor}"  ${ch.targetName} → ${ch.newName}\n        ${ch.from}\n     →  ${ch.to}`);
      }
      if (WRITE) {
        const newContent = applyChanges(c.content, safe);
        await db.execute(`UPDATE wp_posts SET post_content = ? WHERE ID = ?`, [newContent, c.id]);
        postsWritten++;
        console.log('   ✓ written');
      }
      console.log('');
    }

    for (const ch of review) {
      reviewCount++;
      const proposal = ch.to ? `→ ${ch.to}` : '(no confident match — would UNLINK)';
      reviewLines.push(`  #${c.id}  "${ch.anchor}"  was→ ${ch.targetName}  ${proposal}\n        ${ch.from}`);
    }
  }

  if (reviewLines.length) {
    console.log('\n──────── NEEDS REVIEW (not auto-applied) ────────');
    console.log('These existing links look wrong, but re-resolution is not confident enough to auto-fix.\n');
    console.log(reviewLines.join('\n'));
  }

  await db.end();
  console.log(`\nDone. SAFE IMDb corrections: ${safeCount}${WRITE ? ` (${postsWritten} post(s) written)` : ' (would apply)'}.  Needs-review: ${reviewCount}.`);
  if (WRITE && !IS_LOCAL && postsWritten) console.log('⚠ Prod write — run `wp cache flush` on the server so WPGraphQL serves the new bodies.');
}

main().catch((e) => { console.error('\nFatal:', e); process.exit(1); });
