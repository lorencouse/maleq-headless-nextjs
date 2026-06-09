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
import { DRAFT_MODEL } from './config';
import type { NewsItem } from './rss';
import type { StoryCluster } from './cluster';
import { gatherMaterial, extractEmbeds } from './extract';
import { addEntityLinks } from './entity-links';

const DraftSchema = z.object({
  title: z.string().describe('Rewritten, original headline (60–80 chars). Not copied from any source.'),
  slug: z.string().describe('URL slug: lowercase, words separated by hyphens, no punctuation.'),
  excerpt: z.string().describe('One- or two-sentence dek summarizing the story.'),
  seoDescription: z.string().describe('SEO meta description, max 155 characters.'),
  bodyHtml: z.string().describe(
    'A 400–550 word original news piece in HTML. Structure: a 1–2 sentence lede <p>, ' +
    'then 2–3 sections each introduced by an <h2> subheading followed by 1–2 <p> paragraphs. ' +
    'Synthesize the sources actually used. Allowed tags only: <p>, <h2>, <strong>, <em>, <ul>, <li>. ' +
    'Do NOT include a "Sources:" line — that is appended automatically. Do NOT add any ' +
    'links yourself; instead list notable entities in "entityLinks" and we add verified links.',
  ),
  entityLinks: z.array(z.object({
    text: z.string().describe('The anchor phrase EXACTLY as it appears in bodyHtml (a verbatim substring, same casing).'),
    query: z.string().describe('The entity\'s name for a Wikipedia lookup — the article title when you know it (e.g. "Heartstopper (TV series)", "Stonewall Inn", "GLAAD").'),
    kind: z.enum(['film', 'tv', 'person', 'organization', 'place', 'book', 'music', 'game', 'other']).describe(
      'What KIND of entity this is — it picks the authoritative site we link to: ' +
      'film/tv → IMDb / Rotten Tomatoes; person (actor, director, musician, public figure) → IMDb / Wikipedia; ' +
      'organization (company, nonprofit, agency) and place (venue, city, landmark) → official site / Wikipedia; ' +
      'book → Goodreads; music (album, EP, single) → AllMusic; game (video game) → Steam; ' +
      'other (law, event, play, generic topic) → Wikipedia. Pick the closest fit.',
    ),
  })).describe(
    'Notable, real-world entities mentioned in bodyHtml that a professional outlet would ' +
    'hyperlink: films, TV shows, books, plays, albums, places/venues, organizations, laws, ' +
    'events, and public figures. For EACH, give the exact anchor text from your body, a lookup ' +
    'term, and its kind. Rules: only genuinely notable, unambiguous entities (skip generic ' +
    'terms like "the court", "activists", "the community"); pick the FIRST mention of each; do ' +
    'NOT repeat an entity; 0 to 6 items — return an empty array if the piece has no linkworthy ' +
    'entities. We verify each against authoritative databases and only link the ones that ' +
    'resolve, so favor precision over quantity.',
  ),
  tags: z.array(z.string()).describe('3–5 lowercase topic tags.'),
  socialText: z.string().describe(
    'A natural-language social-post HOOK (one sentence, ~12–25 words, ≤200 chars) used as the ' +
    'BODY of the Bluesky/Mastodon/X/Threads post. This is NOT the article headline (the headline ' +
    'already shows in the auto-generated link card) and NOT the ALL-CAPS image overlay — write a ' +
    'fresh, conversational line that makes someone want to tap through: a sharp angle, a stake, or ' +
    'an open loop. Plain sentence case, no hashtags, no emoji, no quotation marks, no trailing URL.',
  ),
  hashtags: z.array(z.string()).describe(
    '3–5 social discovery hashtags WITHOUT the leading # and WITHOUT spaces — letters/digits only, ' +
    'CamelCase for multi-word (e.g. "LGBTQ", "QueerNews", "TransRights", "MarriageEquality"). Pick ' +
    'tags people actually browse on Bluesky/Mastodon, mixing one or two broad community tags with ' +
    'specific topical ones. These drive reach, so favor established tags over niche inventions.',
  ),
  coverHeadline: z.string().describe(
    'A SHORT, punchy social-media hook to overlay on the cover image — built to stop a thumb ' +
    'scrolling a feed. 2–6 words, ideally 3–5. NOT the article title verbatim: sharper, more ' +
    'active, emotionally charged. Skimmable at a glance. No end punctuation, no hashtags, no ' +
    'quotation marks, no emoji. It will be rendered in ALL CAPS, so keep it tight enough to fit ' +
    'two short lines. E.g. title "Supreme Court Declines to Hear Marriage Equality Challenge" → ' +
    '"MARRIAGE EQUALITY SURVIVES"; title "New Study Finds LGBTQ Youth Face Higher Risks" → ' +
    '"THE NUMBERS WE CAN\'T IGNORE".',
  ),
  coverQuery: z.string().describe(
    'A concrete, LITERAL stock-photo search phrase (3–6 words) for a cover image: ' +
    'photographable scenes, objects or settings — NOT named people, brands, or specific ' +
    'events (stock sites have none of those). Capture the story\'s subject matter. ' +
    'E.g. "man lifting weights gym", "courthouse steps exterior", "person voting ballot box", ' +
    '"two grooms wedding". Avoid vague identity-only terms like "lgbtq" or "pride" alone, ' +
    'which return generic flag/parade photos — only use them if the story is literally about that. ' +
    'Always provide this even when coverPerson is set — it is the fallback when no licensed portrait is found.',
  ),
  coverPerson: z.string().nullable().describe(
    'The single public figure the story most centers on, as a real licensed portrait of them ' +
    'will be the cover. STRONG RULE: if a named public figure (celebrity, athlete, politician, ' +
    'artist, public official) appears in the HEADLINE and is the main actor or subject, return ' +
    'THAT person — even when the story also discusses a group, an issue, or other people they ' +
    'are acting on or reacting to. For "Trump Rants About Trans Athletes to Kids", the figure is ' +
    '"Donald Trump" (NOT null — the trans athletes and kids are the topic he is acting on, not ' +
    'co-equal subjects). Give their common full name EXACTLY as it titles their Wikipedia article ' +
    '(e.g. "Donald Trump", "Pedro Pascal", "Kamala Harris", "Aron Piper"). Return null ONLY when ' +
    'there is genuinely no single dominant individual — e.g. an institution acts ("Supreme Court ' +
    'rules…", "WHO announces…"), or the story is about a group/event with no central named person ' +
    '("Pride parade draws thousands"). When two-plus people share the spotlight equally, pick the ' +
    'one named first in the headline.',
  ),
  coverWork: z.object({
    title: z.string().describe('The work\'s title, as it would appear on IMDb/TMDB (e.g. "Heartstopper", "Blue Film").'),
    kind: z.enum(['film', 'tv']).describe('"film" for a movie, "tv" for a series/show.'),
  }).nullable().describe(
    'The single FILM or TV SHOW the story is centrally about — used to fetch its official poster ' +
    'as the cover. Set this when the piece is essentially ABOUT one movie or series (a review, a ' +
    'trailer/casting/release story, an episode recap). Return null when there is no single dominant ' +
    'title, or when the story centers on a PERSON instead (use coverPerson for that — do not set ' +
    'both; prefer coverPerson when a named individual is the real subject).',
  ),
  sourcesUsed: z.array(z.string()).describe(
    'The IDs (e.g. "S1","S2") of ALL sources that report the SAME event as your piece. ALWAYS ' +
    'include "S1". Include EVERY additional source that covers the same event — even if it only ' +
    'corroborates and adds no new fact. Omit a source ONLY if it is about a genuinely different story.',
  ),
  publishable: z.boolean().describe('false if the story is off-topic, unverifiable, defamatory, or unsuitable for an LGBTQ+ retail blog.'),
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

Your job: given source material about an LGBTQ+ news story — a PRIMARY source and sometimes ADDITIONAL sources from other outlets — write a SHORT, ORIGINAL news piece for our audience.

USING MULTIPLE SOURCES:
- The additional sources MAY cover the same event as the primary, or may have been grouped by mistake.
- Decide which additional sources report the SAME specific event. Ignore any that are about a different story.
- When two or more sources cover the same event, treat the others as corroboration: synthesize across them, weave in any extra detail they add, and your piece should clearly draw on more than one. If sources conflict on a fact, note the discrepancy neutrally rather than picking one.
- In "sourcesUsed", list the IDs of EVERY same-event source (always include S1) — not just the one you leaned on most. This is how readers see the story was corroborated.

WRITING RULES:
- Aim for 400–550 words WHEN the material supports it. Never invent or pad to hit a length — if the material is genuinely thin, a tight 250–300 word piece is correct. Write in your own words — NEVER copy sentences or distinctive phrasing from any source.
- Structure it like a real short news piece: a 1–2 sentence lede paragraph, then 2–3 sections each led by an <h2> subheading. Good subheads describe the angle (e.g. "What happened", "The reaction", "Why it matters") — adapt to the story, don't use those verbatim every time.
- Be factual and neutral-to-supportive. Do not invent quotes, statistics, names, dates, or outcomes. If sources are thin, write a shorter piece rather than padding with speculation.
- No defamation, no outing of private individuals, no medical or legal advice.
- Voice: warm, community-minded, plain-spoken. Brief editorial commentary is welcome but clearly distinct from the factual reporting.
- Audience is 18+. Keep it tasteful; this is a news piece, not marketing. Do not push products.
- bodyHtml: valid HTML using only <p>, <h2>, <strong>, <em>, <ul>, <li>. No images, scripts, links, or inline styles. Do NOT add a sources line. Do NOT write <a> tags or URLs yourself — links are added for you from entityLinks.
- entityLinks: like a professional outlet, flag the notable real-world things you mention so we can link them to the most authoritative site — films and TV shows (→ IMDb / Rotten Tomatoes), public figures incl. musicians (→ IMDb / Wikipedia), organizations and places (→ their official site / Wikipedia), books (→ Goodreads), albums or songs (→ AllMusic), video games (→ Steam), and laws, events, plays, generic topics (→ Wikipedia). For each, give the exact anchor text as it appears in bodyHtml, a lookup term, and its kind. Be selective and precise: only unambiguous, genuinely notable entities, first mention only, no duplicates, none for generic phrases. Return an empty array when nothing qualifies. We verify each against authoritative databases and silently drop any that don't resolve, so wrong guesses cost nothing but vague ones waste a slot.
- Never use em-dashes (—) in ANY field — not the body, title, excerpt, seoDescription, socialText, or coverHeadline. Use commas, periods, colons, or parentheses instead.
- coverHeadline: a short, punchy hook (2–6 words) that gets overlaid on the social cover image. It is NOT the article title — make it sharper and more scroll-stopping, while staying factual (no hype that the story doesn't support). Think feed-engagement, not SEO.
- socialText: the conversational one-sentence hook that becomes the BODY of the social post (the headline is already shown in the link card, so don't repeat it). Give people a reason to click — an angle or stake — without clickbait or anything the story doesn't support.
- hashtags: 3–5 discovery hashtags (no #, CamelCase for multi-word) that real people browse, for reach on Bluesky/Mastodon/X/Threads.
- Set publishable=false (with a skipReason) if the item is off-topic for an LGBTQ+ audience, pure clickbait, can't be summarized factually, or is unsuitable for a brand blog.`;

const ALLOWED_TAGS = ['p', 'h2', 'h3', 'strong', 'em', 'ul', 'ol', 'li'];

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

/** Attribution block linking exactly the sources actually used. */
function attribution(used: NewsItem[]): string {
  const links = used
    .map((s) => `<a href="${s.url.replace(/"/g, '%22')}" target="_blank" rel="nofollow noopener">${s.sourceName}</a>`)
    .join(', ');
  const label = used.length > 1 ? 'Sources' : 'Source';
  return `<p class="news-source"><em>${label}: ${links}</em></p>`;
}

export async function draftPost(cluster: StoryCluster, model = DRAFT_MODEL): Promise<DraftedPost> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Export it before running the news agent.');
  }
  const client = new Anthropic({ apiKey });

  // Fetch article text for every source in parallel, then make the source with the
  // MOST material the primary (S1) — feed length is a poor proxy (e.g. them. has a
  // thin feed but full article text). The model is told to always use S1.
  const initial = [cluster.primary, ...cluster.sources.filter((s) => s.url !== cluster.primary.url)];
  const fetched = await Promise.all(initial.map((s) => gatherMaterial(s, 4000)));
  const ranked = initial
    .map((s, i) => ({ s, mat: fetched[i] }))
    .sort((a, b) => b.mat.length - a.mat.length);
  const ordered = ranked.map((r) => r.s);
  const materials = ranked.map((r) => r.mat);

  const block = (s: NewsItem, i: number, material: string) =>
    `[S${i + 1}] ${i === 0 ? 'PRIMARY SOURCE' : 'ADDITIONAL SOURCE (may or may not be the same event)'}\n` +
    `OUTLET: ${s.sourceName}\n` +
    `HEADLINE: ${s.title}\n` +
    `PUBLISHED: ${s.publishedAt?.toISOString() ?? 'unknown'}\n` +
    `CANONICAL URL: ${s.url}\n` +
    `MATERIAL (context only — do not copy):\n${material}`;

  const userContent = ordered.map((s, i) => block(s, i, materials[i])).join('\n\n');

  const response = await client.messages.parse({
    model,
    max_tokens: 4000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { format: zodOutputFormat(DraftSchema) },
    messages: [{ role: 'user', content: userContent }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude refused to draft this story.');
  }
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error('Claude returned no parseable structured output (possibly truncated).');
  }

  const cleanBody = stripEmDashes(
    sanitizeHtml(parsed.bodyHtml, {
      allowedTags: ALLOWED_TAGS,
      allowedAttributes: {},
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
