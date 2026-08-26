/**
 * Vetting: decide whether a story is ours to cover BEFORE we spend anything on it.
 *
 * The scope rules were previously enforced in two places — a headline-pattern
 * filter (editorial-filter.ts, free) and the drafter itself (draft.ts, which sets
 * publishable=false after reading the full article). The drafter's check is the
 * accurate one, because a newsy-sounding headline on an interview is still an
 * interview — but by the time it fires we have already paid for a web-research
 * pass and a full Sonnet draft, and the run has nothing to show for it.
 *
 * This pass closes that gap: one cheap Haiku call per candidate, on the FULL
 * article text, run before research and drafting. Rejects cost ~$0.005 instead of
 * ~$0.11, and the run moves on to the next candidate instead of ending empty.
 *
 * draft.ts keeps its own check as the backstop — this is a cheap pre-filter, not
 * a replacement, and it fails OPEN (an unparseable verdict lets the story through
 * to the drafter, which will catch it).
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { VET_MODEL } from './config';
import type { PreparedStory } from './draft';

const VetSchema = z.object({
  isNewsEvent: z.boolean().describe(
    'true only if the SOURCE MATERIAL reports a news event we could independently cover; ' +
    "false if it is the outlet's own original work (listicle, how-to, opinion, essay, review, interview, profile, recap, gallery, quiz, roundup).",
  ),
  format: z.string().describe(
    "What the source actually is, in 1-3 words: 'news event', 'listicle', 'interview', 'opinion essay', 'review', 'recap', 'how-to', 'photo gallery', 'weekly roundup'.",
  ),
  reason: z.string().describe('One short sentence of justification, naming the evidence in the text.'),
});

export type VetVerdict = z.infer<typeof VetSchema>;

/**
 * Deliberately a near-verbatim lift of the EDITORIAL SCOPE section of draft.ts's
 * system prompt. The two checks MUST agree — if this pass is more permissive the
 * drafter still rejects (we just paid for it), and if it is stricter we silently
 * lose stories the drafter would have written. Change them together.
 */
const VET_SYSTEM = `You are the vetting editor for Male Q, an LGBTQ+ sexual-wellness and lifestyle retailer's news blog. You decide whether a piece of source coverage is something we may cover at all. You do NOT write anything.

WE REPORT NEWS EVENTS, NOTHING ELSE:
- A NEWS EVENT is something that HAPPENED in the world and that any outlet could independently report — a ruling, law, election, protest, arrest, death, medical or scientific finding, official statement, corporate or institutional decision, casting or release announcement, award, or a public figure's public act.
- We NEVER rewrite another publication's ORIGINAL CREATIVE WORK. If the source's value lies in the outlet's own selection, framing, taste, access or voice rather than in an underlying event, it is THEIR product and rewriting it is derivative no matter how much we reword it. That includes: "top 10"/"best of"/ranked lists and other listicles, how-to and service guides, explainers built around the writer's own framing, opinion columns, op-eds, editorials and personal essays, first-person narratives, reviews and criticism, interviews, Q&As and profiles built on the outlet's own access, photo galleries, recaps, quizzes, crosswords, horoscopes, newsletters, weekly roundups and other recurring columns.
- Judge what the SOURCE MATERIAL actually IS, not what its headline looks like. A newsy-sounding headline on an interview or an essay is still an interview or an essay. Read the body: first-person voice, Q&A structure, numbered entries, "we asked", ranking language and the writer's own recommendations are all tells.
- THE LINE: reporting THAT a public figure said something newsworthy in an interview is an event. Retelling the interview itself is not.
- Also set isNewsEvent=false if the material is off-topic for an LGBTQ+ audience, is pure clickbait, cannot be summarized factually, or is too thin to write from (a stub, a paywall wall, a placeholder, or nothing but a headline).
- When it is genuinely ambiguous, reject. We would rather miss a story than republish someone else's work.`;

/** Chars of primary material to judge on — enough to see the body's real shape. */
const VET_MATERIAL_CHARS = 4000;

export function buildVetParams(prep: PreparedStory): Anthropic.MessageCreateParamsNonStreaming {
  const primary = prep.ordered[0];
  const material = (prep.materials[0] || '').slice(0, VET_MATERIAL_CHARS);
  const prompt =
    `OUTLET: ${primary.sourceName}\n` +
    `HEADLINE: ${primary.title}\n` +
    `PUBLISHED: ${primary.publishedAt?.toISOString() ?? 'unknown'}\n\n` +
    `SOURCE MATERIAL:\n${material || '(no article text could be fetched)'}`;
  return {
    model: VET_MODEL,
    max_tokens: 400,
    system: [{ type: 'text', text: VET_SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { format: zodOutputFormat(VetSchema) },
    messages: [{ role: 'user', content: prompt }],
  };
}

/**
 * Parse a vetting response. Returns null when the verdict is unusable — callers
 * MUST treat null as a pass, so a flaky vet call never silently drops a story the
 * drafter would have accepted.
 */
export function parseVet(msg: Anthropic.Message): VetVerdict | null {
  if (msg.stop_reason === 'refusal') return null;
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text.trim()) return null;
  try {
    return VetSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}
