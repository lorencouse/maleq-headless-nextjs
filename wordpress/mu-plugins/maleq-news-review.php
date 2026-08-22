<?php
/**
 * Plugin Name: Male Q News — Mobile Review
 * Description: Phone-friendly approval queue for machine-drafted News posts. Serves a
 * standalone page at /news-review?k=<secret> listing every pending draft (cover, headline,
 * full story) with one-tap Publish / Delete / Later buttons, plus its own service worker +
 * web-app manifest so the page can be installed to the home screen and receive web push
 * (sent by scripts/news-agent/notify-review.ts after each cron drafting run). Publishing
 * here fires the existing maleq-news-autoshare.php exactly like publishing in WP admin.
 * Version: 1.0
 *
 * Approving a story never publishes it instantly: stories go out only in FIXED DAILY SLOTS
 * (9am / 12pm / 3pm / 6pm / 9pm Eastern by default), five a day. Slotting uses WordPress's
 * own scheduling ('future' + post_date) — WP-Cron publishes each slot and autoshare fires on
 * the future→publish transition.
 *
 * Two lanes decide the order, so one review session can cover several days:
 *   - The first MALEQ_NEWS_FRONT_PICKS_PER_DAY approvals of a calendar day (default 5, one
 *     per slot) go to the FRONT of the queue — they take the earliest slots, displacing
 *     anything already queued behind them. These are "today's picks".
 *   - Every later approval that day joins the LONG-TERM queue, filling slots after the front
 *     picks. It keeps publishing five a day on days you never open the review app.
 * Every approval re-packs the whole queue (maleq_nr_repack_queue()), so front picks always
 * lead and the backlog drifts later rather than blocking them.
 *
 * wp-config constants:
 *   MALEQ_NEWS_REVIEW_KEY           — long random secret; the page/actions are 404/403 without it
 *   MALEQ_NEWS_REVIEW_VAPID_PUBLIC  — VAPID public key (pair with the private key in the
 *                                     news-agent .env; used by the browser to subscribe)
 *   MALEQ_NEWS_PUBLISH_SLOTS        — comma-separated local slot times; default
 *                                     '9:00,12:00,15:00,18:00,21:00'. Empty string =
 *                                     publish immediately on approval (no queue).
 *   MALEQ_NEWS_PUBLISH_TZ           — timezone the slots are expressed in (default
 *                                     'America/New_York'; the WP site timezone is UTC)
 *   MALEQ_NEWS_FRONT_PICKS_PER_DAY  — approvals per day that jump the long-term queue
 *                                     (default 5 — one per slot)
 */

if (!defined('ABSPATH')) {
    exit;
}

/** Option holding the review page's own push subscriptions (owner devices only). */
const MALEQ_NR_SUBS_OPTION = 'maleq_news_review_push_subs';
/**
 * Option (JSON string) publishing the cadence to the maleq.com review page, which reads
 * SQL directly and has no access to the wp-config constants: the slot label and the daily
 * front-pick limit. Kept as JSON, like the subs option, so the TS side can JSON.parse it.
 */
const MALEQ_NR_CADENCE_OPTION = 'maleq_news_review_cadence';
/** Meta flag: reviewer tapped "Later" (sorts to the bottom of the queue). */
const MALEQ_NR_LATER_META = '_maleq_news_review_later';
/** Max stored push subscriptions (owner devices) — hard cap, oldest evicted. */
const MALEQ_NR_MAX_SUBS = 10;
/** Default publish slots — local times in the slot timezone, five a day. */
const MALEQ_NR_DEFAULT_SLOTS = '9:00,12:00,15:00,18:00,21:00';
/** Slots are Eastern, stated explicitly: the WP site timezone itself is UTC. */
const MALEQ_NR_DEFAULT_SLOT_TZ = 'America/New_York';
/** Approvals per calendar day that jump the long-term queue (one per slot). */
const MALEQ_NR_DEFAULT_FRONT_PICKS = 5;
/** Meta: GMT unix timestamp of approval — orders each lane and counts the daily quota. */
const MALEQ_NR_APPROVED_META = '_maleq_news_approved_at';
/** Meta: which lane an approved story sits in (see the two constants below). */
const MALEQ_NR_LANE_META = '_maleq_news_queue_lane';
/** Today's picks: earliest slots, ahead of the backlog. */
const MALEQ_NR_LANE_FRONT = 1;
/** The backlog: slots after every front pick, so it keeps the site fed on unreviewed days. */
const MALEQ_NR_LANE_LONGTERM = 2;
/** A post we don't manage this close to a slot consumes it (about half the slot spacing). */
const MALEQ_NR_SLOT_BLOCK_MINUTES = 75;
/** Lookahead ceiling for slot generation — at 5 slots/day this is over a year of queue. */
const MALEQ_NR_MAX_LOOKAHEAD_DAYS = 400;
/** Hard cap on how many queued stories one repack will move. */
const MALEQ_NR_MAX_QUEUE = 500;
/** How many queued stories the UIs list before collapsing the rest into a count. */
const MALEQ_NR_QUEUE_PREVIEW = 10;

/** Timezone the publish slots are expressed in. */
function maleq_nr_slot_tz(): DateTimeZone {
    $tz = defined('MALEQ_NEWS_PUBLISH_TZ') ? (string) MALEQ_NEWS_PUBLISH_TZ : MALEQ_NR_DEFAULT_SLOT_TZ;
    try {
        return new DateTimeZone($tz);
    } catch (Exception $e) {
        return new DateTimeZone(MALEQ_NR_DEFAULT_SLOT_TZ);
    }
}

/**
 * The daily slots as ascending [hour, minute] pairs. An empty list is the escape hatch
 * (MALEQ_NEWS_PUBLISH_SLOTS = ''): no slots means approve = publish now.
 */
function maleq_nr_slot_times(): array {
    $raw = defined('MALEQ_NEWS_PUBLISH_SLOTS') ? (string) MALEQ_NEWS_PUBLISH_SLOTS : MALEQ_NR_DEFAULT_SLOTS;
    $out = [];
    foreach (explode(',', $raw) as $piece) {
        $piece = trim($piece);
        if ($piece === '') {
            continue;
        }
        [$h, $m] = array_pad(explode(':', $piece, 2), 2, '0');
        $h = (int) $h;
        $m = (int) $m;
        if ($h < 0 || $h > 23 || $m < 0 || $m > 59) {
            continue;
        }
        $out[$h * 60 + $m] = [$h, $m];   // keyed by minute-of-day: dedupes and sorts
    }
    ksort($out);
    return array_values($out);
}

/** How many approvals a day take the front lane. */
function maleq_nr_front_picks_per_day(): int {
    $n = defined('MALEQ_NEWS_FRONT_PICKS_PER_DAY')
        ? (int) MALEQ_NEWS_FRONT_PICKS_PER_DAY
        : MALEQ_NR_DEFAULT_FRONT_PICKS;
    return max(0, $n);
}

