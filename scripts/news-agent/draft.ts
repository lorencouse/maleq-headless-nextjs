/**
 * Drafting: turn a clustered story (one primary + optional same-event sources from
 * other outlets) into an ORIGINAL short news piece via Claude.
 *
 * Hard rules baked into the system prompt:
 *  - Never reproduce source articles. Write a fresh, synthesized piece.
 *  - Use additional sources ONLY if they cover the same event; otherwise rely on
 *    the primary. The model reports which sources it actually used (sourcesUsed),
 *    and we attribute exactly those — so an over-eager cluster can't conflate stories.
 *  - Stay factual; no invented quotes, stats, or names.
 *
 * Uses the same messages.parse + zodOutputFormat pattern as scripts/gen-guide.ts.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { DRAFT_MODEL, RESEARCH_MODEL, ENABLE_RESEARCH } from './config';
import type { NewsItem } from './rss';
import type { StoryCluster } from './cluster';
import { gatherMaterial, extractEmbeds } from './extract';
import { addEntityLinks } from './entity-links';

// Field guidance lives in the SYSTEM prompt (which prompt-caches on Sonnet 5);
// these .describe() strings ride uncached on EVERY request, so keep them to
// compact field semantics — don't re-grow them into essays (that cost ~2k
// tokens/story before the 2026-08-05 trim).
const DraftSchema = z.object({
  title: z.string().describe('Rewritten, original headline (60–80 chars). Not copied from any source.'),
  slug: z.string().describe('URL slug: lowercase, hyphen-separated, no punctuation.'),
  excerpt: z.string().describe('One- or two-sentence dek summarizing the story.'),
  seoDescription: z.string().describe('SEO meta description, max 155 characters.'),
  bodyHtml: z.string().describe(
    'The original news piece in HTML, per the system prompt (structure, voice, visual elements, ' +
    'LENGTH CAP). Allowed tags only: <p>, <h2>, <h3>, <strong>, <em>, <ul>, <li>, <blockquote>, ' +
    '<cite>, <aside>, <span>. No "Sources:" line (appended automatically) and no <a> tags or ' +
    'URLs (links are added from entityLinks).',
  ),
  entityLinks: z.array(z.object({
    text: z.string().describe('Anchor phrase EXACTLY as it appears in bodyHtml (verbatim substring, same casing).'),
    query: z.string().describe('Lookup name — the Wikipedia article title when known (e.g. "Heartstopper (TV series)", "GLAAD").'),
    kind: z.enum(['film', 'tv', 'person', 'organization', 'place', 'book', 'music', 'game', 'other'])
      .describe('Entity kind (picks the site we link to — see system prompt). Closest fit.'),
  })).describe(
    'Notable real-world entities in bodyHtml a professional outlet would hyperlink (see system ' +
    'prompt rules). First mention only, no duplicates, no generic phrases, 0–6 items; empty array if none.',
  ),
  tags: z.array(z.string()).describe('3–5 lowercase topic tags.'),
  socialText: z.string().describe(
    'Social-post HOOK: one conversational sentence (~12–25 words, ≤200 chars) for the post body. ' +
    'NOT the headline and NOT the cover overlay. Sentence case; no hashtags, emoji, quotes, or URL.',
  ),
  hashtags: z.array(z.string()).describe(
    '3–5 discovery hashtags without the #, letters/digits only, CamelCase for multi-word ' +
    '(e.g. "QueerNews", "TransRights"). Established tags people actually browse, broad + topical mix.',
  ),
  coverHeadline: z.string().describe(
    'Short scroll-stopping hook overlaid on the cover image: 2–6 words (ideally 3–5), sharper ' +
    'than the title, rendered ALL CAPS. No end punctuation, hashtags, quotes, or emoji. ' +
    'E.g. "MARRIAGE EQUALITY SURVIVES".',
  ),
  coverQuery: z.string().describe(
    'LITERAL stock-photo search phrase (3–6 words): photographable scenes/objects, never named ' +
    'people/brands/events (e.g. "courthouse steps exterior", "two grooms wedding"). Avoid bare ' +
    '"lgbtq"/"pride" unless the story is literally that. Always provide, even with coverPerson set.',
  ),
  coverPerson: z.string().nullable().describe(
    'The single public figure the story centers on (their licensed portrait becomes the cover), ' +
    'named EXACTLY as their Wikipedia article title — see the COVER FIELDS rule in the system ' +
    'prompt. Null only when no single dominant individual exists.',
  ),
  coverWork: z.object({
    title: z.string().describe('Title as it appears on IMDb/TMDB.'),
    kind: z.enum(['film', 'tv']),
  }).nullable().describe(
    'The single film/TV show the piece is centrally ABOUT (its poster becomes the cover). Null if ' +
    'none, or when a person is the real subject (then use coverPerson — never set both).',
  ),
  sourcesUsed: z.array(z.string()).describe(
    'IDs ("S1","S2"…) of ALL sources reporting the SAME event. Always include "S1"; include every ' +
    'corroborating source; omit only sources about a genuinely different story.',
  ),
  publishable: z.boolean().describe('false if off-topic, unverifiable, defamatory, or unsuitable for an LGBTQ+ retail blog.'),
  skipReason: z.string().nullable().describe('If publishable is false, a short reason; otherwise null.'),
});

export type DraftedPost = z.infer<typeof DraftSchema> & {
  /** bodyHtml + the deterministic attribution block (links to the sources actually used). */
  contentHtml: string;
  /** Primary item — drives slug fallback, dedupe URL, image, primary outlet. */
  item: NewsItem;
  /** Canonical URLs actually cited (primary + validated additional). Stored for dedupe. */
  usedSourceUrls: string[];
};

