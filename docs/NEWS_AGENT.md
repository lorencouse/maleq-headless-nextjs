# LGBTQ News Agent

Automated LGBTQ news monitoring → original news drafts → (later) social sharing.

Lives in `scripts/news-agent/`. Phase 1 (this doc) covers discovery, drafting, and
publishing **as drafts** for human approval. Phases 2–3 add social sharing and a
one-tap approval loop.

## Pipeline

```
RSS ─▶ discover.ts ─▶ dedupe.ts ─▶ editorial-filter.ts ─▶ title-dedupe.ts ─▶ vet.ts ─▶ draft.ts ─▶ publish.ts ─▶ WP draft
       freshness +    skip already   news EVENTS only —     skip near-dupe    Haiku:     Claude:      insert         "LGBTQ+ News"
       cross-feed     posted (by     drop listicles, how-   headlines from    same call  original     wp_posts +      category,
       de-dupe        source URL)    tos, opinion, reviews  the last 48 h     on the     piece +      meta + terms    status=draft
                                     interviews, galleries  (source headline) FULL text  SEO, tags   (status=draft)

                                     ── all vetting happens LEFT of draft.ts ──▶│ nothing is researched or
                                                                                 │ written until it passes
```

**Models & cost (since 2026-08-05):** drafting runs on **Sonnet 5** and the web-research
pass on **Haiku 4.5**, both submitted through the **Batches API at 50% pricing** — two
batched passes per run (research briefs, then structured drafts), polled to completion by
`run.ts`. ~$0.05–0.06/article ≈ $15/mo at 9 stories/day. Every run logs per-story token
usage and a total estimated $ line (`Run cost: …`) — prices live in `config.ts` `PRICES`.
Stories are ranked **most-corroborated first** (independent outlets covering the same
event), newest first within a tier, before the per-run limit is applied.

> ⚠ **Model/tool pairing:** the research pass must use the basic `web_search_20250305`
> tool — the `_20260209` variant 400s on Haiku, and because the failure was swallowed,
> this silently disabled ALL research for two months (Jun–Aug 2026). If you change
> `RESEARCH_MODEL`, re-check the tool variant.

Nothing is published live and nothing is shared to social in Phase 1. Every story
becomes a **draft** in the `LGBTQ+ News` category, flagged `_maleq_news_pending_review=1`,
for you to review and publish in WP admin.

## Files

| File | Role |
|------|------|
| `config.ts`   | Sources (RSS feeds), category, model, freshness window, per-run cap, meta keys |
| `rss.ts`      | Fetch + parse RSS/Atom (via `xml2js`) → normalized `NewsItem[]` |
| `discover.ts` | Pull all feeds, drop stale/dupe items, sort newest-first |
| `dedupe.ts`   | Drop stories already posted (matched on `_maleq_news_source_url(s)`) |
| `cluster.ts`  | Group same-event coverage across outlets (IDF-weighted headline overlap) → one post can cite several sources |
| `title-dedupe.ts` | Block stories whose headline near-matches a news post from the last 48 h (rarity-weighted Dice over headline tokens) |
| `editorial-filter.ts` | Drop items that are another outlet's own work (listicles, how-tos, opinion, reviews, interviews, recaps, galleries) rather than news events |
| `vet.ts`      | Pre-research news-event check: one cheap Haiku call per candidate on the FULL article text, so non-news is rejected before any research/drafting spend |
| `extract.ts`  | Fetch the article page and pull paragraph text (feed summaries are often headline-only); falls back to feed content |
| `draft.ts`    | Zod-validated structured drafting (batch-friendly param builders + parsers; Sonnet 5) → original piece with `<h2>` subheadings, synthesizing the clustered sources + research brief |
| `publish.ts`  | Insert `wp_posts` draft + `wp_postmeta` + category/tag `term_relationships` |
| `images.ts`   | Pexels search + download/resize/WebP conversion (via `sharp`) |
| `attach-covers.ts` | Pick a Pexels cover per post, import as featured image (WebP, slug-named), set alt + credit |
| `notify-review.ts` | Web-push "N new stories to review" digest to the owner's phone(s) after each drafting run (see Mobile review below) |
| `run.ts`      | Orchestrator + CLI flags + approval digest |

## Usage

Requires `ANTHROPIC_API_KEY`. DB target follows `scripts/lib/db.ts` (prod by default; `--local` for Local by Flywheel).