/** [start, end) GMT timestamps bracketing "today" in the slot timezone. */
function maleq_nr_today_range_gmt(?int $now = null): array {
    $start = (new DateTimeImmutable('@' . ($now ?? time())))
        ->setTimezone(maleq_nr_slot_tz())
        ->setTime(0, 0, 0);
    return [$start->getTimestamp(), $start->modify('+1 day')->getTimestamp()];
}

/**
 * Approvals made today (slot timezone). Counted from the approval stamps themselves rather
 * than a counter option: trashing a story you approved by mistake hands the pick back, and
 * nothing can drift out of sync with the posts that actually exist.
 */
function maleq_nr_approvals_today(?int $now = null): int {
    global $wpdb;
    [$start, $end] = maleq_nr_today_range_gmt($now);
    return (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM {$wpdb->postmeta} pm
           INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id
          WHERE pm.meta_key = %s
            AND CAST(pm.meta_value AS UNSIGNED) >= %d
            AND CAST(pm.meta_value AS UNSIGNED) < %d
            AND p.post_status IN ('publish', 'future')",
        MALEQ_NR_APPROVED_META,
        $start,
        $end
    ));
}

/**
 * GMT timestamps of posts that already hold a place in the feed and aren't ours to move
 * (hand-published or hand-scheduled in WP admin). A slot within
 * MALEQ_NR_SLOT_BLOCK_MINUTES of one of these is skipped — one feed, one cadence.
 */
function maleq_nr_occupied_times(int $from, array $ours): array {
    global $wpdb;
    $ids   = array_map('intval', $ours);
    $where = $ids ? ' AND ID NOT IN (' . implode(',', $ids) . ')' : '';
    $rows  = $wpdb->get_col($wpdb->prepare(
        "SELECT post_date_gmt FROM {$wpdb->posts}
          WHERE post_type = 'post' AND post_status IN ('publish', 'future')
            AND post_date_gmt >= %s" . $where . "
          ORDER BY post_date_gmt ASC LIMIT 500",
        gmdate('Y-m-d H:i:s', $from - MALEQ_NR_SLOT_BLOCK_MINUTES * 60)
    ));
    $out = [];
    foreach ($rows as $row) {
        $ts = strtotime($row . ' UTC');
        if ($ts) {
            $out[] = $ts;
        }
    }
    return $out;
}

/**
 * The next $count publish slots as GMT timestamps, at or after $from, skipping slots
 * already taken by a post outside $ours. DST-safe: each day's slot is built by setting the
 * wall-clock time in the slot timezone, so 9am stays 9am across a clock change.
 */
function maleq_nr_upcoming_slots(int $from, int $count, array $ours = []): array {
    $times = maleq_nr_slot_times();
    if ($count < 1 || !$times) {
        return [];
    }
    $day   = (new DateTimeImmutable('@' . $from))->setTimezone(maleq_nr_slot_tz())->setTime(0, 0, 0);
    $taken = maleq_nr_occupied_times($from, $ours);
    $slots = [];
    for ($d = 0; $d < MALEQ_NR_MAX_LOOKAHEAD_DAYS && count($slots) < $count; $d++) {
        foreach ($times as [$h, $m]) {
            $ts = $day->setTime($h, $m, 0)->getTimestamp();
            if ($ts < $from) {
                continue;
            }
            foreach ($taken as $t) {
                if (abs($t - $ts) < MALEQ_NR_SLOT_BLOCK_MINUTES * 60) {
                    continue 2;   // slot spoken for by a post we don't manage
                }
            }
            $slots[] = $ts;
            if (count($slots) >= $count) {
                break;
            }
        }
        $day = $day->modify('+1 day');
    }
    return $slots;
}

/**
 * Everything waiting for a slot, in publish order: front picks first (oldest approval
 * first), then the long-term queue. $extra_id folds the draft being approved right now into
 * the same ordering, so a single repack places it alongside the rest.
 */
function maleq_nr_queue_order(?int $extra_id = null): array {
    global $wpdb;
    $rows = $wpdb->get_results($wpdb->prepare(
        "SELECT p.ID,
                CAST(COALESCE(lane.meta_value, %d) AS UNSIGNED) AS lane,
                CAST(approved.meta_value AS UNSIGNED) AS approved_at
           FROM {$wpdb->posts} p
           INNER JOIN {$wpdb->postmeta} approved
                   ON approved.post_id = p.ID AND approved.meta_key = %s
           LEFT JOIN {$wpdb->postmeta} lane
                  ON lane.post_id = p.ID AND lane.meta_key = %s
          WHERE p.post_type = 'post' AND p.post_status = 'future'
          LIMIT " . MALEQ_NR_MAX_QUEUE,
        MALEQ_NR_LANE_LONGTERM,
        MALEQ_NR_APPROVED_META,
        MALEQ_NR_LANE_META
    ), ARRAY_A);

    $queue = [];
    foreach ($rows as $row) {
        $id = (int) $row['ID'];
        $queue[$id] = ['id' => $id, 'lane' => (int) $row['lane'], 'at' => (int) $row['approved_at']];
    }
    if ($extra_id) {
        $queue[$extra_id] = [
            'id'   => $extra_id,
            'lane' => (int) (get_post_meta($extra_id, MALEQ_NR_LANE_META, true) ?: MALEQ_NR_LANE_LONGTERM),
            'at'   => (int) (get_post_meta($extra_id, MALEQ_NR_APPROVED_META, true) ?: time()),
        ];
    }
    $queue = array_values($queue);
    usort($queue, function (array $a, array $b): int {
        return [$a['lane'], $a['at'], $a['id']] <=> [$b['lane'], $b['at'], $b['id']];
    });
    return $queue;
}

/**
 * Re-stamp every queued story onto the next available slots in queue order and return
 * [post_id => slot GMT timestamp]. Idempotent — a story already sitting on its slot is left
 * untouched — so running this on every approval is cheap.
 *
 * This is what makes the lanes work: a fresh front pick takes the earliest slot and the
 * long-term backlog behind it shifts later, instead of the new story waiting out a week of
 * backlog.
 */