const SYSTEM_PROMPT = `You are the news editor for Male Q, an LGBTQ+ sexual-wellness and lifestyle retailer's blog.

Your job: given source material about an LGBTQ+ news story — a PRIMARY source, sometimes ADDITIONAL sources from other outlets, and often a verified RESEARCH BRIEF — write an ORIGINAL, SUBSTANTIAL news piece for our audience. The goal is NOT a quick rehash of the original: it should be deeper, more contextual, and more human than the source, and read like a real writer with a point of view wrote it.

USING MULTIPLE SOURCES:
- The additional sources MAY cover the same event as the primary, or may have been grouped by mistake.
- Decide which additional sources report the SAME specific event. Ignore any that are about a different story.
- When two or more sources cover the same event, treat the others as corroboration: synthesize across them, weave in any extra detail they add, and your piece should clearly draw on more than one. If sources conflict on a fact, note the discrepancy neutrally rather than picking one.
- In "sourcesUsed", list the IDs of EVERY same-event source (always include S1) — not just the one you leaned on most. This is how readers see the story was corroborated.

USING THE RESEARCH BRIEF:
- When a RESEARCH BRIEF is provided, it contains verified background, history, prior related events, statistics, and broader context that the source coverage lacks. This is your raw material for adding genuine depth.
- Fold its context into your piece so the reader understands not just WHAT happened but the history and stakes behind it. This is the main lever for being more valuable than the original.
- It is still input, not gospel: only state what the brief or the sources actually support. Do NOT invent facts, quotes, or numbers, and do NOT claim certainty the brief flagged as uncertain.

LENGTH — QUALITY OVER WORD COUNT:
- There is a HARD CAP in the user message (the LENGTH CAP): your piece MUST NOT exceed it. The cap is ~20% above the primary source's length — enough room to add real context and a point of view, not to pad.
- Aim to cover the story completely and well, then STOP. A shorter, sharper piece is better than a longer, padded one. Never write to hit a number — write until the story is fully told, then end.
- Cut ruthlessly: no fluff, no hedging, no throat-clearing, no restating the same point in different words, no filler transitions. Every sentence must add information, context, or a genuine point of view the previous sentences didn't.
- If the story is thin and you'd have to repeat yourself to reach even the cap, DON'T — write the most complete honest piece the material supports and stop well under the cap.

STRUCTURE & VOICE:
- Open with a 1–2 sentence lede <p> that lands the news, then build several sections, each led by an <h2> subheading.
- Mix two kinds of sections: (1) FACTUAL REPORTING sections that tell the story and its context, and (2) ONE OR TWO EDITORIAL/CONTEXT sections that give Male Q's perspective. VARY the editorial heading every article — rotate among "MQ's Take", "More Context", "Worth Considering", "Why It Matters", "The Bigger Picture", "Our Read", "What to Watch", or similar. Never use the same formulaic "What happened / The reaction / Why it matters" skeleton every time; let the story shape the sections.
- Write in your own words — NEVER copy sentences or distinctive phrasing from any source.
- Voice: warm, community-minded, plain-spoken, and genuinely human — varied sentence length, a clear point of view, no wire-service flatness and no AI-template tics. Have an opinion in the editorial sections, but keep it grounded in the facts and clearly distinct from the straight reporting.
- Be factual and neutral-to-supportive in the reporting. Do not invent quotes, statistics, names, dates, or outcomes.
- No defamation, no outing of private individuals, no medical or legal advice.
- Audience is 18+. Keep it tasteful; this is a news piece, not marketing. Do not push products.
- bodyHtml: valid HTML using only <p>, <h2>, <h3>, <strong>, <em>, <ul>, <li>, <blockquote>, <cite>, <aside>, <span>. No images, scripts, or inline styles (use the class names below, never a style= attribute). Do NOT add a sources line. Do NOT write <a> tags or URLs yourself — links are added for you from entityLinks.

VISUAL ELEMENTS (use these to break up the text — each renders as a styled callout; content in them must be factual, never invented):
- KEY TAKEAWAYS box — include exactly ONE, immediately after the lede paragraph and before the first <h2>: <aside class="key-takeaways"><h3>The quick version</h3><ul><li>…</li><li>…</li><li>…</li></ul></aside>. 3–4 short, scannable bullets covering only the essential facts (who/what/why-it-matters). No fluff, no opinion.
- PULL QUOTES — include 1–2, spaced apart and placed BETWEEN paragraphs (never two in a row, never right after a heading): <blockquote class="pullquote"><p>…</p><cite>Name</cite></blockquote>. Strongly prefer a real, verbatim quotation that appears in the sources, with the speaker in <cite>. Only if there is genuinely no quotable line may you feature one sharp sentence of your own that captures the stakes, and then omit <cite>. Keep each under ~30 words. NEVER invent a quote or put words in someone's mouth.
- STAT CALLOUT — include AT MOST ONE, and ONLY if the story or research brief contains a genuinely striking standalone number or fact: <aside class="stat-callout"><span class="stat-number">7,000</span><span class="stat-label">miles between them</span></aside>. If there is no compelling real number, OMIT it entirely — do not manufacture a statistic.
- These elements are IN ADDITION to the prose, not a replacement. Don't overdo it: a typical piece has the key-takeaways box plus 1–2 pull quotes, and a stat callout only when the facts truly warrant one.
- entityLinks: like a professional outlet, flag the notable real-world things you mention so we can link them to the most authoritative site — films and TV shows (→ IMDb / Rotten Tomatoes), public figures incl. musicians (→ IMDb / Wikipedia), organizations and places (→ their official site / Wikipedia), books (→ Goodreads), albums or songs (→ AllMusic), video games (→ Steam), and laws, events, plays, generic topics (→ Wikipedia). For each, give the exact anchor text as it appears in bodyHtml, a lookup term, and its kind. Be selective and precise: only unambiguous, genuinely notable entities, first mention only, no duplicates, none for generic phrases. Return an empty array when nothing qualifies. We verify each against authoritative databases and silently drop any that don't resolve, so wrong guesses cost nothing but vague ones waste a slot.
- Never use em-dashes (—) in ANY field — not the body, title, excerpt, seoDescription, socialText, or coverHeadline. Use commas, periods, colons, or parentheses instead.
- coverHeadline: a short, punchy hook (2–6 words) that gets overlaid on the social cover image. It is NOT the article title — make it sharper and more scroll-stopping, while staying factual (no hype that the story doesn't support). Think feed-engagement, not SEO.
- socialText: the conversational one-sentence hook that becomes the BODY of the social post (the headline is already shown in the link card, so don't repeat it). Give people a reason to click — an angle or stake — without clickbait or anything the story doesn't support.
- hashtags: 3–5 discovery hashtags (no #, CamelCase for multi-word) that real people browse, for reach on Bluesky/Mastodon/X/Threads.

COVER FIELDS (drive the cover-image pipeline):
- coverPerson — STRONG RULE: if a named public figure (celebrity, athlete, politician, artist, official) appears in the HEADLINE as the main actor or subject, return THAT person, even when the story also discusses a group or issue they act on ("Trump Rants About Trans Athletes to Kids" → "Donald Trump", not null). Name them exactly as their Wikipedia article title. Null only when no single dominant individual exists (an institution acts, or a group/event story). Two equal figures → the one named first in the headline.
- coverWork — set only when the piece is essentially ABOUT one film/series (review, trailer, casting, recap). Prefer coverPerson over coverWork when a named individual is the real subject; never set both.
- coverQuery — always provide as the stock-photo fallback: a literal photographable scene, never named people or brands.
- Set publishable=false (with a skipReason) if the item is off-topic for an LGBTQ+ audience, pure clickbait, can't be summarized factually, or is unsuitable for a brand blog.`;