```bash
# 1. Check which feeds are reachable (no Claude calls, no DB writes)
ANTHROPIC_API_KEY=… bun run scripts/news-agent/run.ts --local --check-feeds

# 2. Dry run — discover, dedupe, draft, and PRINT what would be created (no DB writes)
ANTHROPIC_API_KEY=… bun run scripts/news-agent/run.ts --local

# 3. Write drafts to local WP
ANTHROPIC_API_KEY=… bun run scripts/news-agent/run.ts --local --write

# 4. Write drafts to PROD (create a DB backup first per CLAUDE.md; --yes required)
ANTHROPIC_API_KEY=… bun run scripts/news-agent/run.ts --write --yes
```

Flags: `--local`, `--write`, `--yes` (prod safety), `--check-feeds`, `--limit N`, `--model NAME`,
`--no-skip-memory` (re-consider stories earlier runs rejected).

## Length, headings & multiple sources

- Pieces target **400–550 words** with **2–3 `<h2>` subheadings**, but the model is told to
  never pad or invent — thin stories (e.g. a photo-gallery post) stay short on purpose.
- **Article text is fetched** (`extract.ts`) so the model writes from real material, not the
  headline-only feed blurb. Fetch success is per-outlet: PinkNews / them. / Washington Blade /
  LGBTQ Nation fetch well; **The Advocate and GLAAD block scrapers** (fall back to feed text,
  so those stories run shorter). Update the source list in `config.ts` if a feed degrades.
- **Multiple sources:** `cluster.ts` groups outlets covering the same event; `draft.ts` passes
  all of them (each labelled S1, S2…), the model confirms which are truly the same story and
  returns their IDs, and attribution renders "Sources: A, B". Clustering only *proposes* — the
  model rejects bad merges, so an over-eager cluster can't conflate two stories. Genuine
  multi-source posts depend on ≥2 fetchable outlets covering the same event in the time window.

## Cover images (Pexels)

Legal, free cover images via the **Pexels API** (commercial-use license). Source-article
photos are copyrighted and never used. Needs `PEXELS_API_KEY` in the env; `sharp` and
`opentype.js` are dependencies on the server for image processing and text rendering (run
`bun install` on deploy). The overlay font (`scripts/news-agent/assets/Anton-Regular.ttf`,
OFL-licensed) is committed and must be present on the server.

`attach-covers.ts` runs in the cron right after drafting, so covers land before you review:

```bash
bun run scripts/news-agent/attach-covers.ts --local              # DRY RUN (shows picks)
bun run scripts/news-agent/attach-covers.ts --local --write --yes # attach (local)
bun run scripts/news-agent/attach-covers.ts --write --yes         # attach (PROD)
```

For each News post with no featured image, it: uses the drafter's concrete `coverQuery`
(a literal photographable phrase like "man lifting weights gym" — falls back to tags/title) →
picks a landscape Pexels photo → **downloads, resizes to ≤1200px, converts to WebP (q80)**,
names the file after the **article slug** (SEO), imports it as the **featured image** via
`wp media import` (WP regenerates WebP thumbnail sizes), sets **alt text to the article
title**, and appends a small *"Cover photo: Name / Pexels"* credit line. Marked
`_maleq_news_cover_done` so each post is attempted once (failed imports retry next run).

**Text overlay (social engagement):** before WebP conversion, a short punchy headline is
composited onto the cover to boost feed engagement. The text is the drafter's
`coverHeadline` — a scroll-stopping hook distinct from the article title (`_maleq_news_cover_headline`;
falls back to the title for posts drafted before this field existed). Two layouts are chosen
automatically by source aspect ratio: **landscape/square** → headline over a dark bottom
scrim; **vertical/portrait** → photo pushed flush-right with the headline in the empty left
column over a blurred copy of the photo. Text is drawn from the bundled Anton font as vector
outlines (via `opentype.js`) rather than through libvips/fontconfig, so it renders identically
on the dev Mac and the Linux cron. If the overlay step ever throws, it falls back to the plain
(text-free) cover so cover attachment is never blocked. Note Pexels is currently queried
`orientation=landscape`, so the vertical layout only triggers for non-landscape sources.

wp-cli location is configurable via `WP_CLI` / `WP_PATH`. **`WP_CLI` must be an absolute
path** (e.g. `/usr/bin/wp`) in the server `.env` — cron's minimal PATH doesn't resolve a
bare `wp`, which silently fails every cover import. (`attach-covers` is the only step that
shells out to wp-cli; drafting and sharing are pure SQL.) Stock photos are thematic, not the literal event —
the trade-off for legally publishable imagery.

