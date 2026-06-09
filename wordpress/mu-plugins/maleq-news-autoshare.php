<?php
/**
 * Plugin Name: Male Q News Auto-Share
 * Description: Social sharing for the LGBTQ news agent. (1) AUTO-SHARE: when a News-agent draft is PUBLISHED (your approval), it is shared once to Bluesky + Mastodon. Mirrors scripts/news-agent/social/* exactly and reuses the same _maleq_news_* postmeta, so the sync-shares.ts poll stays a compatible manual fallback. (2) MANUAL X/THREADS: a post-editor meta box with pre-composed, editable text (the same socialText hook + _maleq_news_hashtags used by the adapters) and Share-via-intent + Copy buttons, for the two platforms that have no script-free auto-post path.
 * Version: 1.2.0
 *
 * Fires only for posts that are unmistakably news-agent articles:
 *   - post_type = 'post'
 *   - in the 'news' category
 *   - carries the _maleq_news_source_url marker written by the drafter
 * A hand-written guide or product can never match, so ONLY news articles auto-share.
 *
 * Idempotency (identical to sync-shares.ts):
 *   _maleq_news_share_urls   JSON { platform: postedUrl } — per-platform, retried individually
 *   _maleq_news_shared_at    ISO timestamp, set once every platform has a recorded URL
 *   _maleq_news_pending_review  deleted once fully shared
 *
 * Credentials — define in wp-config.php (getenv() also honored):
 *   define('MALEQ_BLUESKY_HANDLE',        'mqnews.bsky.social');
 *   define('MALEQ_BLUESKY_APP_PASSWORD',  'xxxx-xxxx-xxxx-xxxx');
 *   define('MALEQ_MASTODON_INSTANCE_URL', 'https://mastodon.social');
 *   define('MALEQ_MASTODON_ACCESS_TOKEN', '...');
 *   define('MALEQ_SITE_URL',              'https://maleq.com');  // optional, this is the default
 *
 * Network calls run on 'shutdown' (after fastcgi_finish_request when available), so
 * clicking Publish never waits on the social APIs. Failures are logged; the next
 * publish-or sync-shares.ts run retries only the platforms that didn't succeed.
 */

if (!defined('ABSPATH')) {
    exit;
}

/* Postmeta keys — MUST match scripts/news-agent/config.ts META. */
const MALEQ_NEWS_SOURCE_URL_KEY = '_maleq_news_source_url';
const MALEQ_NEWS_IMAGE_URL_KEY  = '_maleq_news_image_url';
const MALEQ_NEWS_SHARED_AT_KEY  = '_maleq_news_shared_at';
const MALEQ_NEWS_SHARE_URLS_KEY = '_maleq_news_share_urls';
const MALEQ_NEWS_PENDING_KEY    = '_maleq_news_pending_review';
const MALEQ_NEWS_SOCIAL_TEXT_KEY = '_maleq_news_social_text';
const MALEQ_NEWS_HASHTAGS_KEY    = '_maleq_news_hashtags';
const MALEQ_NEWS_CATEGORY_SLUG  = 'news';

/* Per-platform hashtag caps — mirror social/bluesky.ts + social/mastodon.ts. */
const MALEQ_NEWS_BLUESKY_MAX_TAGS  = 4;
const MALEQ_NEWS_MASTODON_MAX_TAGS = 4;

/** Pull a config value from a constant first, then the environment. */
function maleq_news_cfg($const, $env) {
    if (defined($const) && constant($const)) {
        return (string) constant($const);
    }
    $v = getenv($env);
    return $v === false ? '' : (string) $v;
}

function maleq_news_site_url() {
    $u = maleq_news_cfg('MALEQ_SITE_URL', 'MALEQ_SITE_URL');
    return rtrim($u ?: 'https://maleq.com', '/');
}

/** Public post URL — posts render at /guides/<slug> (matches config.ts postUrl). */
function maleq_news_post_url($slug) {
    return maleq_news_site_url() . '/guides/' . $slug;
}

/**
 * Warm the headless /guides/<slug> page before posting to crawl-based platforms.
 * Mastodon builds its link-preview card by fetching the URL server-side. The share
 * fires the instant the post is published — usually BEFORE Next.js has generated
 * the page via ISR — so without this Mastodon crawls a not-ready page, finds no
 * og: tags, and caches an EMPTY card (Bluesky is immune: we upload its thumb).
 * We GET the URL until it returns a fully-rendered page (200 containing og:title),
 * which both triggers ISR generation and confirms it finished, then let the post
 * go out. Runs on shutdown (after fastcgi_finish_request) so it never blocks the
 * editor. Best-effort: gives up after ~tries*delay seconds and shares anyway.
 */