const ALLOWED_TAGS = ['p', 'h2', 'h3', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote', 'cite', 'aside', 'span'];
// Only `class` survives — it carries our styled-element hooks (pullquote / key-takeaways /
// stat-callout). The frontend sanitizer also allows class on these tags; everything else
// (style, ids, etc.) is stripped.
const ALLOWED_ATTRS = { '*': ['class'] };

/**
 * Strip em-dashes from generated copy. Claude is told not to use them, but this is the
 * deterministic guarantee that none reach articles, social posts, or the cover overlay
 * (all of which derive from these fields). A spaced clause-break dash becomes a comma;
 * any remaining (compound) dash becomes a hyphen. Covers em-dash (—) and horizontal bar (―).
 */
export function stripEmDashes(s: string): string {
  return s
    .replace(/\s+[—―]\s+/g, ', ')
    .replace(/\s*[—―]\s*/g, '-');
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Resolve the model's sourcesUsed IDs (S1, S2…) against the ordered source list. */
function resolveUsedSources(ordered: NewsItem[], usedIds: string[]): NewsItem[] {
  const used: NewsItem[] = [ordered[0]]; // primary (S1) always included
  const seen = new Set([0]);
  for (const id of usedIds) {
    const m = /^S(\d+)$/i.exec(id.trim());
    if (!m) continue;
    const idx = parseInt(m[1], 10) - 1;
    if (idx > 0 && ordered[idx] && !seen.has(idx)) { seen.add(idx); used.push(ordered[idx]); }
  }
  return used;
}

/**
 * Distribute embeds through the body — one after each <h2> section's paragraphs,
 * in order — instead of clumping them at the end. Extras (more embeds than
 * sections) trail the last section; if the body has no headings, all go at the end.
 * Exported so the one-off migration of existing posts can reuse the exact logic.
 */
export function interleaveEmbeds(bodyHtml: string, embeds: string[]): string {
  if (!embeds.length) return bodyHtml;
  // Split before each <h2>; segment[0] is the lede before the first heading.
  const segments = bodyHtml.split(/(?=<h2[\s>])/i);
  const sectionIdx = segments
    .map((s, i) => (/^<h2[\s>]/i.test(s) ? i : -1))
    .filter((i) => i >= 0);
  if (sectionIdx.length === 0) return `${bodyHtml}\n${embeds.join('\n')}`;

  let e = 0;
  for (const idx of sectionIdx) {
    if (e >= embeds.length) break;
    segments[idx] = `${segments[idx]}\n${embeds[e++]}`;
  }
  // Any leftover embeds trail the final section.
  if (e < embeds.length) {
    const last = sectionIdx[sectionIdx.length - 1];
    segments[last] = `${segments[last]}\n${embeds.slice(e).join('\n')}`;
  }
  return segments.join('');
}

/** Word count of a plain-text blob — used to set the per-article length target. */
function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const RESEARCH_SYSTEM = `You are a researcher for Male Q, an LGBTQ+ news blog. You are given a news story we are about to write about. Run a SINGLE focused web search to find ADDITIONAL context the source coverage lacks: relevant background, history, prior related events, verifiable statistics, key players, and how this connects to broader issues affecting LGBTQ+ communities.

Use at most ONE search — make the query count. Do NOT chain follow-up searches. Do NOT rewrite or summarize the story itself. Produce a tight RESEARCH BRIEF (≤250 words) — short paragraphs or bullets — of verifiable, useful context our writer can fold in to make the article deeper than the original. Prefer authoritative sources. Flag clearly where something is well-established vs. uncertain or contested. Never invent facts or numbers. If you genuinely can't find anything beyond the source coverage, say so in one line.`;

/** Attribution block linking exactly the sources actually used. */
function attribution(used: NewsItem[]): string {
  const links = used
    .map((s) => `<a href="${s.url.replace(/"/g, '%22')}" target="_blank" rel="nofollow noopener">${s.sourceName}</a>`)
    .join(', ');
  const label = used.length > 1 ? 'Sources' : 'Source';
  return `<p class="news-source"><em>${label}: ${links}</em></p>`;
}

/* ─────────────────── Batch-friendly building blocks ───────────────────
 * The pipeline runs both Claude passes through the Batches API (50% off), so
 * drafting is split into pure param-builders + result-parsers that run.ts can
 * fan out: prepareStory → buildResearchParams / extractResearchBrief →
 * buildDraftParams → finalizeDraft. draftPost() below composes the same pieces
 * sequentially with direct calls for one-off/manual use.
 */

/** A cluster with its article text fetched, sources ranked, primary chosen. */
export interface PreparedStory {
  cluster: StoryCluster;
  /** Sources ordered by material length — index 0 is the primary (S1). */
  ordered: NewsItem[];
  /** Fetched material per source, capped (primary 8k chars; secondaries 5k; ≥S5 omitted). */
  materials: string[];
}

/** Chars of article material included per source position. */
const PRIMARY_MATERIAL_CHARS = 8000;
const SECONDARY_MATERIAL_CHARS = 5000;
const MAX_SOURCES_WITH_MATERIAL = 4; // S1 + 3 secondaries; further sources are header-only

/**
 * Fetch article text for every source in parallel, then make the source with the
 * MOST material the primary (S1) — feed length is a poor proxy (e.g. them. has a
 * thin feed but full article text). The model is told to always use S1. Secondary
 * material is capped so a big cluster can't blow up the draft prompt.
 */
export async function prepareStory(cluster: StoryCluster): Promise<PreparedStory> {
  const initial = [cluster.primary, ...cluster.sources.filter((s) => s.url !== cluster.primary.url)];
  const fetched = await Promise.all(initial.map((s) => gatherMaterial(s, PRIMARY_MATERIAL_CHARS)));
  const ranked = initial
    .map((s, i) => ({ s, mat: fetched[i] }))
    .sort((a, b) => b.mat.length - a.mat.length);
  const ordered = ranked.map((r) => r.s);
  const materials = ranked.map((r, i) => {
    if (i === 0) return r.mat;
    if (i < MAX_SOURCES_WITH_MATERIAL) return r.mat.slice(0, SECONDARY_MATERIAL_CHARS);
    return '';
  });
  return { cluster, ordered, materials };
}

/**
 * Research pass (Haiku + server-side web_search) params. Kept as a separate call
 * from the structured draft — web results carry citations, which structured
 * outputs reject. Cost guardrails: cheap model, max_uses: 1, and NO pause_turn
 * re-send (the large search-result extracts are sent once, never re-sent; the
 * brief is whatever text the single search produced).
 * NOTE: Haiku 4.5 supports only the basic `web_search_20250305` tool — the
 * `_20260209` variant 400s on it (that bug silently disabled research for two
 * months; the failure was swallowed as "drafting from sources only").
 */
export function buildResearchParams(prep: PreparedStory): Anthropic.MessageCreateParamsNonStreaming {
  const primary = prep.ordered[0];
  const prompt =
    `STORY HEADLINE: ${primary.title}\n` +
    `OUTLET: ${primary.sourceName}\n` +
    `PUBLISHED: ${primary.publishedAt?.toISOString() ?? 'unknown'}\n` +
    `SOURCE MATERIAL (for grounding — do not just restate it):\n${prep.materials[0].slice(0, 3000)}`;
  return {
    model: RESEARCH_MODEL,
    max_tokens: 1200,
    system: RESEARCH_SYSTEM,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 } as any],
    messages: [{ role: 'user', content: prompt }],
  };
}

