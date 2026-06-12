#!/usr/bin/env bun
/**
 * One-off: insert a HAND-WRITTEN news article as a WP draft, using the exact same
 * post structure / meta / category wiring as the automated pipeline (publishDraft).
 * Because it carries the `_maleq_news_source_url` marker, News category, socialText
 * + hashtags, the autoshare plugin + sync-shares cron will share it on publish, and
 * attach-covers will give it a Pexels cover (coverQuery) on the next tick.
 *
 *   bun run scripts/news-agent/_draft-one-off.ts            # DRY RUN (prod DB read only)
 *   bun run scripts/news-agent/_draft-one-off.ts --write    # insert the draft to PROD
 *   bun run scripts/news-agent/_draft-one-off.ts --local --write   # insert to LOCAL WP
 */
import { getConnection } from '../lib/db';
import { publishDraft } from './publish';
import type { DraftedPost } from './draft';
import type { NewsItem } from './rss';

const WRITE = process.argv.includes('--write');

// Defensive em-dash strip (matches draft.ts house style — body already avoids them).
const deDash = (s: string) =>
  s.replace(/\s+[—―]\s+/g, ', ').replace(/\s*[—―]\s*/g, '-');

const SOURCE_URL =
  'https://www.queerty.com/how-this-lesbian-comics-favorite-baseball-team-made-her-pride-month-dream-come-true-20260612';
const ORIGINAL_HEADLINE =
  'How this lesbian comic’s favorite baseball team made her Pride Month dream come true';

const TITLE = 'Tee Sanders and the White Sox Turned Pride Night Into a Chicago Landmark Moment';
const SLUG = 'tee-sanders-white-sox-pride-night-hat-chicago';
const EXCERPT =
  'Chicago comedian Tee Sanders co-designed a White Sox Pride hat honoring Stonewall, marriage equality, and Black queer identity. The first 700 fans in the door got one.';
const SEO =
  'Lesbian comic Tee Sanders teamed up with the Chicago White Sox to design a Pride Night hat honoring Stonewall, Obergefell, and Black queer identity. Here’s the story.';

const BODY = `<p>Tee Sanders has always worn her Chicago White Sox hat like a statement. This week, the statement became official: the lesbian comedian and NAACP Image Award winner co-designed a limited Pride Night hat with the White Sox that is equal parts queer history lesson and South Side love letter.</p>

<aside class="key-takeaways"><h3>The quick version</h3><ul><li>Sanders, a lesbian comic with over 1.5 million Instagram and TikTok followers, co-designed a special Pride hat with the Chicago White Sox for their Pride Night at Guaranteed Rate Field.</li><li>The hat features a Freedom Day patch honoring the Stonewall Riots, a "2015" decal commemorating <em>Obergefell v. Hodges</em>, a Black Power fist, and the slogan "I'm from da crib."</li><li>The first 700 fans through the gates received the hat; the White Sox also won 2-1, ending a tough stretch with a first-place divisional standing.</li><li>Sanders threw out the first pitch at last year's Pride Night; this collaboration deepens a growing partnership between her and the organization.</li></ul></aside>

<h2>A Hat That Refuses to Choose</h2>
<p>The design brief Sanders brought to the White Sox was simple: represent everything she actually is. One side of the hat carries a Freedom Day patch evoking the 1969 Stonewall Riots and a "2015" marker for the <em>Obergefell v. Hodges</em> Supreme Court ruling that secured marriage equality nationwide. Flip it over and you find a Black Power fist and the phrase "I'm from da crib" as a nod to her South Side roots.</p>

<blockquote class="pullquote"><p>"I'm a black lesbian from Chicago. The hat needs to represent that."</p><cite>Tee Sanders</cite></blockquote>

<p>That insistence on intersectionality is more than personal preference. For years, LGBTQ+ advocacy groups have pushed pro sports teams to move past generic rainbow-logoed merchandise and toward activations that reflect the full diversity of queer fans. Sanders, without a policy brief in hand, did exactly that by instinct.</p>

<h2>The Day Itself</h2>
<p>Sanders started Pride Night before sunrise, doing local TV and radio interviews at 6:00 a.m., then made her way to Guaranteed Rate Field, where the first 700 fans received her hat. The White Sox beat the Kansas City Royals 2-1, extending what has become a quietly remarkable turnaround season after back-to-back last-place finishes. Vegan hot dogs and jackfruit sliders rounded out an event Sanders described as immediately welcoming.</p>

<p>"From the time I walked in, it was all smiles and love," she said. "I said, 'OK. This is a safe space for us.'"</p>

<p>Her goal was always a hat that crossed the aisle. White Sox fans, she figured, should be able to wear it proudly whether they're queer or an ally. The response, she says, confirmed the approach worked.</p>

<blockquote class="pullquote"><p>"Everyone can enjoy the hat. It's huge to have your ally rocking the rainbow and being proud to rock the hat, because that represents me."</p><cite>Tee Sanders</cite></blockquote>

<h2>Cubs Country and the South Side Geography of Pride</h2>
<p>The Cubs have long held a structural advantage in LGBTQ+ fan engagement: Wrigley Field sits one block from Boystown, Chicago's historic queer neighborhood. The proximity has given them a natural community pipeline for decades. The White Sox, based on the South Side with its predominantly Black cultural identity, have had to build that relationship more intentionally. Sanders is part of that effort, and the hat is its most visible expression yet.</p>

<aside class="stat-callout"><span class="stat-number">1.5M+</span><span class="stat-label">followers Tee Sanders has built on Instagram and TikTok with her Chicago-rooted queer comedy</span></aside>

<h2>Why It Matters</h2>
<p>Pride merchandise co-created by an actual community member, one who insisted on Stonewall and <em>Obergefell</em> and a Black Power fist all on the same hat, is a different thing from a team slapping a rainbow on existing stock. Sanders had real creative control, and it shows in a design that tells a layered story about what queer Blackness in Chicago looks like. The White Sox gave her that room and, by most accounts, got out of the way. That is the model. Other franchises should take notes.</p>`;