function maleq_nr_repack_queue(?int $extra_id = null): array {
    $queue = maleq_nr_queue_order($extra_id);
    if (!$queue) {
        return [];
    }
    $now   = time();
    $slots = maleq_nr_upcoming_slots($now, count($queue), array_column($queue, 'id'));
    $map   = [];
    foreach ($queue as $i => $item) {
        if (!isset($slots[$i])) {
            break;   // out of lookahead: leave the tail of the queue where it is
        }
        $slot = $slots[$i];
        $post = get_post($item['id']);
        if (!$post || !in_array($post->post_status, ['draft', 'future'], true)) {
            continue;   // published (or gone) between the query and now — never move it
        }
        $map[$item['id']] = $slot;
        $target = gmdate('Y-m-d H:i:s', $slot);
        // A slot that is essentially now publishes outright; WP flips a 'future' post with a
        // past date to 'publish' anyway, so be explicit about which transition fires.
        $status = $slot <= $now + 30 ? 'publish' : 'future';
        if ($post->post_status === $status && $post->post_date_gmt === $target) {
            continue;
        }
        wp_update_post([
            'ID'            => $item['id'],
            'post_status'   => $status,
            'post_date'     => get_date_from_gmt($target),
            'post_date_gmt' => $target,
            'edit_date'     => true,
        ]);
    }
    return $map;
}

/**
 * Human list of the daily slots in the slot timezone, e.g. "9 AM, 12 PM, 3 PM, 6 PM, 9 PM
 * EDT". Rendered from today's date so the abbreviation follows DST.
 */
function maleq_nr_slots_label(): string {
    $times = maleq_nr_slot_times();
    if (!$times) {
        return 'immediately on approval';
    }
    $day   = (new DateTimeImmutable('now'))->setTimezone(maleq_nr_slot_tz());
    $parts = [];
    foreach ($times as [$h, $m]) {
        $parts[] = $day->setTime($h, $m, 0)->format($m === 0 ? 'g A' : 'g:i A');
    }
    return implode(', ', $parts) . ' ' . $day->format('T');
}

/**
 * Mirror the cadence into an option for the maleq.com review page. Called wherever this
 * plugin already computes the numbers, so the Next.js UI never has to restate wp-config.
 */
function maleq_nr_publish_cadence(int $used, int $limit): void {
    update_option(MALEQ_NR_CADENCE_OPTION, wp_json_encode([
        'limit'       => $limit,
        'used'        => $used,
        'slots_label' => maleq_nr_slots_label(),
        'updated'     => gmdate('c'),
    ]), false);
}

/** Lane as the wire/UI name. */
function maleq_nr_lane_name(int $lane): string {
    return $lane === MALEQ_NR_LANE_FRONT ? 'front' : 'longterm';
}

/**
 * The queue as the review UIs render it (slot time + headline + lane, soonest first).
 * Returned on every approval so both apps can redraw the whole list: a repack moves
 * stories other than the one just approved.
 */
function maleq_nr_queue_payload(array $map): array {
    $out = [];
    foreach ($map as $id => $ts) {
        if (get_post_status($id) !== 'future') {
            continue;   // went live in this same request
        }
        $out[] = [
            'id'         => (int) $id,
            'title'      => html_entity_decode(get_the_title($id), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
            'publish_at' => (int) $ts,
            'lane'       => maleq_nr_lane_name((int) get_post_meta($id, MALEQ_NR_LANE_META, true)),
        ];
    }
    usort($out, function (array $a, array $b): int {
        return $a['publish_at'] <=> $b['publish_at'];
    });
    return $out;
}

/**
 * Adopt stories that were queued before the fixed-slot rewrite — or scheduled by hand in WP
 * admin while carrying the review meta — so the repacker manages them instead of treating
 * them as immovable posts to schedule around. Their existing order is preserved and they
 * join the long-term lane, so a fresh front pick still goes out ahead of them.
 *
 * The approval stamps are backdated to yesterday on purpose: a stamp inside today's window
 * would eat today's front-of-queue picks. Idempotent — once stamped, a story is never
 * adopted again.
 */
function maleq_nr_adopt_legacy_queue(): void {
    global $wpdb;
    $rows = $wpdb->get_results($wpdb->prepare(
        "SELECT p.ID FROM {$wpdb->posts} p
           INNER JOIN {$wpdb->postmeta} pending
                   ON pending.post_id = p.ID AND pending.meta_key = '_maleq_news_pending_review'
                      AND pending.meta_value = '1'
           LEFT JOIN {$wpdb->postmeta} approved
                  ON approved.post_id = p.ID AND approved.meta_key = %s
          WHERE p.post_type = 'post' AND p.post_status = 'future' AND approved.meta_value IS NULL
          ORDER BY p.post_date_gmt ASC
          LIMIT " . MALEQ_NR_MAX_QUEUE,
        MALEQ_NR_APPROVED_META
    ));
    if (!$rows) {
        return;
    }
    $base = time() - DAY_IN_SECONDS;
    foreach ($rows as $i => $row) {
        update_post_meta((int) $row->ID, MALEQ_NR_APPROVED_META, (string) ($base + $i));
        update_post_meta((int) $row->ID, MALEQ_NR_LANE_META, (string) MALEQ_NR_LANE_LONGTERM);
    }
    maleq_nr_repack_queue();
}

/**
 * Publish any queued story whose slot has already passed. WP-Cron normally does this (a
 * system cron hits wp-cron.php every 5 minutes), but under fixed slots a missed schedule
 * costs hours rather than minutes, so opening the review app or taking any action sweeps up
 * stragglers too. wp_publish_post() fires transition_post_status, so autoshare still runs.
 */
function maleq_nr_catch_up(): void {
    global $wpdb;
    $ids = $wpdb->get_col($wpdb->prepare(
        "SELECT p.ID FROM {$wpdb->posts} p
           INNER JOIN {$wpdb->postmeta} approved
                   ON approved.post_id = p.ID AND approved.meta_key = %s
          WHERE p.post_type = 'post' AND p.post_status = 'future' AND p.post_date_gmt <= %s
          ORDER BY p.post_date_gmt ASC LIMIT 20",
        MALEQ_NR_APPROVED_META,
        gmdate('Y-m-d H:i:s', time() - 300)
    ));
    foreach ($ids as $id) {
        wp_publish_post((int) $id);
    }
}

/**
 * Ride every wp-cron.php request (a root cron hits it every 5 minutes) to sweep up missed
 * schedules and adopt anything newly queued outside this plugin.
 *
 * Deliberately NOT its own scheduled event: this site has lost `publish_future_post` events
 * before — two stories sat unpublished for a day and for two weeks — and a custom recurring
 * event would be just as losable. DOING_CRON keeps the queries off normal page loads.
 */
add_action('init', function () {
    if (defined('DOING_CRON') && DOING_CRON) {
        maleq_nr_catch_up();
        maleq_nr_adopt_legacy_queue();
    }
}, 20);

/**
 * Trashing a queued story leaves a hole in the cadence; close it up so the rest of the queue
 * moves earlier instead of publishing around a gap. (The review app's own Delete only ever
 * touches drafts, so this is for un-queueing from WP admin.)
 */
add_action('trashed_post', function ($post_id) {
    if (get_post_meta((int) $post_id, MALEQ_NR_APPROVED_META, true) === '') {
        return;
    }
    maleq_nr_repack_queue();
}, 10, 1);

/** True when the supplied key matches MALEQ_NEWS_REVIEW_KEY (constant-time). */
function maleq_nr_key_ok(?string $k): bool {
    if (!defined('MALEQ_NEWS_REVIEW_KEY') || !is_string($k) || $k === '') {
        return false;
    }
    return hash_equals((string) MALEQ_NEWS_REVIEW_KEY, $k);
}

/** Common headers: never cache, never index, never leak the keyed URL via referrer. */
function maleq_nr_headers(string $content_type): void {
    header('Content-Type: ' . $content_type);
    header('Cache-Control: no-store, max-age=0');
    header('Referrer-Policy: no-referrer');
    header('X-Robots-Tag: noindex, nofollow');
}

/* ───────────────────────────── Router ───────────────────────────── */

add_action('init', function () {
    $path = strtok((string) ($_SERVER['REQUEST_URI'] ?? ''), '?');
    switch (untrailingslashit($path)) {
        case '/news-review':
            maleq_nr_serve_page();
        case '/news-review-action':
            maleq_nr_serve_action();
        // Extension-less on purpose: nginx serves *.js paths as static files and would
        // 404 before WordPress ever sees the request. Content-Type makes it valid JS.
        case '/news-review-sw':
            maleq_nr_serve_sw();
        case '/news-review-manifest.json':
            maleq_nr_serve_manifest();
    }
    // Every maleq_nr_serve_* exits; any other path falls through to normal WP routing.
}, 0);

/* ─────────────────────────── Action endpoint ─────────────────────────── */

function maleq_nr_json(array $data, int $status = 200): void {
    maleq_nr_headers('application/json; charset=utf-8');
    http_response_code($status);
    echo wp_json_encode($data);
    exit;
}

/** A post the review app may operate on: a machine-drafted News post awaiting review. */
function maleq_nr_reviewable(int $id): ?WP_Post {
    $post = get_post($id);
    if (!$post || $post->post_type !== 'post' || $post->post_status !== 'draft') {
        return null;
    }
    if (get_post_meta($id, '_maleq_news_pending_review', true) !== '1') {
        return null;
    }
    return $post;
}

function maleq_nr_serve_action(): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        maleq_nr_json(['ok' => false, 'error' => 'POST only'], 405);
    }
    $body = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($body) || !maleq_nr_key_ok($body['k'] ?? null)) {
        maleq_nr_json(['ok' => false, 'error' => 'forbidden'], 403);
    }
    maleq_nr_catch_up();
    maleq_nr_adopt_legacy_queue();
    $action = (string) ($body['action'] ?? '');
    switch ($action) {
        case 'publish':     maleq_nr_action_publish((int) ($body['post_id'] ?? 0));
        case 'delete':      maleq_nr_action_delete((int) ($body['post_id'] ?? 0));
        case 'later':       maleq_nr_action_later((int) ($body['post_id'] ?? 0));
        case 'subscribe':   maleq_nr_action_subscribe($body['subscription'] ?? null);
        case 'unsubscribe': maleq_nr_action_unsubscribe((string) ($body['endpoint'] ?? ''));
    }
    maleq_nr_json(['ok' => false, 'error' => 'unknown action'], 400);
}