function maleq_news_warm_url($url, $tries = 10, $delay = 3) {
    for ($i = 0; $i < $tries; $i++) {
        $r = wp_remote_get($url, [
            'timeout'     => 15,
            'redirection' => 3,
            'user-agent'  => 'MaleQ-NewsAgent/1.0 (+https://maleq.com; card warm)',
        ]);
        if (!is_wp_error($r)
            && (int) wp_remote_retrieve_response_code($r) === 200
            && strpos((string) wp_remote_retrieve_body($r), 'og:title') !== false) {
            return true;
        }
        sleep($delay);
    }
    error_log('[maleq-news-autoshare] page warm timed out for ' . $url);
    return false;
}

/** Grapheme-ish truncate with trailing ellipsis — mirrors social/types.ts truncate(). */
function maleq_news_truncate($s, $max) {
    $s = (string) $s;
    if (mb_strlen($s) <= $max) {
        return $s;
    }
    return rtrim(mb_substr($s, 0, $max - 1)) . '…';
}

/** Strip hashtags to letters/digits only + de-dupe + cap — mirrors types.ts cleanHashtags(). */
function maleq_news_clean_hashtags($tags, $max = 4) {
    if (!is_array($tags)) {
        return [];
    }
    $out = [];
    foreach ($tags as $raw) {
        $t = preg_replace('/[^A-Za-z0-9]/', '', preg_replace('/^#+/', '', (string) $raw));
        if ($t === '') {
            continue;
        }
        $dup = false;
        foreach ($out as $x) {
            if (strcasecmp($x, $t) === 0) { $dup = true; break; }
        }
        if (!$dup) {
            $out[] = $t;
        }
        if (count($out) >= $max) {
            break;
        }
    }
    return $out;
}

/**
 * Build Bluesky richtext #tag facets — mirrors types.ts buildTagFacets(). A bare
 * "#foo" isn't a clickable/searchable tag on Bluesky without a facet mapping its
 * UTF-8 byte range to a tag feature. $byte_offset = byte length of text BEFORE the
 * hashtag line. PHP strings are byte arrays, so strlen() gives the right offsets.
 */