/** Pull the plain-text brief out of a research response ('' on refusal/empty). */
export function extractResearchBrief(msg: Anthropic.Message): string {
  if (msg.stop_reason === 'refusal') return '';
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Structured draft-call params (Sonnet 5; adaptive thinking left ON for quality). */
export function buildDraftParams(
  prep: PreparedStory,
  research: string,
  model = DRAFT_MODEL,
): Anthropic.MessageCreateParamsNonStreaming {
  const { ordered, materials } = prep;

  // Length CAP (not a target): never more than ~20% over the primary source — quality
  // over length, no padding or repetition. Floor (350) stops thin/feed-only scrapes from
  // forcing a stub; absolute ceiling (1500) guards a pathologically long source.
  const sourceWords = wordCount(materials[0] || '');
  const maxWords = Math.min(1500, Math.max(350, Math.round(sourceWords * 1.2)));

  const block = (s: NewsItem, i: number, material: string) =>
    `[S${i + 1}] ${i === 0 ? 'PRIMARY SOURCE' : 'ADDITIONAL SOURCE (may or may not be the same event)'}\n` +
    `OUTLET: ${s.sourceName}\n` +
    `HEADLINE: ${s.title}\n` +
    `PUBLISHED: ${s.publishedAt?.toISOString() ?? 'unknown'}\n` +
    `CANONICAL URL: ${s.url}\n` +
    (material
      ? `MATERIAL (context only — do not copy):\n${material}`
      : 'MATERIAL: (omitted — corroborating source; judge same-event from the headline)');

  const sourcesBlock = ordered.map((s, i) => block(s, i, materials[i])).join('\n\n');
  const researchBlock = research
    ? `\n\n=== RESEARCH BRIEF (verified background gathered separately; fold it in for depth — but only state what it or the sources support) ===\n${research}`
    : '';
  const lengthBlock =
    `\n\n=== LENGTH CAP ===\nThe primary source runs about ${sourceWords} words. Your piece MUST NOT exceed ${maxWords} words (~20% over the source). This is a hard ceiling, NOT a target to reach — cover the story completely and well, then stop. A shorter, sharper piece beats a longer, padded one. Never repeat a point or add filler to fill space.`;

  return {
    model,
    // Headroom for Sonnet 5's default adaptive thinking + the article itself —
    // max_tokens caps thinking AND response text together on this model.
    max_tokens: 16000,
    // The ~2k-token system prompt clears Sonnet 5's 1,024-token cache minimum,
    // so this breakpoint is live again (it was a silent no-op on Haiku's 4,096
    // minimum). Batch items may or may not hit it — harmless either way.
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { format: zodOutputFormat(DraftSchema) },
    messages: [{ role: 'user', content: sourcesBlock + researchBlock + lengthBlock }],
  };
}

/**
 * Parse a structured draft response (batch results can't use messages.parse, so
 * we validate against the Zod schema ourselves) and run all post-processing:
 * sanitize → strip em-dashes → resolve cited sources → embeds → entity links →
 * attribution. Throws on refusal/unparseable output (caught per-story by run.ts).
 */
export async function finalizeDraft(prep: PreparedStory, msg: Anthropic.Message): Promise<DraftedPost> {
  const { ordered } = prep;
  if (msg.stop_reason === 'refusal') {
    throw new Error('Claude refused to draft this story.');
  }
  const jsonText = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!jsonText.trim()) {
    throw new Error(`Claude returned no structured output (stop_reason: ${msg.stop_reason}).`);
  }
  let parsed: z.infer<typeof DraftSchema>;
  try {
    parsed = DraftSchema.parse(JSON.parse(jsonText));
  } catch (e: any) {
    throw new Error(`Structured output failed validation (possibly truncated): ${e.message?.slice(0, 200)}`);
  }

  const cleanBody = stripEmDashes(
    sanitizeHtml(parsed.bodyHtml, {
      allowedTags: ALLOWED_TAGS,
      allowedAttributes: ALLOWED_ATTRS,
    }),
  );

  const used = resolveUsedSources(ordered, parsed.sourcesUsed || []);

  // Pull social/video embeds from the sources we actually used and insert them
  // between the article body and the source credit. Appended raw (post-sanitize)
  // — the iframes are ours; the frontend sanitizer gates them by hostname.
  const embedLists = await Promise.all(used.map((s) => extractEmbeds(s.url, 3)));
  const seen = new Set<string>();
  const embeds = embedLists
    .flat()
    .filter((e) => (seen.has(e.html) ? false : (seen.add(e.html), true)))
    .slice(0, 3)
    .map((e) => e.html);

  // Add verified contextual links (Wikipedia) for notable entities the model
  // flagged — books, shows, places, orgs, public figures — before interleaving
  // embeds. We resolve every URL ourselves, so nothing hallucinated gets through.
  const { html: linkedBody } = await addEntityLinks(cleanBody, parsed.entityLinks);
  const body = interleaveEmbeds(linkedBody, embeds);

  return {
    ...parsed,
    title: stripEmDashes(parsed.title),
    excerpt: stripEmDashes(parsed.excerpt),
    seoDescription: stripEmDashes(parsed.seoDescription),
    coverHeadline: stripEmDashes(parsed.coverHeadline),
    socialText: stripEmDashes(parsed.socialText),
    slug: slugify(parsed.slug || parsed.title),
    contentHtml: `${body}\n${attribution(used)}`,
    item: ordered[0],
    usedSourceUrls: used.map((s) => s.url),
  };
}

/**
 * One-off sequential drafting (direct API calls, no batch) — for manual/backfill
 * use. The cron path in run.ts uses the exported pieces above through the
 * Batches API instead.
 */
export async function draftPost(cluster: StoryCluster, model = DRAFT_MODEL): Promise<DraftedPost> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Export it before running the news agent.');
  }
  const client = new Anthropic({ apiKey });
  const prep = await prepareStory(cluster);

  let research = '';
  if (ENABLE_RESEARCH) {
    try {
      const res = await client.messages.create(buildResearchParams(prep), { timeout: 90_000, maxRetries: 1 });
      research = extractResearchBrief(res);
    } catch (err) {
      console.warn(`  ⚠️  research pass failed (${(err as Error).message}); drafting from sources only`);
    }
  }

  const msg = await client.messages.create(buildDraftParams(prep, research, model));
  return finalizeDraft(prep, msg);
}
