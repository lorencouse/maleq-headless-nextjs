# LGBTQ News Agent

Automated LGBTQ news monitoring → original news drafts → (later) social sharing.

Lives in `scripts/news-agent/`. Phase 1 (this doc) covers discovery, drafting, and
publishing **as drafts** for human approval. Phases 2–3 add social sharing and a
one-tap approval loop.

## Pipeline

```
RSS feeds ──▶ discover.ts ──▶ dedupe.ts ──▶ draft.ts (Claude) ──▶ publish.ts ──▶ WP draft
(config.ts)   freshness +     skip already   original summary +    insert wp_posts   "LGBTQ+ News"
              cross-feed       posted (by      commentary, slug,    + meta + terms     category,
              de-dupe          source URL)     tags, SEO, HTML       (status=draft)    status=draft
```

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
| `extract.ts`  | Fetch the article page and pull paragraph text (feed summaries are often headline-only); falls back to feed content |
| `draft.ts`    | Claude `messages.parse` + Zod schema → 400–550-word piece with `<h2>` subheadings, synthesizing the clustered sources |
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

Flags: `--local`, `--write`, `--yes` (prod safety), `--check-feeds`, `--limit N`, `--model NAME`.

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

## Editorial / legal guardrails

- The drafter is instructed to **summarize in original words + brief commentary**, never
  reproduce source text, never invent facts/quotes, and to attribute + link the canonical
  source (appended deterministically in `draft.ts`, `rel="nofollow"`).
- Claude can mark a story `publishable=false` (off-topic, clickbait, unverifiable,
  unsuitable) — those are skipped with a logged reason.
- HTML is sanitized with `sanitize-html` before storage.
- **You** are the publish gate: drafts never go live automatically.

## Tuning the source list

Edit `SOURCES` in `config.ts`. Current defaults: PinkNews, The Advocate, them., GLAAD,
Washington Blade, Out. Run `--check-feeds` after editing — any feed that 404s or blocks
scrapers is reported and skipped (never fatal). Swap its URL for a working feed path.

## Dedupe

Each draft stores its source URL in `wp_postmeta._maleq_news_source_url`. Re-runs skip any
story whose URL is already present, so the agent is safe to run repeatedly (e.g. 3×/day).

## Scheduling — DEPLOYED on the prod WP VPS

The agent runs on the **Hetzner WP VPS** (`ssh hetzner`) as the `maleq-wp` user, on a
system cron, **3×/day at 7am / 12pm / 5pm America/Los_Angeles**.

**Layout on the server** (`/home/maleq-wp/news-agent/`):
- The agent code (rsynced subset: `scripts/news-agent/`, `scripts/lib/db.ts`, `lib/db/local-runtime.ts`).
- `package.json` (only the 5 runtime deps) + `node_modules` (Bun at `~/.bun/bin/bun`).
- `.env` (chmod 600): API key + social creds + `REMOTE_MYSQL_PORT=3306` (connects to the
  local prod MySQL directly — no SSH tunnel; user/pass/db come from `db.ts` defaults).
  `MALEQ_WP_URL=https://wp.maleq.com`, `MALEQ_SITE_URL=https://maleq.com`.
- `cron-run.sh` — draft → attach cover images → notify reviewer (push) → share approved → `wp cache flush`; logs to `logs/run-*.log` (30-day retention).

**DST-safe timing.** This host's cron (Debian 3.0pl1) has no `CRON_TZ`, and the server is
UTC. So cron fires **hourly** (`0 * * * *`) and `cron-run.sh` gates on the local PT hour —
it runs only at 07/12/17 PT and silently no-ops otherwise. This auto-tracks PST↔PDT.
Override hours with `NEWS_AGENT_HOURS="07 12 17"`, draft count with `NEWS_AGENT_LIMIT`.

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

- **✓ Publish** — publishes with the current timestamp; `maleq-news-autoshare.php` fires
  exactly as if you'd published in WP admin (Bluesky + Mastodon share on shutdown).
- **🗑 Delete** (tap twice to confirm) — force-deletes the cover attachment (image files
  gone, with the same "dedicated to this post only" safety checks as the cover picker) but
  only **trashes** the post: dedupe matches `_maleq_news_source_url` in postmeta with no
  status filter, so keeping the trashed row's meta stops the agent re-drafting the same
  story. WP purges trash after 30 days, far beyond the 36 h freshness window.
- **⏰ Later** — snoozes the card to the bottom of the queue (`_maleq_news_review_later`).

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