function maleq_news_tag_facets($clean_tags, $byte_offset) {
    $facets = [];
    $pos = (int) $byte_offset;
    foreach (array_values($clean_tags) as $i => $tag) {
        if ($i > 0) {
            $pos += 1; // single-space separator
        }
        $token = '#' . $tag;
        $start = $pos;
        $end   = $pos + strlen($token);
        $facets[] = [
            'index'    => ['byteStart' => $start, 'byteEnd' => $end],
            'features' => [['$type' => 'app.bsky.richtext.facet#tag', 'tag' => $tag]],
        ];
        $pos = $end;
    }
    return $facets;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Capture publish transitions, share on shutdown (non-blocking).
 * ──────────────────────────────────────────────────────────────────────── */

$GLOBALS['maleq_news_share_queue'] = [];

add_action('transition_post_status', function ($new_status, $old_status, $post) {
    // Only the draft/pending → publish transition. Editing an already-published
    // post does not re-fire (old_status would be 'publish').
    if ($new_status !== 'publish' || $old_status === 'publish') {
        return;
    }
    if (!$post || $post->post_type !== 'post') {
        return;
    }
    if (!in_array($post->ID, $GLOBALS['maleq_news_share_queue'], true)) {
        $GLOBALS['maleq_news_share_queue'][] = (int) $post->ID;
    }
}, 10, 3);

add_action('shutdown', function () {
    $queue = $GLOBALS['maleq_news_share_queue'] ?? [];
    if (empty($queue)) {
        return;
    }
    // Flush the HTTP response to the editor before making network calls.
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
    foreach (array_unique($queue) as $post_id) {
        maleq_news_share_post((int) $post_id);
    }
});

/* ─────────────────────────────────────────────────────────────────────────
 * Core: validate guards (fresh read), then share to each pending platform.
 * ──────────────────────────────────────────────────────────────────────── */
function maleq_news_share_post($post_id) {
    $post = get_post($post_id);
    if (!$post || $post->post_status !== 'publish' || $post->post_type !== 'post') {
        return;
    }

    // Guard 1: must be in the News category.
    if (!has_category(MALEQ_NEWS_CATEGORY_SLUG, $post)) {
        return;
    }
    // Guard 2: must carry the news-agent source marker. This is what makes auto-share
    // fire for news articles ONLY — a manual guide/product never has this meta.
    if (!get_post_meta($post_id, MALEQ_NEWS_SOURCE_URL_KEY, true)) {
        return;
    }
    // Guard 3: already fully shared?
    if (get_post_meta($post_id, MALEQ_NEWS_SHARED_AT_KEY, true)) {
        return;
    }

    $platforms = maleq_news_enabled_platforms();
    if (empty($platforms)) {
        error_log('[maleq-news-autoshare] No social credentials configured; skipping post ' . $post_id);
        return;
    }

    // Per-platform idempotency: skip any platform already recorded.
    $share_urls_raw = get_post_meta($post_id, MALEQ_NEWS_SHARE_URLS_KEY, true);
    $share_urls = $share_urls_raw ? json_decode($share_urls_raw, true) : [];
    if (!is_array($share_urls)) {
        $share_urls = [];
    }

    $excerpt = $post->post_excerpt;
    if (!$excerpt) {
        $excerpt = (string) get_post_meta($post_id, 'rank_math_description', true);
    }

    // Cover image for the social card: ONLY the post's featured image — our licensed
    // Pexels cover (attach-covers.ts), read straight off disk (no HTTP, exact bytes).
    // We never fall back to the source outlet's feed photo (_maleq_news_image_url): it's
    // copyrighted and not licensed for us to republish. No cover → imageless card.
    $thumb_id   = get_post_thumbnail_id($post_id);
    $image_path = $thumb_id ? get_attached_file($thumb_id) : '';
    $image_mime = $thumb_id ? get_post_mime_type($thumb_id) : '';
    $image_url  = $thumb_id ? (wp_get_attachment_image_url($thumb_id, 'full') ?: '') : '';

    // Social hook + hashtags (drafted by Claude). Absent on legacy posts → adapters
    // fall back to the title, exactly like the TS path.
    $social_text  = (string) get_post_meta($post_id, MALEQ_NEWS_SOCIAL_TEXT_KEY, true);
    $hashtags_raw = get_post_meta($post_id, MALEQ_NEWS_HASHTAGS_KEY, true);
    $hashtags     = $hashtags_raw ? json_decode($hashtags_raw, true) : [];
    if (!is_array($hashtags)) {
        $hashtags = [];
    }

    $input = [
        'title'      => html_entity_decode($post->post_title, ENT_QUOTES, 'UTF-8'),
        'excerpt'    => html_entity_decode($excerpt, ENT_QUOTES, 'UTF-8'),
        'url'        => maleq_news_post_url($post->post_name),
        'imageUrl'   => $image_url,
        'imagePath'  => $image_path ?: '',
        'imageMime'  => $image_mime ?: '',
        'socialText' => html_entity_decode($social_text, ENT_QUOTES, 'UTF-8'),
        'hashtags'   => $hashtags,
    ];

    // Ensure the article page is live before posting to Mastodon (it crawls the URL
    // for its preview card). Only worth waiting if Mastodon is actually pending.
    if (in_array('mastodon', $platforms, true) && empty($share_urls['mastodon'])) {
        maleq_news_warm_url($input['url']);
    }

    foreach ($platforms as $platform) {
        if (!empty($share_urls[$platform])) {
            continue; // already posted there
        }
        $result = ($platform === 'bluesky')
            ? maleq_news_share_bluesky($input)
            : maleq_news_share_mastodon($input);

        if ($result['ok']) {
            $share_urls[$platform] = $result['url'] ?: 'posted';
            error_log("[maleq-news-autoshare] #$post_id → $platform: " . $share_urls[$platform]);
        } else {
            error_log("[maleq-news-autoshare] #$post_id → $platform FAILED: " . $result['error']);
        }
    }

    update_post_meta($post_id, MALEQ_NEWS_SHARE_URLS_KEY, wp_json_encode($share_urls));

    // Mark fully shared only when every enabled platform has a recorded URL.
    $all_done = true;
    foreach ($platforms as $platform) {
        if (empty($share_urls[$platform])) {
            $all_done = false;
            break;
        }
    }
    if ($all_done) {
        update_post_meta($post_id, MALEQ_NEWS_SHARED_AT_KEY, gmdate('c'));
        delete_post_meta($post_id, MALEQ_NEWS_PENDING_KEY);
    }
}

/** Which platforms have full credentials present. */
function maleq_news_enabled_platforms() {
    $out = [];
    if (maleq_news_cfg('MALEQ_BLUESKY_HANDLE', 'BLUESKY_HANDLE')
        && maleq_news_cfg('MALEQ_BLUESKY_APP_PASSWORD', 'BLUESKY_APP_PASSWORD')) {
        $out[] = 'bluesky';
    }
    if (maleq_news_cfg('MALEQ_MASTODON_INSTANCE_URL', 'MASTODON_INSTANCE_URL')
        && (maleq_news_cfg('MALEQ_MASTODON_ACCESS_TOKEN', 'MASTODON_ACCESS_TOKEN')
            || maleq_news_cfg('MALEQ_MASTODON_CLIENT_ACCESS_TOKEN', 'MASTODON_CLIENT_ACCESS_TOKEN'))) {
        $out[] = 'mastodon';
    }
    return $out;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Bluesky (AT Protocol) — mirrors social/bluesky.ts.
 * createSession with an app password, then createRecord with an external embed.
 * ──────────────────────────────────────────────────────────────────────── */
/**
 * Upload the cover image to the user's Bluesky repo and return the blob object
 * for embedding as a link-card thumbnail. Returns null on any miss (no image,
 * >1MB, fetch/upload error) so the caller posts an imageless card instead of
 * failing the whole share. bsky.social caps image blobs at ~1MB.
 */
function maleq_news_bluesky_upload_thumb($service, $jwt, $input) {
    $bytes = '';
    $mime  = $input['imageMime'] ?? '';

    if (!empty($input['imagePath']) && is_readable($input['imagePath'])) {
        $bytes = (string) file_get_contents($input['imagePath']);
    } elseif (!empty($input['imageUrl'])) {
        $r = wp_remote_get($input['imageUrl'], ['timeout' => 15]);
        if (!is_wp_error($r) && wp_remote_retrieve_response_code($r) < 300) {
            $bytes = (string) wp_remote_retrieve_body($r);
            if (!$mime) {
                $mime = (string) wp_remote_retrieve_header($r, 'content-type');
            }
        }
    }

    if ($bytes === '') {
        return null;
    }
    if (strlen($bytes) > 1000000) {
        error_log('[maleq-news-autoshare] cover image >1MB — skipping Bluesky thumb');
        return null;
    }
    if (!$mime) {
        $mime = 'image/jpeg';
    }

    $res = wp_remote_post("$service/xrpc/com.atproto.repo.uploadBlob", [
        'timeout' => 20,
        'headers' => [
            'Content-Type'  => $mime,
            'Authorization' => "Bearer $jwt",
        ],
        'body' => $bytes,
    ]);
    if (is_wp_error($res) || wp_remote_retrieve_response_code($res) >= 300) {
        $err = is_wp_error($res) ? $res->get_error_message() : wp_remote_retrieve_body($res);
        error_log('[maleq-news-autoshare] uploadBlob failed: ' . $err);
        return null;
    }
    $body = json_decode(wp_remote_retrieve_body($res), true);
    return $body['blob'] ?? null;
}

function maleq_news_share_bluesky($input) {
    $service = maleq_news_cfg('MALEQ_BLUESKY_SERVICE', 'BLUESKY_SERVICE') ?: 'https://bsky.social';
    $handle  = maleq_news_cfg('MALEQ_BLUESKY_HANDLE', 'BLUESKY_HANDLE');
    $app_pw  = maleq_news_cfg('MALEQ_BLUESKY_APP_PASSWORD', 'BLUESKY_APP_PASSWORD');

    $sess = wp_remote_post("$service/xrpc/com.atproto.server.createSession", [
        'timeout' => 15,
        'headers' => ['Content-Type' => 'application/json'],
        'body'    => wp_json_encode(['identifier' => $handle, 'password' => $app_pw]),
    ]);
    if (is_wp_error($sess)) {
        return ['ok' => false, 'error' => $sess->get_error_message()];
    }
    $sbody = json_decode(wp_remote_retrieve_body($sess), true);
    if (wp_remote_retrieve_response_code($sess) >= 300) {
        return ['ok' => false, 'error' => ($sbody['message'] ?? 'createSession HTTP ' . wp_remote_retrieve_response_code($sess))];
    }
    $jwt = $sbody['accessJwt'] ?? '';
    $did = $sbody['did'] ?? '';
    $sess_handle = $sbody['handle'] ?? $handle;

    // Bluesky does not crawl the URL for an OG image — upload the cover ourselves
    // and reference it as the link-card thumbnail. Null (no/oversized image or a
    // failed upload) just yields an imageless card; the post still goes out.
    $external = [
        'uri'         => $input['url'],
        'title'       => maleq_news_truncate($input['title'], 200),
        'description' => maleq_news_truncate($input['excerpt'] ?? '', 280),
    ];
    $thumb = maleq_news_bluesky_upload_thumb($service, $jwt, $input);
    if ($thumb) {
        $external['thumb'] = $thumb;
    }

    // Post text = original hook (NOT the headline — it's already in the card) + up to
    // 4 clickable hashtags. Mirrors social/bluesky.ts.
    $hook     = trim($input['socialText'] ?? '') !== '' ? trim($input['socialText']) : $input['title'];
    $bs_tags  = maleq_news_clean_hashtags($input['hashtags'] ?? [], MALEQ_NEWS_BLUESKY_MAX_TAGS);
    $tag_line = implode(' ', array_map(function ($t) { return '#' . $t; }, $bs_tags));
    $reserve  = $tag_line !== '' ? mb_strlen($tag_line) + 2 : 0; // "\n\n" + tags
    $head     = maleq_news_truncate($hook, 300 - $reserve);
    $text     = $tag_line !== '' ? $head . "\n\n" . $tag_line : $head;
    $facets   = $tag_line !== '' ? maleq_news_tag_facets($bs_tags, strlen($head . "\n\n")) : [];

    $record = [
        '$type'     => 'app.bsky.feed.post',
        'text'      => $text,
        'createdAt' => gmdate('c'),
        'langs'     => ['en'],
        'embed'     => [
            '$type'    => 'app.bsky.embed.external',
            'external' => $external,
        ],
    ];
    if (!empty($facets)) {
        $record['facets'] = $facets;
    }

    $rec = wp_remote_post("$service/xrpc/com.atproto.repo.createRecord", [
        'timeout' => 15,
        'headers' => [
            'Content-Type'  => 'application/json',
            'Authorization' => "Bearer $jwt",
        ],
        'body' => wp_json_encode([
            'repo'       => $did,
            'collection' => 'app.bsky.feed.post',
            'record'     => $record,
        ]),
    ]);
    if (is_wp_error($rec)) {
        return ['ok' => false, 'error' => $rec->get_error_message()];
    }
    $rbody = json_decode(wp_remote_retrieve_body($rec), true);
    if (wp_remote_retrieve_response_code($rec) >= 300) {
        return ['ok' => false, 'error' => ($rbody['message'] ?? 'createRecord HTTP ' . wp_remote_retrieve_response_code($rec))];
    }

    $uri  = $rbody['uri'] ?? '';
    $parts = explode('/', $uri);
    $rkey = end($parts);
    $web  = $rkey ? "https://bsky.app/profile/$sess_handle/post/$rkey" : '';
    return ['ok' => true, 'url' => $web];
}

/* ─────────────────────────────────────────────────────────────────────────
 * Mastodon — mirrors social/mastodon.ts. POST /api/v1/statuses with a status
 * string; Mastodon auto-renders the trailing URL as a link card.
 * ──────────────────────────────────────────────────────────────────────── */
function maleq_news_share_mastodon($input) {
    $instance = rtrim(maleq_news_cfg('MALEQ_MASTODON_INSTANCE_URL', 'MASTODON_INSTANCE_URL'), '/');
    $token    = maleq_news_cfg('MALEQ_MASTODON_ACCESS_TOKEN', 'MASTODON_ACCESS_TOKEN')
        ?: maleq_news_cfg('MALEQ_MASTODON_CLIENT_ACCESS_TOKEN', 'MASTODON_CLIENT_ACCESS_TOKEN');

    // Original hook (NOT the headline — already in the card) + auto-linked hashtags +
    // the URL Mastodon renders as a card. Mirrors social/mastodon.ts.
    $hook     = trim($input['socialText'] ?? '') !== '' ? trim($input['socialText']) : $input['title'];
    $md_tags  = maleq_news_clean_hashtags($input['hashtags'] ?? [], MALEQ_NEWS_MASTODON_MAX_TAGS);
    $tag_line = implode(' ', array_map(function ($t) { return '#' . $t; }, $md_tags));
    $reserve  = mb_strlen($input['url']) + 2 + ($tag_line !== '' ? mb_strlen($tag_line) + 2 : 0);
    $head     = maleq_news_truncate($hook, 500 - $reserve);
    $status   = implode("\n\n", array_filter([$head, $tag_line !== '' ? $tag_line : null, $input['url']]));

    $res = wp_remote_post("$instance/api/v1/statuses", [
        'timeout' => 15,
        'headers' => [
            'Authorization' => "Bearer $token",
            'Content-Type'  => 'application/x-www-form-urlencoded',
        ],
        'body' => [
            'status'     => $status,
            'visibility' => 'public',
            'language'   => 'en',
        ],
    ]);
    if (is_wp_error($res)) {
        return ['ok' => false, 'error' => $res->get_error_message()];
    }
    $body = json_decode(wp_remote_retrieve_body($res), true);
    if (wp_remote_retrieve_response_code($res) >= 300) {
        return ['ok' => false, 'error' => ($body['error'] ?? 'statuses HTTP ' . wp_remote_retrieve_response_code($res))];
    }
    return ['ok' => true, 'url' => ($body['url'] ?? '')];
}

/* ─────────────────────────────────────────────────────────────────────────
 * Manual X / Threads share — post-editor meta box.
 *
 * X (Twitter) and Threads have no reliable script-free auto-post path — posting
 * requires API approval (developer account, app review, OAuth, often paid). So
 * instead of auto-firing on publish like Bluesky/Mastodon, we render a meta box
 * on the news-post editor with pre-composed, EDITABLE text plus:
 *   - "Share to X" / "Share to Threads"  → opens the platform's web compose
 *     window (intent URL) pre-filled with the box text; you review + post manually.
 *   - "Copy for X" / "Copy for Threads"  → copies the box text to the clipboard.
 *
 * Composition is IDENTICAL to the Mastodon adapter above — the same socialText
 * "hook" (NOT the headline; the headline is already in the link card) + the same
 * cleaned _maleq_news_hashtags + the trailing URL the platform renders as a card.
 * This keeps X/Threads consistent with what actually goes out on Bluesky/Mastodon.
 *
 * The one thing intents can't do that the real API could: pre-attach an image.
 * The trailing URL still auto-generates a link-card preview on both platforms.
 * ──────────────────────────────────────────────────────────────────────── */

const MALEQ_NEWS_X_LIMIT       = 280;  // X post limit
const MALEQ_NEWS_THREADS_LIMIT = 500;  // Threads post limit
const MALEQ_NEWS_URL_WEIGHT    = 23;   // X counts every URL as 23 chars (t.co)

/**
 * Compose "hook\n\n#tags\n\nURL", trimming the hook so the whole thing fits
 * $limit. $url_weight is how many chars the URL "costs" toward the limit — 23 on
 * X (t.co), its real length on Threads. Mirrors maleq_news_share_mastodon().
 */
function maleq_news_compose_manual($input, $limit, $url_weight) {
    $hook     = trim($input['socialText'] ?? '') !== '' ? trim($input['socialText']) : $input['title'];
    $tags     = maleq_news_clean_hashtags($input['hashtags'] ?? [], 4);
    $tag_line = implode(' ', array_map(function ($t) { return '#' . $t; }, $tags));
    $reserve  = $url_weight + 2 + ($tag_line !== '' ? mb_strlen($tag_line) + 2 : 0);
    $head     = maleq_news_truncate($hook, max(10, $limit - $reserve));
    return implode("\n\n", array_filter([$head, $tag_line !== '' ? $tag_line : null, $input['url']]));
}

/** Register the meta box only on News-category posts (same surface as auto-share). */
add_action('add_meta_boxes', function ($post_type, $post) {
    if ($post_type !== 'post' || !$post) {
        return;
    }
    if (!has_category(MALEQ_NEWS_CATEGORY_SLUG, $post)) {
        return;
    }
    add_meta_box(
        'maleq-news-manual-share',
        'Share to X / Threads',
        'maleq_news_manual_share_box',
        'post',
        'side',
        'high'
    );
}, 10, 2);

/** Render the meta box: two editable boxes + Share/Copy buttons, with live counts. */
function maleq_news_manual_share_box($post) {
    $social_text  = (string) get_post_meta($post->ID, MALEQ_NEWS_SOCIAL_TEXT_KEY, true);
    $hashtags_raw = get_post_meta($post->ID, MALEQ_NEWS_HASHTAGS_KEY, true);
    $hashtags     = $hashtags_raw ? json_decode($hashtags_raw, true) : [];
    if (!is_array($hashtags)) {
        $hashtags = [];
    }

    $input = [
        'title'      => html_entity_decode(get_the_title($post), ENT_QUOTES, 'UTF-8'),
        'url'        => maleq_news_post_url($post->post_name),
        'socialText' => html_entity_decode($social_text, ENT_QUOTES, 'UTF-8'),
        'hashtags'   => $hashtags,
    ];

    $x_text       = maleq_news_compose_manual($input, MALEQ_NEWS_X_LIMIT, MALEQ_NEWS_URL_WEIGHT);
    $threads_text = maleq_news_compose_manual($input, MALEQ_NEWS_THREADS_LIMIT, mb_strlen($input['url']));

    $is_published = ($post->post_status === 'publish');
    $no_hook      = (trim($social_text) === '');
    ?>
    <div id="maleq-news-share-box" style="font-size:12px;">
        <?php if (!$is_published) : ?>
            <p style="margin:0 0 8px;color:#996800;background:#fcf9e8;border:1px solid #f0e6b8;padding:6px 8px;border-radius:3px;">
                Not published yet — the link won't resolve until you publish. Bluesky &amp;
                Mastodon auto-share on publish; X &amp; Threads are manual, below.
            </p>
        <?php endif; ?>
        <?php if ($no_hook) : ?>
            <p style="margin:0 0 8px;color:#646970;">
                No drafted social hook (<code>_maleq_news_social_text</code>) on this post —
                using the headline instead. Edit the text below before posting if you like.
            </p>
        <?php endif; ?>

        <p style="margin:0 0 8px;">
            <label><input type="checkbox" id="maleq-autoshare-onpublish" checked> Auto-open X &amp; Threads when I publish this post</label>
        </p>
        <p id="maleq-autoshare-note" style="margin:0 0 10px;color:#646970;">
            On publish I'll try to open both compose tabs automatically. Browsers (especially Safari)
            block tabs that aren't opened by a click, so if that happens you'll see one-click buttons here instead.
        </p>
        <div id="maleq-autoshare-fallback" style="display:none;margin:0 0 12px;padding:8px 10px;background:#edfaef;border:1px solid #a7e3b0;border-radius:3px;">
            <strong>Published.</strong> <span id="maleq-autoshare-fallback-msg">Your browser blocked the auto-open — click to open compose:</span>
            <span style="display:block;margin-top:6px;">
                <a href="#" id="maleq-x-open2" class="button button-primary button-small" style="display:none;">Open 𝕏 compose ↗</a>
                <a href="#" id="maleq-threads-open2" class="button button-primary button-small" style="display:none;">Open Threads compose ↗</a>
            </span>
        </div>

        <p style="margin:0 0 4px;font-weight:600;">𝕏 (Twitter)</p>
        <textarea id="maleq-x-text" rows="5" style="width:100%;font-size:12px;line-height:1.4;"><?php echo esc_textarea($x_text); ?></textarea>
        <div style="display:flex;align-items:center;justify-content:space-between;margin:4px 0 12px;">
            <span><a href="#" id="maleq-x-share" class="button button-primary button-small">Share to X</a>
                  <a href="#" id="maleq-x-copy" class="button button-small">Copy for X</a></span>
            <span id="maleq-x-count" style="color:#646970;"></span>
        </div>

        <p style="margin:0 0 4px;font-weight:600;">Threads</p>
        <textarea id="maleq-threads-text" rows="6" style="width:100%;font-size:12px;line-height:1.4;"><?php echo esc_textarea($threads_text); ?></textarea>
        <div style="display:flex;align-items:center;justify-content:space-between;margin:4px 0 0;">
            <span><a href="#" id="maleq-threads-share" class="button button-primary button-small">Share to Threads</a>
                  <a href="#" id="maleq-threads-copy" class="button button-small">Copy for Threads</a></span>
            <span id="maleq-threads-count" style="color:#646970;"></span>
        </div>
    </div>
    <script>
    (function () {
        // X counts every URL as 23 chars (t.co wrapping); Threads counts raw length.
        function xLen(t) {
            var re = /https?:\/\/[^\s]+/g;
            var urls = t.match(re) || [];
            return t.replace(re, '').length + urls.length * 23;
        }
        var INTENTS = {
            'maleq-x':       'https://twitter.com/intent/tweet?text=',
            'maleq-threads': 'https://www.threads.net/intent/post?text='
        };
        // Open one platform's compose window from its textarea. Returns the window (or null
        // if the browser blocked the pop-up).
        function openShare(prefix) {
            var ta = document.getElementById(prefix + '-text');
            if (!ta) { return null; }
            return window.open(INTENTS[prefix] + encodeURIComponent(ta.value), '_blank', 'noopener');
        }
        function bind(prefix, limit, weighted) {
            var ta    = document.getElementById(prefix + '-text');
            var count = document.getElementById(prefix + '-count');
            var share = document.getElementById(prefix + '-share');
            var copy  = document.getElementById(prefix + '-copy');
            if (!ta) { return; }
            function update() {
                var n = weighted ? xLen(ta.value) : ta.value.length;
                count.textContent = n + ' / ' + limit;
                count.style.color = n > limit ? '#d63638' : '#646970';
            }
            ta.addEventListener('input', update);
            update();
            share.addEventListener('click', function (e) { e.preventDefault(); openShare(prefix); });
            copy.addEventListener('click', function (e) {
                e.preventDefault();
                var btn = e.currentTarget;
                var done = function () {
                    var orig = btn.textContent;
                    btn.textContent = 'Copied!';
                    setTimeout(function () { btn.textContent = orig; }, 1500);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); document.execCommand('copy'); done(); });
                } else {
                    ta.select(); document.execCommand('copy'); done();
                }
            });
        }
        bind('maleq-x',       <?php echo (int) MALEQ_NEWS_X_LIMIT; ?>,       true);
        bind('maleq-threads', <?php echo (int) MALEQ_NEWS_THREADS_LIMIT; ?>, false);

        // ── Auto-open on publish ──────────────────────────────────────────────
        // Try to open both compose tabs the moment the post is published. The publish
        // save is asynchronous, so by the time it completes there is no longer a user
        // "gesture" on the stack — and browsers (Safari most strictly) refuse to open a
        // new tab without one, silently. Browsers also allow only ONE such open per
        // gesture, so two-at-once loses the second even when allowed. We therefore TRY
        // the direct open (works on Chrome/Firefox with pop-ups allowed) and, for any
        // tab the browser blocked, reveal a one-click button — that click is a fresh
        // gesture, so it opens reliably everywhere including Safari. A toggle (persisted
        // per browser) lets you turn the whole thing off.
        var LSKEY  = 'maleqAutoShareOnPublish';
        var toggle = document.getElementById('maleq-autoshare-onpublish');
        var note   = document.getElementById('maleq-autoshare-note');
        function syncNote() { if (note) { note.style.display = (toggle && toggle.checked) ? '' : 'none'; } }
        if (toggle) {
            var saved = null;
            try { saved = localStorage.getItem(LSKEY); } catch (e) {}
            toggle.checked = (saved === null) ? true : (saved === '1');
            syncNote();
            toggle.addEventListener('change', function () {
                try { localStorage.setItem(LSKEY, toggle.checked ? '1' : '0'); } catch (e) {}
                syncNote();
            });
        }

        // Wire the fallback (one-click) buttons once; each click is its own user gesture.
        var fallback = document.getElementById('maleq-autoshare-fallback');
        (function () {
            var pairs = [['maleq-x-open2', 'maleq-x'], ['maleq-threads-open2', 'maleq-threads']];
            pairs.forEach(function (p) {
                var btn = document.getElementById(p[0]);
                if (btn) { btn.addEventListener('click', function (e) { e.preventDefault(); openShare(p[1]); }); }
            });
        })();

        // A pop-up was opened successfully iff window.open returned a live window.
        function opened(w) { return !!w && !w.closed; }
        // Reveal the fallback banner with a button for each platform we couldn't open.
        function revealFallback(blocked) {
            if (!fallback || !blocked.length) { return; }
            blocked.forEach(function (prefix) {
                var btn = document.getElementById(prefix + '-open2');
                if (btn) { btn.style.display = ''; }
            });
            fallback.style.display = '';
        }

        var fired = false;
        function autoOpen() {
            if (fired || (toggle && !toggle.checked)) { return; }
            fired = true;
            var blocked = [];
            if (!opened(openShare('maleq-x'))) { blocked.push('maleq-x'); }
            // Only the first gesture-less open tends to succeed, so the second is the most
            // likely to be blocked — the fallback button covers it either way.
            if (!opened(openShare('maleq-threads'))) { blocked.push('maleq-threads'); }
            revealFallback(blocked);
        }

        // Attach a watcher that fires autoOpen() on the draft/pending → published
        // transition. CRUCIAL: this inline script runs at initial HTML parse, BEFORE
        // Gutenberg registers its core/editor data store — so a synchronous check
        // here finds nothing and the watcher never attaches (nothing ever opens).
        // Poll until the store exists, then subscribe.
        function watchForPublish() {
            if (!(window.wp && wp.data && typeof wp.data.select === 'function')) { return false; }
            var sel0 = wp.data.select('core/editor');
            if (!sel0 || typeof sel0.isCurrentPostPublished !== 'function') { return false; }
            var wasPublished = sel0.isCurrentPostPublished();
            var sawSave = false;
            wp.data.subscribe(function () {
                var sel = wp.data.select('core/editor');
                if (!sel || typeof sel.isSavingPost !== 'function') { return; }
                if (sel.isSavingPost() && !sel.isAutosavingPost()) { sawSave = true; return; }
                if (sawSave && !sel.isSavingPost()) {
                    sawSave = false;
                    var pub = sel.isCurrentPostPublished();
                    if (pub && !wasPublished) { autoOpen(); }
                    wasPublished = pub;
                }
            });
            return true;
        }

        if (/[?&]message=6(&|$)/.test(window.location.search)) {
            // Classic editor: WP reloads with message=6 ("Post published.") after publishing.
            autoOpen();
        } else if (!watchForPublish()) {
            // Block editor store not ready at parse time — poll for it (up to ~15s).
            var _aoTries = 0;
            var _aoIv = setInterval(function () {
                if (watchForPublish() || ++_aoTries > 60) { clearInterval(_aoIv); }
            }, 250);
        }
    })();
    </script>
    <?php
}
