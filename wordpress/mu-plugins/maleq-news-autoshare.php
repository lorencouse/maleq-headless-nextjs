<?php
/**
 * Plugin Name: Male Q News Auto-Share
 * Description: Auto-share for the LGBTQ news agent. When a News-agent draft is PUBLISHED (your approval), it is shared once to Bluesky + Mastodon. Mirrors scripts/news-agent/social/* exactly and reuses the same _maleq_news_* postmeta, so the sync-shares.ts poll stays a compatible manual fallback. (X/Threads/Facebook manual sharing was removed in v1.3.0 — those platforms suppressed off-platform links to ~zero engagement and Threads disabled the account; we now share only to Bluesky + Mastodon, which sanction it and where the audience actually engages.)
 * Version: 1.3.0
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
