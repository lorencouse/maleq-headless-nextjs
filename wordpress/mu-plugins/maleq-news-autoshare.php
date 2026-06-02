<?php
/**
 * Plugin Name: Male Q News Auto-Share
 * Description: Event-driven social sharing for the LGBTQ news agent. When a News-agent draft is PUBLISHED (your approval), it is shared once to Bluesky + Mastodon. Mirrors scripts/news-agent/social/* exactly and reuses the same _maleq_news_* postmeta, so the sync-shares.ts poll stays a compatible manual fallback.
 * Version: 1.0.0
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
const MALEQ_NEWS_CATEGORY_SLUG  = 'news';

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

/** Grapheme-ish truncate with trailing ellipsis — mirrors social/types.ts truncate(). */
function maleq_news_truncate($s, $max) {
    $s = (string) $s;
    if (mb_strlen($s) <= $max) {
        return $s;
    }
    return rtrim(mb_substr($s, 0, $max - 1)) . '…';
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

    // Cover image for the social card. Prefer the post's featured image (the Pexels
    // cover attach-covers.ts sets) read straight off disk — no HTTP, exact bytes.
    // Fall back to the feed lead image (_maleq_news_image_url) by URL.
    $thumb_id   = get_post_thumbnail_id($post_id);
    $image_path = $thumb_id ? get_attached_file($thumb_id) : '';
    $image_mime = $thumb_id ? get_post_mime_type($thumb_id) : '';
    $image_url  = $thumb_id
        ? (wp_get_attachment_image_url($thumb_id, 'full') ?: '')
        : (string) get_post_meta($post_id, MALEQ_NEWS_IMAGE_URL_KEY, true);

    $input = [
        'title'     => html_entity_decode($post->post_title, ENT_QUOTES, 'UTF-8'),
        'excerpt'   => html_entity_decode($excerpt, ENT_QUOTES, 'UTF-8'),
        'url'       => maleq_news_post_url($post->post_name),
        'imageUrl'  => $image_url,
        'imagePath' => $image_path ?: '',
        'imageMime' => $image_mime ?: '',
    ];

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

    $record = [
        '$type'     => 'app.bsky.feed.post',
        'text'      => maleq_news_truncate($input['title'], 300),
        'createdAt' => gmdate('c'),
        'langs'     => ['en'],
        'embed'     => [
            '$type'    => 'app.bsky.embed.external',
            'external' => $external,
        ],
    ];

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

    $reserve = mb_strlen($input['url']) + 2;
    $head    = maleq_news_truncate($input['title'], 500 - $reserve);
    $status  = $head . "\n\n" . $input['url'];

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