## Editorial scope — news events only

**Rule: we report news EVENTS, never another publication's original creative work.**

A listicle, how-to, opinion column, review, interview, recap or photo gallery *is* the
outlet's product — its value is their selection, framing, access and voice, not an
underlying fact anyone can independently report. Rewriting one yields a derivative of
their work however much we reword it. A news event (a ruling, a law, a death, an arrest, a
casting announcement, an election result) is a fact in the world that any outlet may
report, and that is all we cover.

Enforced in two layers:

**1. Headline filter (`editorial-filter.ts`)** — runs on every item *before* clustering, so
a rejected piece costs no API call and can neither become a story's primary source nor be
cited as corroboration. Categories: `listicle`, `how-to / service piece`,
`opinion / essay`, `review`, `interview / profile`, `recurring column / feature`,
`shopping / promo`. Rejections are logged with the matched pattern.

Patterns match *formats*, not vocabulary — "review", "best" and bare leading numbers all
appear in real news ("Supreme Court to review…", "30 celebs join campaign", "Used Flock
Cameras Over 200 Times"). Two such false positives were caught during calibration and the
rules tightened: a leading count only counts as a listicle when followed by a listicle noun
("6 trans films"), and mid-headline counts only for the strongest nouns (`best`, `worst`,
`things`, `ways`, `reasons`…). On a live 116-item pool it rejects ~10 with no false
positives. Bypass with `--no-scope-filter`.

**2. The drafter (`draft.ts`)** — the EDITORIAL SCOPE section of the system prompt makes
the model set `publishable=false` with `skipReason "not a news event: <format>"`, judged on
the *article text* rather than the headline, since a newsy-sounding headline on an essay is
still an essay. It's told to skip when genuinely ambiguous: better to miss a story than
republish someone's work. The line it's given — reporting *that* a public figure said
something significant in an interview is an event; retelling the interview is not.

**Layer 2 runs BEFORE we spend anything (`vet.ts`).** The drafter's judgement is the
accurate one — it reads the body, and a newsy-sounding headline on an interview is still
an interview — but when it fired inside `draft.ts` we had already paid for a web-research
pass and a full Sonnet draft. So the same EDITORIAL SCOPE rules now run first as a
dedicated pass: **one cheap Haiku call per candidate over the full article text**, batched,
before research and drafting. A rejection costs ~$0.005 instead of ~$0.11.

`VET_SYSTEM` in `vet.ts` is a near-verbatim lift of draft.ts's EDITORIAL SCOPE section —
**change the two together.** If the vet pass is more permissive the drafter still rejects
(we just paid for it); if it is stricter we silently lose stories the drafter would have
written. It **fails open**: an unparseable verdict, a missing batch item or a dead batch
lets the story through to the drafter, which still checks. Bypass with `--no-vet`.

Vetting is fanned out — `NEWS_AGENT_VET_FANOUT` (default 3) candidates vetted per story
still needed — and survivors carry over between rounds, so nothing is fetched or vetted
twice.

**Layer 3 is the drafter's own check, and the run tops up instead of ending empty.**
`draft.ts` still sets `publishable=false` on closer reading. Because that used to end a
`--limit 1` run with nothing, **9 of the 14 runs between 2026-08-21 and 2026-08-24 produced
no drafts at all** (zero on 08-23 across four runs) — which is why nothing was reaching the
review queue. `run.ts` now drafts in **rounds**: after each round it draws more vetted
candidates until `--limit` drafts are in hand, `MAX_DRAFT_ROUNDS` (env
`NEWS_AGENT_MAX_ROUNDS`, default 3) is spent, or candidates run out.

**Rejects are remembered (`skipped.ts`).** Ranking is deterministic, so without this the
same rejected item sits at the top of the candidate list every run until it ages out of
the feed — "WATCH: Here The Whole Time" burned two consecutive runs that way. Rejected
source URLs (and headlines discarded as duplicates of an existing post) are written to
`scripts/news-agent/.state/skipped-stories.json` and filtered out of later runs for 14
days. The file is disposable and git-ignored; losing it costs one wasted draft. Override
its location with `NEWS_AGENT_STATE_DIR`, or ignore it for one run with
`--no-skip-memory`.

## Editorial / legal guardrails

- The drafter is instructed to **summarize in original words + brief commentary**, never
  reproduce source text, never invent facts/quotes, and to attribute + link the canonical
  source (appended deterministically in `draft.ts`, `rel="nofollow"`).
- Claude can mark a story `publishable=false` (off-topic, clickbait, unverifiable,
  unsuitable) — those are skipped with a logged reason.
- HTML is sanitized with `sanitize-html` before storage.
- **You** are the publish gate: drafts never go live automatically.

## Tuning the source list

Edit `SOURCES` in `config.ts` — currently **20 feeds**: the US queer press (PinkNews, The
Advocate, them., GLAAD, Washington Blade, Out, LGBTQ Nation, Queerty, Metro Weekly,
Autostraddle, Pride, Erin in the Morning), international (Gay Times, Attitude, DIVA, GCN,
Xtra, Mamba Online), the trans-specialist Assigned Media, and The Guardian's LGBT rights
section.

Run `--check-feeds` after editing. It now separates three states, which used to look
alike:

| | meaning |
|---|---|
| `✓ N fresh items (M parsed, newest Xh old)` | healthy |
| `✓ 0 fresh items (M parsed, newest Xh old)` | healthy but quiet — nothing inside the 36 h window |
| `⚠ returned 0 parseable items` | **dead** — endpoint gone, empty channel, or unreadable shape |

**Always verify a new feed from the VPS, not just your laptop.** Several outlets' WAFs
serve a 403 to Hetzner's datacenter IP while working fine from a home IP — this is why the
Los Angeles Blade, The 19th, Star Observer and Bay Area Reporter are all absent despite
having good feeds:

```bash
ssh hetzner 'curl -sSL -m 25 -o /tmp/f.xml -w "%{http_code}\n" \
  -A "Mozilla/5.0 (compatible; maleq-news-agent/1.0)" "<feed-url>"; grep -c "<item>" /tmp/f.xml'
```

More feeds do **not** mean more articles — at 1 drafted story/day the candidate pool is
already ~15× oversupplied. Extra sources earn their place by corroborating national
stories (multi-source clusters rank first) and covering angles the others miss.

## Dedupe

Two independent layers.

**1. Source URL (`dedupe.ts`)** — each draft stores its source URL in
`wp_postmeta._maleq_news_source_url` (and every cited URL in `_maleq_news_source_urls`).
Re-runs skip any story whose URL is already present, so the agent is safe to run
repeatedly. Unbounded in time, but only catches the *exact link*.

**2. Near-duplicate headline (`title-dedupe.ts`)** — catches what layer 1 misses: the same
event re-reported a day later by a different outlet, under a new URL and a reworded
headline. Every candidate headline is compared against the headlines of all news posts
modified in the last `RECENT_TITLE_HOURS` (**48 h**) — **drafts, pending and scheduled
posts included**, since a story waiting in the approval queue is still a reason not to
draft it again. Both our rewritten `post_title` and the stored original
`_maleq_news_source_title` are matched against.

Scoring is a **rarity-weighted Dice coefficient** over headline content tokens (same
stopword vocabulary as `cluster.ts`): `2·Σw(shared) / (Σw(a)+Σw(b))`, where each token's
weight is its IDF across a **30-day** window of headlines (`TITLE_STATS_HOURS`). The wider
stats window matters — 48 h of posts is far too little data to learn that `pride` is
generic and a surname is not. A match also requires ≥2 shared tokens, one of them ≥5
characters, so a story can't be blocked on a single shared topic word.

Calibrated 2026-08-18 against 30 days of real headlines: true repeats scored **≥0.43** (one
pair of *identical* published headlines scored 1.00), while genuinely separate instalments
of an ongoing saga sat **≤0.41** — hence `TITLE_DUPE_THRESHOLD = 0.42`. Unweighted overlap
was tried first and rejected: it flagged `PHOTOS: Rehoboth Beach Pride` against
`PHOTOS: Front Royal Pride` on `photos`+`pride` alone.

The guard runs **twice** per story:
- On the source headline **before drafting** — a blocked story costs no API spend, and it's
  filtered *before* the `--limit` slice, so it doesn't consume the run's one draft slot.
- On Claude's **rewritten title before publishing** — a rewrite can land on a recent story
  even when the source headline didn't, and two stories drafted in the same run can
  converge (each accepted title is added to the in-memory index).

```bash
--dupe-report      # print each candidate's closest recent-title match + score (calibration)
--no-title-dedupe  # bypass the guard entirely (e.g. deliberately re-drafting a story)
--no-vet           # skip the pre-research news-event pass (drafter still checks)
--no-skip-memory   # re-consider stories earlier runs rejected
```

## Scheduling — DEPLOYED on the prod WP VPS

The agent runs on the **Hetzner WP VPS** (`ssh hetzner`) as the `maleq-wp` user, on a
system cron, **4×/day at 9am / 12pm / 3pm / 6pm America/Los_Angeles** (1 story per run).

**Layout on the server** (`/home/maleq-wp/news-agent/`):
- The agent code (rsynced subset: `scripts/news-agent/`, `scripts/lib/db.ts`, `lib/db/local-runtime.ts`).
- `package.json` (only the 5 runtime deps) + `node_modules` (Bun at `~/.bun/bin/bun`).
- `.env` (chmod 600): API key + social creds + `REMOTE_MYSQL_PORT=3306` (connects to the
  local prod MySQL directly — no SSH tunnel; user/pass/db come from `db.ts` defaults).
  `MALEQ_WP_URL=https://wp.maleq.com`, `MALEQ_SITE_URL=https://maleq.com`.
- `cron-run.sh` — draft → attach cover images → notify reviewer (push) → share approved → `wp cache flush`; logs to `logs/run-*.log` (30-day retention).

**DST-safe timing.** This host's cron (Debian 3.0pl1) has no `CRON_TZ`, and the server is
UTC. So cron fires **hourly** (`0 * * * *`) and `cron-run.sh` gates on the local PT hour —
it runs only at 09/12/15/18 PT and silently no-ops otherwise. This auto-tracks PST↔PDT.
`NEWS_AGENT_LIMIT` defaults to **2**, so 4 runs/day = **8 drafts/day**. That is the
DRAFTING rate, not the publishing rate: drafts wait in the review queue, and
`maleq-news-review.php` releases approvals onto fixed slots (`9:00,12:00,15:00,18:00,21:00`
ET) — **one story per 3-hour window, 5/day**. Drafting above the slot count is deliberate:
it gives you a choice of stories per slot instead of a queue of whatever survived.

Override hours with `NEWS_AGENT_HOURS="09 12 15 18"`, draft count with `NEWS_AGENT_LIMIT`
(default `1` — one drafted story per run, 4/day).

**Manage it:**
```bash
ssh hetzner 'sudo -u maleq-wp crontab -l'                              # view schedule
ssh hetzner 'tail -40 "$(ls -t /home/maleq-wp/news-agent/logs/run-*.log | head -1)"'  # latest run log
# Manual run now (any hour), 2 drafts:
ssh hetzner 'sudo -u maleq-wp -H bash -lc "cd /home/maleq-wp/news-agent && NEWS_AGENT_HOURS=\$(TZ=America/Los_Angeles date +%H) NEWS_AGENT_LIMIT=2 ./cron-run.sh"'
```

**Updating the code on the server** — re-rsync the changed files from this repo, e.g.:
```bash
rsync -azR scripts/news-agent scripts/lib/db.ts lib/db/local-runtime.ts hetzner:/home/maleq-wp/news-agent/
ssh hetzner 'chown -R maleq-wp:maleq-wp /home/maleq-wp/news-agent'
```
(The server `.env` is not in the repo — edit it in place on the server when creds change.)

`cron-run.sh` is version-controlled at `scripts/news-agent/cron-run.sh`, but on the server it
lives at the app **root** (`/home/maleq-wp/news-agent/cron-run.sh`), not under `scripts/`. The
`-azR` command above would place it under `scripts/news-agent/`, so deploy it explicitly:
```bash
rsync -az scripts/news-agent/cron-run.sh hetzner:/home/maleq-wp/news-agent/cron-run.sh
```
(`maleq-news-autoshare.php` is also deployed separately — into the WP install's `wp-content/mu-plugins/`.)

## Mobile review (Phase 1.5 — LIVE)

Approve from your phone instead of WP admin. The `maleq-news-review.php` mu-plugin serves a
standalone mobile page at **`https://wp.maleq.com/news-review?k=<MALEQ_NEWS_REVIEW_KEY>`**
listing every pending draft — cover image, headline, source link, social hook, and the full
story — with three one-tap buttons per card:

- **✓ Publish** — approves the story into the **publish queue** (see below): it is scheduled
  onto the next slot its lane earns, and `maleq-news-autoshare.php` fires when the slot goes
  live (Bluesky + Mastodon), exactly as if you'd published in WP admin.
- **🗑 Delete** (tap twice to confirm) — force-deletes the cover attachment (image files
  gone, with the same "dedicated to this post only" safety checks as the cover picker) but
  only **trashes** the post: dedupe matches `_maleq_news_source_url` in postmeta with no
  status filter, so keeping the trashed row's meta stops the agent re-drafting the same
  story. WP purges trash after 30 days, far beyond the 36 h freshness window.
- **⏰ Later** — snoozes the card to the bottom of the queue (`_maleq_news_review_later`).

### Publish queue (fixed slots + two lanes)

Approving a story **never publishes it on the spot**. Stories go out only in fixed daily
slots — **9 AM, 12 PM, 3 PM, 6 PM, 9 PM Eastern**, five a day — and the queue decides which
story gets which slot.

Two lanes, so one review sitting can cover several days:

| Lane | What lands in it | Where it goes |
| --- | --- | --- |
| **Front (today's picks)** | the first `MALEQ_NEWS_FRONT_PICKS_PER_DAY` approvals of a calendar day (default **5** — one per slot) | the earliest free slots, *ahead of* anything already queued |
| **Long-term** | every later approval that day | the slots after all front picks |

So a session goes: approve the five you want out today (they take today's remaining slots,
then tomorrow morning's), then keep approving as many as you like — those become the backlog
that keeps the site publishing five a day on the days you never open the review app.

Every approval **re-packs the whole queue** (`maleq_nr_repack_queue()`): the ordered list is
front picks by approval time, then the long-term queue by approval time, and that order is
stamped onto the next available slots. That's what "front of the queue" means literally — a
fresh front pick takes the earliest slot and the backlog behind it shifts a slot later.

There is no custom queue table or scheduler: slotting uses **WordPress's own scheduling**.
Each queued story is `post_status = 'future'` with its slot as `post_date`; WP-Cron publishes
it, and autoshare hooks `transition_post_status` on `new === 'publish' && old !== 'publish'`,
which covers `future → publish` — so social sharing happens when the story actually goes
live, not when you approved it.

Notes:
- **All posts count.** A slot within 75 minutes of a post this plugin doesn't manage (anything
  hand-published or hand-scheduled in WP admin) is skipped — one feed, one cadence.
- **DST-safe.** Slots are built by setting the wall-clock time in `MALEQ_NEWS_PUBLISH_TZ`, so
  9 AM stays 9 AM across a clock change (the UTC stamp moves, not the slot).
- **Daily quota is derived, not counted in an option.** The lane comes from
  `_maleq_news_approved_at` stamps inside today's window, so trashing a story you approved by
  mistake hands the front-of-queue pick back.
- **Missed schedules self-heal.** `maleq_nr_catch_up()` publishes any queued story more than
  5 minutes past its slot (with autoshare). It runs on every review-page load, every action,
  and — the important one — on every `wp-cron.php` request (`DOING_CRON`), which the root
  crontab hits every 5 minutes. It rides that request rather than registering its own
  scheduled event because this site has *lost* `publish_future_post` events: at the Aug 2026
  rewrite two approved stories were sitting unpublished, one for a day and one for 15 days.
  A custom cron event would have been just as losable.
- Un-queueing from WP admin (trash, or `future` → `draft`) is fine: `trashed_post` re-packs so
  the rest of the queue moves earlier instead of publishing around a hole.
- **Stories queued under the old 30-minute-gap scheme are adopted automatically**
  (`maleq_nr_adopt_legacy_queue()`, on the first review-page load or action after deploy):
  they keep their order, join the long-term lane, and get re-slotted onto the fixed slots.
  Their approval stamps are backdated a day so they don't eat that day's front picks.
- Both review UIs show **Today's picks n/5** plus the slot times, and a **Queued** list
  (slot time + headline, soonest first) with long-term items tagged. Queued stories keep
  `_maleq_news_pending_review` until autoshare clears it post-share, so the list self-empties.
- `notify-review.ts` filters on `post_status = 'draft'`, so queued stories are never re-notified.
- Post meta: `_maleq_news_approved_at` (GMT unix ts) and `_maleq_news_queue_lane` (`1` front,
  `2` long-term). The `maleq_news_review_cadence` option mirrors the slot label + daily limit
  out to the maleq.com review page, which reads SQL and can't see wp-config.
- wp-config knobs: `MALEQ_NEWS_PUBLISH_SLOTS` (default `'9:00,12:00,15:00,18:00,21:00'`;
  `''` restores publish-immediately), `MALEQ_NEWS_PUBLISH_TZ` (default `'America/New_York'`),
  `MALEQ_NEWS_FRONT_PICKS_PER_DAY` (default `5`). The old
  `MALEQ_NEWS_MIN_PUBLISH_GAP_MINUTES` gap setting is gone — delete it from wp-config.

**Push notifications.** The page serves its own service worker (`/news-review-sw` —
extension-less so nginx routes it through WP instead of 404ing on a missing static file) and
web-app manifest, and a "🔔 Notify me" button subscribes the device using a **dedicated
VAPID keypair** (separate from the maleq.com push stack — subscriptions can only be created
from the token-authed page, so every subscriber is the owner). Subscriptions are stored as a
JSON string in the `maleq_news_review_push_subs` option. `notify-review.ts` runs in
`cron-run.sh` right after attach-covers and sends **one digest push per run** ("📰 N new
stories to review" → tap opens the review page) for drafts not yet carrying
`_maleq_news_review_notified`; drafts stay un-marked until at least one device receives the
push, so the first device subscribed gets the backlog. Expired subscriptions (410/404) are
pruned automatically.

**iPhone:** iOS only delivers web push to installed web apps — open the review URL in
Safari, Share → **Add to Home Screen**, then tap "🔔 Notify me" inside the installed app.
Android Chrome works directly in the browser.

**maleq.com mirror:** the same queue is available at **`maleq.com/account/news-review`**
when logged in as the WordPress administrator account — a "News Review" item appears in
the account sidebar (admin only; requires one fresh login after the feature shipped so
the session picks up the role). The Next.js API validates the session + role against
WordPress on every request and proxies actions to `/news-review-action` with
`MALEQ_NEWS_REVIEW_KEY` held server-side (Coolify env var), so Publish fires the
autoshare exactly like the wp.maleq.com page.

Config: wp-config constants `MALEQ_NEWS_REVIEW_KEY` (`openssl rand -hex 32`) and
`MALEQ_NEWS_REVIEW_VAPID_PUBLIC`; news-agent `.env` vars `NEWS_REVIEW_VAPID_PUBLIC`,
`NEWS_REVIEW_VAPID_PRIVATE` (`bunx web-push generate-vapid-keys`) and
`MALEQ_NEWS_REVIEW_URL` (the full keyed URL the notification opens). The `web-push` npm
package must be installed in the server app dir.

```bash
bun run scripts/news-agent/notify-review.ts --local              # DRY RUN
bun run scripts/news-agent/notify-review.ts --write --yes        # send (cron does this)
```

## Sharing approved posts (Phase 2)

Social adapters live in `scripts/news-agent/social/` (`bluesky.ts`, `mastodon.ts`; Meta is
deferred). `share.ts` fans out to whichever platforms have credentials in `.env.local`.

```bash
# Credential check (read-only, posts nothing)
bun run scripts/news-agent/share.ts --verify

# One-off public test post to all configured platforms
bun run scripts/news-agent/share.ts --test [--only bluesky,mastodon]
```

**Social copy — drafted hook + hashtags (one source of truth).** The drafter writes two
extra fields per story: `socialText` (a conversational one-sentence hook for the post BODY —
the headline is already in the link card, so it isn't repeated) and `hashtags` (3–5 discovery
tags). They're stored as `_maleq_news_social_text` and `_maleq_news_hashtags`. Both share
paths compose identically from these: hook + up to 4 clickable hashtags (Bluesky gets
richtext `#tag` facets; Mastodon/X/Threads get an auto-linked tag line) + the link. The PHP
plugin (`maleq_news_clean_hashtags`/`maleq_news_tag_facets`) and the TS adapters
(`social/types.ts` `cleanHashtags`/`buildTagFacets`) are deliberate mirrors — **change both
together.** Legacy posts without the fields fall back to the headline + no hashtags.

**Pinterest (credential-gated, off by default).** `social/pinterest.ts` composes a portrait
**pin** (1080×1350) on the fly from the post's Pexels cover with the `coverHeadline` overlaid
(`images.ts` `composePin`), and creates a pin linking to the clean `/guides/<slug>` article.
Pinterest is a visual search engine, so it's a strong evergreen-reach channel for the covers.
It activates when `PINTEREST_BOARD_ID` plus a token mode are set, and runs via the TS share
path (`share.ts`/`sync-shares.ts`), not the live PHP plugin. **Token modes:** preferred is
refresh-token (`PINTEREST_APP_ID` + `PINTEREST_APP_SECRET` + `PINTEREST_REFRESH_TOKEN`) — a
fresh access token is minted at run time, and Pinterest refresh tokens last ~1 year and don't
rotate by default, so it's set-and-forget (don't enable Pinterest "continuous refresh", whose
rotating tokens we don't persist). A static `PINTEREST_ACCESS_TOKEN` also works but expires in
weeks; refresh wins if both are set. **Policy/ban note:**
Pinterest restricts adult content — pins and their destination must stay clean editorial news
(never adult product imagery or product links), and you must claim `maleq.com` in Pinterest
settings. Untested against the live API until credentials are added — verify with
`share.ts --verify --only pinterest`.

**Tumblr (credential-gated, off by default).** `social/tumblr.ts` posts the cover + drafted
hook + a link block back to the `/guides/<slug>` article, with the hashtags as native Tumblr
tags. Tumblr's strong LGBTQ audience + reblog reach make it a good engagement channel. Auth is
OAuth 1.0a (consumer key/secret + token/token-secret from `tumblr.com/oauth/apps` — tokens
don't expire, no refresh logic). Activates only when `TUMBLR_CONSUMER_KEY` /
`TUMBLR_CONSUMER_SECRET` / `TUMBLR_TOKEN` / `TUMBLR_TOKEN_SECRET` / `TUMBLR_BLOG_IDENTIFIER` are
set, via the TS share path. Mature LGBTQ content is allowed but explicit imagery is banned — we
only post clean news. Untested against the live API until creds are added (`share.ts --verify
--only tumblr`). **Not** Reddit: Reddit ranks well + drives real traffic, but auto-posting gets
shadowbanned — it only works as genuine manual community participation, so it's deliberately
not an adapter.

**Approval → auto-share (event-driven, LIVE).** You approve a story by **publishing the
draft in WP admin**. The `maleq-news-autoshare.php` mu-plugin fires on the publish
transition and shares the post to Bluesky + Mastodon **within the same request** — no
script, schedule, or SSH tunnel needed. It fires only for `post`s in the `news` category
carrying the `_maleq_news_source_url` marker (so a hand-written guide/product never shares),
and uses the same `_maleq_news_share_urls` / `_maleq_news_shared_at` postmeta for
idempotency. Requires the `MALEQ_BLUESKY_*` / `MALEQ_MASTODON_*` wp-config constants
(see DEPLOYMENT_GUIDE.md → wp-config.php Constants); without them it safely no-ops.

**`sync-shares.ts` — manual fallback / retry.** The same logic as a CLI poll: finds
published-but-unshared News posts and shares each once. Use it to mop up a platform that
failed in the event-driven path, or to share a backlog. Per-platform safe — it only retries
platforms missing from `_maleq_news_share_urls` and never double-posts.

```bash
bun run scripts/news-agent/sync-shares.ts --local              # DRY RUN — show what would share
bun run scripts/news-agent/sync-shares.ts --local --write --yes # share approved local posts
bun run scripts/news-agent/sync-shares.ts --write --yes         # share approved PROD posts
```

- Shared posts link to your site at **`{MALEQ_SITE_URL}/guides/<slug>`** (default
  `https://maleq.com`), not the source — the source is credited inside the post body.
- **Idempotent + per-platform safe**: each post records `_maleq_news_share_urls` (a
  `platform→url` map); a re-run only retries platforms that failed and never double-posts.
  A post is marked `_maleq_news_shared_at` once every configured platform succeeded.
- `--write` posts publicly, so `--yes` is always required with it.

The end-to-end loop, hands-off except for your approval click:

```
run.ts (3×/day)  →  WP drafts  →  YOU publish the keepers  →  maleq-news-autoshare.php  →  Bluesky + Mastodon
   discover/draft     pending        (approval)                 (on-publish, instant)        link → maleq.com/guides/<slug>
```

Only `run.ts --write --yes` needs scheduling (drafting). Sharing is now event-driven on
publish — no share tick required. `sync-shares.ts` remains available for manual retries.

## Roadmap

- **Meta (Facebook → Instagram)** — `social/facebook.ts` then `social/instagram.ts`
  (IG needs the featured-image import below). Credentials gathering paused by request.
- ~~**Phase 1.5**~~ — **DONE.** One-tap mobile approval + push digest, shipped as the
  `maleq-news-review.php` mu-plugin + `notify-review.ts` (see Mobile review above).
- **Featured-image import** — download lead image → WP attachment → `_thumbnail_id`
  (required before Instagram, which can't post text-only).
- ~~**Event-driven sharing**~~ — **DONE.** Shipped as the `maleq-news-autoshare.php`
  mu-plugin (`transition_post_status` → share on `shutdown`, after `fastcgi_finish_request`).
  Self-contained PHP — no Next.js route or SSH tunnel; shares the instant you publish.