/**
 * Approve: drop the story into the publish queue (see the lane rules in the file header).
 *
 * The first MALEQ_NEWS_FRONT_PICKS_PER_DAY approvals of a day take the front lane and the
 * earliest slots; later approvals join the long-term queue behind them. Either way the whole
 * queue is re-packed onto the fixed daily slots, so this response reports both the slot this
 * story landed on and the queue as it now stands.
 *
 * Slots are always stamped explicitly — the draft's creation date would otherwise back-date
 * the story. When a slot is essentially now the post publishes outright and
 * maleq-news-autoshare.php shares on shutdown, after this response has reached the phone;
 * otherwise the post goes to 'future' and WP-Cron publishes it at its slot, where autoshare
 * hooks the future->publish transition just the same.
 */
function maleq_nr_action_publish(int $id): void {
    $post = maleq_nr_reviewable($id);
    if (!$post) {
        maleq_nr_json(['ok' => false, 'error' => 'not a pending news draft'], 404);
    }

    $now   = time();
    $limit = maleq_nr_front_picks_per_day();
    $used  = maleq_nr_approvals_today($now);
    $lane  = $used < $limit ? MALEQ_NR_LANE_FRONT : MALEQ_NR_LANE_LONGTERM;

    // Stamped before the repack: maleq_nr_queue_order() reads both to place this story.
    update_post_meta($id, MALEQ_NR_APPROVED_META, (string) $now);
    update_post_meta($id, MALEQ_NR_LANE_META, (string) $lane);
    delete_post_meta($id, MALEQ_NR_LATER_META);

    // Escape hatch (MALEQ_NEWS_PUBLISH_SLOTS = ''): no slots means publish on approval.
    if (!maleq_nr_slot_times()) {
        $res = wp_update_post([
            'ID'            => $id,
            'post_status'   => 'publish',
            'post_date'     => get_date_from_gmt(gmdate('Y-m-d H:i:s', $now)),
            'post_date_gmt' => gmdate('Y-m-d H:i:s', $now),
            'edit_date'     => true,
        ], true);
        if (is_wp_error($res)) {
            maleq_nr_json(['ok' => false, 'error' => $res->get_error_message()], 500);
        }
        maleq_nr_publish_cadence(min($limit, $used + 1), $limit);
        maleq_nr_json([
            'ok'          => true,
            'url'         => maleq_nr_public_url($post->post_name),
            'scheduled'   => false,
            'publish_at'  => $now,
            'lane'        => maleq_nr_lane_name($lane),
            'front_used'  => min($limit, $used + 1),
            'front_limit' => $limit,
            'queue'       => [],
        ]);
    }

    $map  = maleq_nr_repack_queue($id);
    $slot = $map[$id] ?? null;
    if ($slot === null) {
        // No slot inside the lookahead window: leave the draft as a draft rather than
        // silently swallowing the approval, and hand the daily pick back.
        delete_post_meta($id, MALEQ_NR_APPROVED_META);
        delete_post_meta($id, MALEQ_NR_LANE_META);
        maleq_nr_json(['ok' => false, 'error' => 'no publish slot available'], 500);
    }

    maleq_nr_publish_cadence(min($limit, $used + 1), $limit);
    maleq_nr_json([
        'ok'        => true,
        'url'       => maleq_nr_public_url($post->post_name),
        'scheduled' => get_post_status($id) === 'future',
        // GMT unix timestamp — clients format it in the viewer's own timezone.
        // Deliberately not a pre-formatted label: the site timezone is UTC, so a
        // server-rendered time would read an hours-off clock on the owner's phone.
        'publish_at'  => $slot,
        'lane'        => maleq_nr_lane_name($lane),
        'front_used'  => min($limit, $used + 1),
        'front_limit' => $limit,
        // The repack moves other stories too, so ship the whole queue for a redraw.
        'queue'       => maleq_nr_queue_payload($map),
    ]);
}