const ATTRIBUTION = `<p class="news-source"><em>Source: <a href="${SOURCE_URL}" target="_blank" rel="nofollow noopener">Queerty</a></em></p>`;

const item: NewsItem = {
  sourceName: 'Queerty',
  title: ORIGINAL_HEADLINE,
  url: SOURCE_URL,
  summary: '',
  contentHtml: '',
  imageUrl: null,
  publishedAt: null,
  // @ts-expect-error NewsItem.id falls back to url; we only need the fields publishDraft reads.
  id: SOURCE_URL,
};

const drafted = {
  title: deDash(TITLE),
  slug: SLUG,
  excerpt: deDash(EXCERPT),
  seoDescription: deDash(SEO),
  bodyHtml: deDash(BODY),
  entityLinks: [],
  sourcesUsed: ['S1'],
  socialText: deDash(
    'A Chicago comic talked the White Sox into a Pride hat that stitches Stonewall, marriage equality, and Black queer identity onto one brim, and the first 700 fans took it home.',
  ),
  hashtags: ['Pride', 'Baseball', 'LGBTQ', 'BlackQueer', 'Chicago'],
  coverHeadline: 'A Pride Hat With Receipts',
  coverQuery: 'rainbow pride baseball cap on stadium seats',
  coverPerson: '',
  contentHtml: `${deDash(BODY)}\n${ATTRIBUTION}`,
  item,
  usedSourceUrls: [SOURCE_URL],
  tags: ['pride', 'baseball', 'lgbtq representation', 'black queer', 'chicago'],
} as unknown as DraftedPost;

async function main() {
  const words = drafted.bodyHtml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const isLocal = process.argv.includes('--local');
  console.log(`\nTitle:   ${drafted.title}`);
  console.log(`Slug:    ${drafted.slug}`);
  console.log(`Body:    ~${words} words, ${(drafted.bodyHtml.match(/<h2/g) || []).length} H2`);
  console.log(`Tags:    ${drafted.tags.join(', ')}`);
  console.log(`Source:  ${SOURCE_URL}`);
  console.log(`DB:      ${isLocal ? 'LOCAL' : 'PROD'}`);
  console.log(`Mode:    ${WRITE ? 'WRITE' : 'DRY RUN'}\n`);

  if (!WRITE) {
    console.log('Dry run — re-run with --write to insert the draft.');
    return;
  }

  const db = await getConnection();
  try {
    const res = await publishDraft(db, drafted);
    console.log(`✓ Draft #${res.id} created: ${res.title}`);
    console.log(`  Edit: https://wp.maleq.com/wp-admin/post.php?post=${res.id}&action=edit`);
    if (!isLocal) console.log('\n⚠ Prod write — flush WP cache: wp cache flush');
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