/** Slot label in site time — server-render fallback only; clients relabel in local time. */
function maleq_nr_slot_label(int $ts): string {
    $sameDay = wp_date('Y-m-d', $ts) === wp_date('Y-m-d');
    return $sameDay ? wp_date('g:i A', $ts) : wp_date('D g:i A', $ts);
}

/**
 * Reject: force-delete the cover attachment (image files gone) but only TRASH the post.
 * Hard-deleting the post would erase its _maleq_news_source_url meta, and the agent's
 * dedupe matches on that meta alone — the same story would be re-drafted next run.
 * Trash keeps the meta (dedupe holds) and WP purges it automatically after 30 days,
 * far beyond the agent's 36-hour freshness window.
 */
function maleq_nr_action_delete(int $id): void {
    $post = maleq_nr_reviewable($id);
    if (!$post) {
        maleq_nr_json(['ok' => false, 'error' => 'not a pending news draft'], 404);
    }
    $cover_deleted = false;
    $thumb = (int) get_post_thumbnail_id($id);
    if ($thumb > 0) {
        $att = get_post($thumb);
        // Same safety net as the cover-picker: only delete a cover dedicated to THIS post.
        $dedicated = $att && $att->post_type === 'attachment' && (int) $att->post_parent === $id;
        global $wpdb;
        $used_elsewhere = $dedicated ? (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE meta_key = '_thumbnail_id' AND meta_value = %d AND post_id <> %d",
            $thumb, $id
        )) : 0;
        if ($dedicated && $used_elsewhere === 0) {
            $cover_deleted = (bool) wp_delete_attachment($thumb, true);
        }
    }
    if (!wp_trash_post($id)) {
        maleq_nr_json(['ok' => false, 'error' => 'could not trash post', 'cover_deleted' => $cover_deleted], 500);
    }
    maleq_nr_json(['ok' => true, 'cover_deleted' => $cover_deleted]);
}

/** Snooze: keep the draft but sort it to the bottom of the queue. */
function maleq_nr_action_later(int $id): void {
    if (!maleq_nr_reviewable($id)) {
        maleq_nr_json(['ok' => false, 'error' => 'not a pending news draft'], 404);
    }
    update_post_meta($id, MALEQ_NR_LATER_META, (string) time());
    maleq_nr_json(['ok' => true]);
}

/**
 * Subscriptions are stored as a JSON STRING (not a PHP array) so the TS sender
 * (scripts/news-agent/notify-review.ts) can read wp_options with a plain
 * JSON.parse instead of a PHP-unserializer. Keep both sides in sync.
 */
function maleq_nr_get_subs(): array {
    $raw  = get_option(MALEQ_NR_SUBS_OPTION, '');
    $subs = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
    return is_array($subs) ? $subs : [];
}

function maleq_nr_save_subs(array $subs): void {
    update_option(MALEQ_NR_SUBS_OPTION, wp_json_encode($subs), false);
}

/** Store this device's PushSubscription (endpoint + keys) for notify-review.ts. */
function maleq_nr_action_subscribe($sub): void {
    $endpoint = is_array($sub) ? (string) ($sub['endpoint'] ?? '') : '';
    $p256dh   = is_array($sub) ? (string) ($sub['keys']['p256dh'] ?? '') : '';
    $auth     = is_array($sub) ? (string) ($sub['keys']['auth'] ?? '') : '';
    if (!preg_match('#^https://#', $endpoint) || $p256dh === '' || $auth === '') {
        maleq_nr_json(['ok' => false, 'error' => 'invalid subscription'], 400);
    }
    $subs = maleq_nr_get_subs();
    $subs[md5($endpoint)] = [
        'endpoint' => $endpoint,
        'p256dh'   => $p256dh,
        'auth'     => $auth,
        'added'    => gmdate('c'),
        'ua'       => substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 120),
    ];
    if (count($subs) > MALEQ_NR_MAX_SUBS) {
        $subs = array_slice($subs, -MALEQ_NR_MAX_SUBS, null, true);
    }
    maleq_nr_save_subs($subs);
    maleq_nr_json(['ok' => true, 'devices' => count($subs)]);
}

function maleq_nr_action_unsubscribe(string $endpoint): void {
    $subs = maleq_nr_get_subs();
    unset($subs[md5($endpoint)]);
    maleq_nr_save_subs($subs);
    maleq_nr_json(['ok' => true]);
}

/* ─────────────────────── Service worker + manifest ─────────────────────── */

/**
 * Tiny SW: show incoming pushes, open the review page on tap. Served from the site
 * root so its scope covers /news-review. Contains no secrets (the keyed URL travels
 * inside the encrypted push payload).
 */
function maleq_nr_serve_sw(): void {
    maleq_nr_headers('application/javascript; charset=utf-8');
    ?>
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.title || 'Male Q News Review', {
    body: d.body || 'New stories are ready to review.',
    icon: d.icon || 'https://maleq.com/favicon/android/android-launchericon-192-192.png',
    badge: d.badge || 'https://maleq.com/favicon/favicon-32x32.png',
    tag: d.tag || 'news-review',
    data: { url: d.url || '/news-review' }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/news-review';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf('/news-review') !== -1 && 'focus' in list[i]) { return list[i].focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
    <?php
    exit;
}

/** Web-app manifest (keyed: its start_url embeds the secret). Enables Add to Home Screen. */
function maleq_nr_serve_manifest(): void {
    if (!maleq_nr_key_ok($_GET['k'] ?? null)) {
        status_header(404);
        exit;
    }
    maleq_nr_headers('application/manifest+json; charset=utf-8');
    echo wp_json_encode([
        'name'             => 'MQ News Review',
        'short_name'       => 'MQ Review',
        'start_url'        => '/news-review?k=' . rawurlencode((string) $_GET['k']),
        'display'          => 'standalone',
        'background_color' => '#111114',
        'theme_color'      => '#111114',
        'icons'            => [
            ['src' => 'https://maleq.com/favicon/android/android-launchericon-192-192.png', 'sizes' => '192x192', 'type' => 'image/png'],
            ['src' => 'https://maleq.com/favicon/android/android-launchericon-512-512.png', 'sizes' => '512x512', 'type' => 'image/png'],
        ],
    ]);
    exit;
}

/* ───────────────────────────── Review page ───────────────────────────── */

/** Public URL a story will live at once published (mirrors config.ts postUrl()). */
function maleq_nr_public_url(string $slug): string {
    $base = defined('MALEQ_SITE_URL') ? MALEQ_SITE_URL : 'https://maleq.com';
    return untrailingslashit($base) . '/guides/' . $slug;
}

function maleq_nr_serve_page(): void {
    if (!maleq_nr_key_ok($_GET['k'] ?? null)) {
        status_header(404);
        nocache_headers();
        exit;
    }
    $key = (string) $_GET['k'];
    maleq_nr_catch_up();
    maleq_nr_adopt_legacy_queue();

    $posts = get_posts([
        'post_type'      => 'post',
        'post_status'    => 'draft',
        'posts_per_page' => 50,
        'orderby'        => 'date',
        'order'          => 'DESC',
        'meta_query'     => [
            ['key' => '_maleq_news_pending_review', 'value' => '1'],
        ],
    ]);
    // Approved-but-not-yet-live stories, soonest first. They keep the pending-review
    // meta until autoshare deletes it post-share, so this list self-clears.
    $queued = get_posts([
        'post_type'      => 'post',
        'post_status'    => 'future',
        'posts_per_page' => 200,   // the long-term queue is meant to run days deep
        'orderby'        => 'date',
        'order'          => 'ASC',
        'meta_query'     => [
            ['key' => '_maleq_news_pending_review', 'value' => '1'],
        ],
    ]);

    $front_limit = maleq_nr_front_picks_per_day();
    $front_used  = min($front_limit, maleq_nr_approvals_today());
    maleq_nr_publish_cadence($front_used, $front_limit);

    // "Later"-flagged drafts sink to the bottom (oldest snooze last).
    usort($posts, function ($a, $b) {
        $la = (int) get_post_meta($a->ID, MALEQ_NR_LATER_META, true);
        $lb = (int) get_post_meta($b->ID, MALEQ_NR_LATER_META, true);
        if (($la > 0) !== ($lb > 0)) {
            return $la > 0 ? 1 : -1;
        }
        return strcmp($b->post_date, $a->post_date);
    });

    $vapid = defined('MALEQ_NEWS_REVIEW_VAPID_PUBLIC') ? (string) MALEQ_NEWS_REVIEW_VAPID_PUBLIC : '';

    maleq_nr_headers('text/html; charset=utf-8');
    ?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#111114">
<link rel="manifest" href="/news-review-manifest.json?k=<?php echo esc_attr(rawurlencode($key)); ?>">
<link rel="apple-touch-icon" href="https://maleq.com/favicon/android/android-launchericon-192-192.png">
<title>News Review (<?php echo count($posts); ?>)</title>
<style>
  :root {
    --bg: #f4f4f6; --card: #ffffff; --text: #17171c; --muted: #6b6b76;
    --line: #e3e3e8; --green: #1a8f3c; --red: #c92a2a; --amber: #b07d10;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #111114; --card: #1c1c21; --text: #ececf1; --muted: #9a9aa5;
      --line: #2c2c33; --green: #2fbf5a; --red: #ff6b6b; --amber: #e6b34a;
    }
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--bg); color: var(--text);
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: env(safe-area-inset-top) 0 32px;
  }
  header {
    position: sticky; top: 0; z-index: 5; background: var(--bg);
    padding: 14px 16px 10px; display: flex; align-items: center; gap: 10px;
    border-bottom: 1px solid var(--line);
  }
  header h1 { font-size: 18px; flex: 1; }
  header .count { color: var(--muted); font-weight: 400; }
  #push-btn {
    border: 1px solid var(--line); background: var(--card); color: var(--text);
    border-radius: 20px; padding: 6px 12px; font-size: 13px; cursor: pointer;
  }
  #push-btn.on { border-color: var(--green); color: var(--green); }
  main { max-width: 680px; margin: 0 auto; padding: 12px; }
  .empty { text-align: center; color: var(--muted); padding: 60px 20px; font-size: 17px; }
  article {
    background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    margin-bottom: 16px; overflow: hidden; transition: opacity .25s, transform .25s;
  }
  article.gone { opacity: 0; transform: translateX(40px); }
  article.snoozed { opacity: .75; }
  .cover { display: block; width: 100%; height: auto; background: var(--line); }
  .pad { padding: 14px 16px; }
  .meta { color: var(--muted); font-size: 13px; margin-bottom: 6px; }
  .meta a { color: var(--muted); }
  h2.title { font-size: 19px; line-height: 1.3; margin-bottom: 8px; }
  .hook { font-size: 14px; color: var(--muted); font-style: italic; margin-bottom: 10px; }
  .body-wrap { position: relative; max-height: 130px; overflow: hidden; }
  .body-wrap.open { max-height: none; }
  .body-wrap:not(.open)::after {
    content: ""; position: absolute; inset: auto 0 0 0; height: 60px;
    background: linear-gradient(transparent, var(--card));
  }
  .story { font-size: 15px; }
  .story h2 { font-size: 16px; margin: 14px 0 6px; }
  .story p { margin: 0 0 10px; }
  .story img { max-width: 100%; height: auto; }
  .story a { color: inherit; }
  .more {
    background: none; border: none; color: var(--muted); font-size: 14px;
    padding: 8px 0 0; cursor: pointer; text-decoration: underline;
  }
  .actions {
    display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;
    padding: 12px 16px 16px;
  }
  .actions button {
    border: none; border-radius: 10px; padding: 13px 6px; font-size: 15px;
    font-weight: 600; cursor: pointer; color: #fff; transition: filter .15s;
  }
  .actions button:active { filter: brightness(.85); }
  .actions button:disabled { opacity: .5; }
  .b-pub { background: var(--green); }
  .b-del { background: var(--red); }
  .b-del.confirm { outline: 3px solid var(--red); outline-offset: 2px; }
  .b-lat { background: var(--amber); }
  .status { padding: 0 16px 12px; font-size: 13px; color: var(--muted); min-height: 1em; }
  .note { color: var(--muted); font-size: 13px; text-align: center; padding: 8px 16px 0; }
  .queued { margin: 0 0 16px; padding: 12px 16px; border-radius: 12px;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); }
  .queued h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: .04em; }
  .queued ol { margin: 0; padding-left: 18px; }
  .queued li { font-size: 14px; line-height: 1.45; margin-bottom: 6px; }
  .queued time { color: var(--muted); font-variant-numeric: tabular-nums; }
  .queued .more-queued { color: var(--muted); list-style: none; margin-left: -18px; }
  .queued .lane { font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--muted); border: 1px solid var(--line); border-radius: 6px;
    padding: 1px 5px; margin-left: 6px; white-space: nowrap; }
  .queued li.front .lane { color: var(--green); border-color: var(--green); }
  .picks { margin: 0 0 16px; font-size: 13px; line-height: 1.5; color: var(--muted); }
  .picks b { color: var(--text); font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<header>
  <h1>News Review <span class="count" id="count">(<?php echo count($posts); ?>)</span></h1>
  <button id="push-btn" type="button">🔔 Notify me</button>
</header>
<main id="list">
<p class="picks">
  <?php // #picks-line is rewritten client-side after each approval — keep setPicks() in sync. ?>
  <span id="picks-line">Today's picks
    <b><?php echo (int) $front_used; ?>/<?php echo (int) $front_limit; ?></b><?php
      if ($front_used < $front_limit) :
        $left = $front_limit - $front_used; ?>
      · the next <?php echo (int) $left; ?> approval<?php echo $left === 1 ? '' : 's'; ?> jump<?php
        echo $left === 1 ? 's' : ''; ?> to the front of the queue.<?php
      else : ?>
      · further approvals join the long-term queue.<?php
      endif; ?>
  </span>
  <br>Publishing at <?php echo esc_html(maleq_nr_slots_label()); ?>.
</p>
<?php if ($queued) : ?>
  <section class="queued">
    <h2>Queued · <?php echo count($queued); ?> waiting to go live</h2>
    <ol>
      <?php // Only the head of the queue: the backlog can run weeks deep on a phone screen.
      foreach (array_slice($queued, 0, MALEQ_NR_QUEUE_PREVIEW) as $q) :
          $slotTs = (int) get_post_time('U', true, $q);
          $lane   = maleq_nr_lane_name((int) get_post_meta($q->ID, MALEQ_NR_LANE_META, true)); ?>
        <li class="<?php echo esc_attr($lane); ?>">
          <?php // Server text is site-time (UTC here); the inline JS relabels it in the
                // phone's timezone on load, so the owner reads their own clock. ?>
          <time datetime="<?php echo esc_attr(gmdate('c', $slotTs)); ?>"><?php
            echo esc_html(maleq_nr_slot_label($slotTs)); ?></time>
          — <?php echo esc_html(html_entity_decode(get_the_title($q), ENT_QUOTES | ENT_HTML5, 'UTF-8')); ?>
          <?php if ($lane === 'longterm') : ?><span class="lane">long-term</span><?php endif; ?>
        </li>
      <?php endforeach; ?>
      <?php if (count($queued) > MALEQ_NR_QUEUE_PREVIEW) : ?>
        <li class="more-queued">+<?php echo count($queued) - MALEQ_NR_QUEUE_PREVIEW; ?> more further down the queue</li>
      <?php endif; ?>
    </ol>
  </section>
<?php endif; ?>
<?php if (!$posts) : ?>
  <p class="empty">All caught up 🎉<br>No drafts waiting for review.</p>
<?php endif; ?>
<?php foreach ($posts as $p) :
    $cover  = get_the_post_thumbnail_url($p->ID, 'large');
    $source = (string) get_post_meta($p->ID, '_maleq_news_source_name', true);
    $srcUrl = (string) get_post_meta($p->ID, '_maleq_news_source_url', true);
    $hook   = (string) get_post_meta($p->ID, '_maleq_news_social_text', true);
    $later  = (string) get_post_meta($p->ID, MALEQ_NR_LATER_META, true);
    $when   = human_time_diff(get_post_time('U', true, $p), time()) . ' ago';
?>
  <article id="post-<?php echo (int) $p->ID; ?>" data-id="<?php echo (int) $p->ID; ?>" class="<?php echo $later ? 'snoozed' : ''; ?>">
    <?php if ($cover) : ?><img class="cover" src="<?php echo esc_url($cover); ?>" alt="" loading="lazy"><?php endif; ?>
    <div class="pad">
      <p class="meta">
        <?php echo esc_html($when); ?><?php if ($source) : ?> ·
          <?php if ($srcUrl) : ?><a href="<?php echo esc_url($srcUrl); ?>" target="_blank" rel="noopener nofollow"><?php echo esc_html($source); ?> ↗</a>
          <?php else : ?><?php echo esc_html($source); ?><?php endif; ?>
        <?php endif; ?>
        <?php if ($later) : ?> · ⏰ snoozed<?php endif; ?>
      </p>
      <h2 class="title"><?php echo esc_html(html_entity_decode(get_the_title($p), ENT_QUOTES | ENT_HTML5, 'UTF-8')); ?></h2>
      <?php if ($hook) : ?><p class="hook">“<?php echo esc_html($hook); ?>”</p><?php endif; ?>
      <div class="body-wrap"><div class="story"><?php echo wp_kses_post($p->post_content); ?></div></div>
      <button class="more" type="button">Read full story ▾</button>
    </div>
    <div class="actions">
      <button class="b-pub" type="button">✓ Publish</button>
      <button class="b-lat" type="button">⏰ Later</button>
      <button class="b-del" type="button">🗑 Delete</button>
    </div>
    <p class="status"></p>
  </article>
<?php endforeach; ?>
</main>
<p class="note">
<?php if (maleq_nr_gap_minutes() > 0) : ?>
  Approved stories go live at least <?php echo (int) maleq_nr_gap_minutes(); ?> minutes apart —
  the first goes out now, the rest queue up. Social sharing happens as each one publishes.<br>
<?php else : ?>
  Publishing shares to social automatically.<br>
<?php endif; ?>
Delete removes the story + cover image.<br>
On iPhone: Add to Home Screen first, then enable notifications from the installed app.</p>
<script>
(function () {
  var KEY = <?php echo wp_json_encode($key); ?>;
  var VAPID = <?php echo wp_json_encode($vapid); ?>;

  function api(action, data) {
    data = data || {};
    data.action = action;
    data.k = KEY;
    return fetch('/news-review-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) { return r.json(); });
  }

  function updateCount(delta) {
    var el = document.getElementById('count');
    var n = Math.max(0, (parseInt(el.textContent.replace(/\D/g, ''), 10) || 0) + delta);
    el.textContent = '(' + n + ')';
    if (n === 0 && !document.querySelector('article:not(.gone)')) {
      // Append rather than replace innerHTML — the queued list lives in #list too.
      if (!document.querySelector('.empty')) {
        var p = document.createElement('p');
        p.className = 'empty';
        p.innerHTML = 'All caught up 🎉<br>No drafts waiting for review.';
        document.getElementById('list').appendChild(p);
      }
    }
  }

  function removeCard(card) {
    card.classList.add('gone');
    setTimeout(function () { card.remove(); updateCount(-1); }, 280);
  }

  /** Slot time in the PHONE's timezone: "3:30 PM" today, "Tue 3:30 PM" beyond. */
  function fmtSlot(date) {
    var time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (date.toDateString() === new Date().toDateString()) { return time; }
    return date.toLocaleDateString([], { weekday: 'short' }) + ' ' + time;
  }

  // Relabel the server-rendered queue (site time, i.e. UTC) into local time.
  document.querySelectorAll('.queued time[datetime]').forEach(function (t) {
    var d = new Date(t.getAttribute('datetime'));
    if (!isNaN(d.getTime())) { t.textContent = fmtSlot(d); }
  });

  /** Front-of-queue picks used today (mirrors the server-rendered #picks-line text). */
  function setPicks(used, limit) {
    var el = document.getElementById('picks-line');
    if (!el || typeof used !== 'number' || typeof limit !== 'number') { return; }
    var left = Math.max(0, limit - used);
    var tail = left > 0
      ? ' · the next ' + left + ' approval' + (left === 1 ? ' jumps' : 's jump') + ' to the front of the queue.'
      : ' · further approvals join the long-term queue.';
    el.textContent = "Today's picks ";
    var b = document.createElement('b');
    b.textContent = used + '/' + limit;
    el.appendChild(b);
    el.appendChild(document.createTextNode(tail));
  }

  /**
   * Redraw the whole Queued list from the server's post-repack queue. Approving a story
   * re-orders the others (front-of-queue picks displace the long-term backlog), so the
   * list is replaced rather than appended to.
   */
  function renderQueue(queue) {
    var list = document.getElementById('list');
    var section = document.querySelector('.queued');
    if (!queue || !queue.length) {
      if (section) { section.remove(); }
      return;
    }
    if (!section) {
      section = document.createElement('section');
      section.className = 'queued';
      section.innerHTML = '<h2></h2><ol></ol>';
      list.insertBefore(section, document.querySelector('.picks').nextSibling);
    }
    section.querySelector('h2').textContent = 'Queued · ' + queue.length + ' waiting to go live';
    var ol = section.querySelector('ol');
    ol.textContent = '';
    var preview = <?php echo (int) MALEQ_NR_QUEUE_PREVIEW; ?>;
    queue.slice(0, preview).forEach(function (q) {
      var at = new Date(q.publish_at * 1000);
      var li = document.createElement('li');
      li.className = q.lane === 'front' ? 'front' : 'longterm';
      var t = document.createElement('time');
      t.setAttribute('datetime', at.toISOString());
      t.textContent = fmtSlot(at);
      li.appendChild(t);
      li.appendChild(document.createTextNode(' — ' + q.title));
      if (q.lane !== 'front') {
        var tag = document.createElement('span');
        tag.className = 'lane';
        tag.textContent = 'long-term';
        li.appendChild(tag);
      }
      ol.appendChild(li);
    });
    if (queue.length > preview) {
      var rest = document.createElement('li');
      rest.className = 'more-queued';
      rest.textContent = '+' + (queue.length - preview) + ' more further down the queue';
      ol.appendChild(rest);
    }
  }

  document.querySelectorAll('article').forEach(function (card) {
    var id = parseInt(card.getAttribute('data-id'), 10);
    var status = card.querySelector('.status');
    var pub = card.querySelector('.b-pub');
    var del = card.querySelector('.b-del');
    var lat = card.querySelector('.b-lat');
    var buttons = [pub, del, lat];

    card.querySelector('.more').addEventListener('click', function () {
      var wrap = card.querySelector('.body-wrap');
      wrap.classList.toggle('open');
      this.textContent = wrap.classList.contains('open') ? 'Collapse ▴' : 'Read full story ▾';
    });

    function busy(on, msg) {
      buttons.forEach(function (b) { b.disabled = on; });
      status.textContent = msg || '';
    }

    pub.addEventListener('click', function () {
      busy(true, 'Approving…');
      api('publish', { post_id: id }).then(function (j) {
        if (!j.ok) { busy(false, '⚠ ' + (j.error || 'failed')); return; }
        status.textContent = j.scheduled
          ? (j.lane === 'front' ? '🕒 Queued for ' : '🗓 Long-term queue · ')
            + fmtSlot(new Date(j.publish_at * 1000))
          : '✓ Published — sharing to social…';
        setPicks(j.front_used, j.front_limit);
        renderQueue(j.queue);
        setTimeout(function () { removeCard(card); }, j.scheduled ? 1400 : 900);
      }).catch(function () { busy(false, '⚠ Network error — try again.'); });
    });

    lat.addEventListener('click', function () {
      busy(true, 'Snoozing…');
      api('later', { post_id: id }).then(function (j) {
        if (!j.ok) { busy(false, '⚠ ' + (j.error || 'failed')); return; }
        busy(false, '');
        card.classList.add('snoozed');
        document.getElementById('list').appendChild(card);
      }).catch(function () { busy(false, '⚠ Network error — try again.'); });
    });

    var confirmTimer = null;
    del.addEventListener('click', function () {
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm');
        del.textContent = 'Tap to confirm';
        confirmTimer = setTimeout(function () {
          del.classList.remove('confirm');
          del.textContent = '🗑 Delete';
        }, 3500);
        return;
      }
      clearTimeout(confirmTimer);
      busy(true, 'Deleting…');
      api('delete', { post_id: id }).then(function (j) {
        if (!j.ok) { busy(false, '⚠ ' + (j.error || 'failed')); return; }
        status.textContent = '🗑 Deleted' + (j.cover_deleted ? ' (cover removed)' : '');
        setTimeout(function () { removeCard(card); }, 700);
      }).catch(function () { busy(false, '⚠ Network error — try again.'); });
    });
  });

  /* ── Push subscription ── */
  var btn = document.getElementById('push-btn');

  function b64ToU8(s) {
    var pad = '='.repeat((4 - s.length % 4) % 4);
    var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) { arr[i] = raw.charCodeAt(i); }
    return arr;
  }

  function setBtn(on) {
    btn.classList.toggle('on', on);
    btn.textContent = on ? '🔔 Notifications on' : '🔔 Notify me';
    btn.dataset.on = on ? '1' : '';
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID) {
    btn.style.display = 'none';
  } else {
    navigator.serviceWorker.register('/news-review-sw').then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) { setBtn(!!sub); }).catch(function () {});

    btn.addEventListener('click', function () {
      navigator.serviceWorker.ready.then(function (reg) {
        if (btn.dataset.on) {
          return reg.pushManager.getSubscription().then(function (sub) {
            if (!sub) { setBtn(false); return; }
            return api('unsubscribe', { endpoint: sub.endpoint })
              .then(function () { return sub.unsubscribe(); })
              .then(function () { setBtn(false); });
          });
        }
        return Notification.requestPermission().then(function (perm) {
          if (perm !== 'granted') { throw new Error('denied'); }
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: b64ToU8(VAPID)
          });
        }).then(function (sub) {
          return api('subscribe', { subscription: sub.toJSON() });
        }).then(function (j) {
          if (!j.ok) { throw new Error(j.error || 'failed'); }
          setBtn(true);
        });
      }).catch(function (e) {
        btn.textContent = e && e.message === 'denied'
          ? '🔕 Blocked in settings'
          : '⚠ Push setup failed';
        setTimeout(function () { setBtn(!!btn.dataset.on); }, 2500);
      });
    });
  }
})();
</script>
</body>
</html>
    <?php
    exit;
}
