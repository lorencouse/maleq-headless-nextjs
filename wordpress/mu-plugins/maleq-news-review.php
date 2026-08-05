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
 * wp-config constants:
 *   MALEQ_NEWS_REVIEW_KEY           — long random secret; the page/actions are 404/403 without it
 *   MALEQ_NEWS_REVIEW_VAPID_PUBLIC  — VAPID public key (pair with the private key in the
 *                                     news-agent .env; used by the browser to subscribe)
 */

if (!defined('ABSPATH')) {
    exit;
}

/** Option holding the review page's own push subscriptions (owner devices only). */
const MALEQ_NR_SUBS_OPTION = 'maleq_news_review_push_subs';
/** Meta flag: reviewer tapped "Later" (sorts to the bottom of the queue). */
const MALEQ_NR_LATER_META = '_maleq_news_review_later';
/** Max stored push subscriptions (owner devices) — hard cap, oldest evicted. */
const MALEQ_NR_MAX_SUBS = 10;

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
 * Approve: publish now. Stamps the publish time (like WP admin's Publish button — the
 * draft's creation date would otherwise back-date the story) and lets the normal
 * transition_post_status hooks fire, so maleq-news-autoshare.php shares to social on
 * shutdown after this response has already been flushed to the phone.
 */
function maleq_nr_action_publish(int $id): void {
    $post = maleq_nr_reviewable($id);
    if (!$post) {
        maleq_nr_json(['ok' => false, 'error' => 'not a pending news draft'], 404);
    }
    $res = wp_update_post([
        'ID'            => $id,
        'post_status'   => 'publish',
        'post_date'     => current_time('mysql'),
        'post_date_gmt' => current_time('mysql', true),
        'edit_date'     => true,
    ], true);
    if (is_wp_error($res)) {
        maleq_nr_json(['ok' => false, 'error' => $res->get_error_message()], 500);
    }
    delete_post_meta($id, MALEQ_NR_LATER_META);
    maleq_nr_json(['ok' => true, 'url' => maleq_nr_public_url($post->post_name)]);
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
</style>
</head>
<body>
<header>
  <h1>News Review <span class="count" id="count">(<?php echo count($posts); ?>)</span></h1>
  <button id="push-btn" type="button">🔔 Notify me</button>
</header>
<main id="list">
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
<p class="note">Publishing shares to social automatically. Delete removes the story + cover image.<br>
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
      document.getElementById('list').innerHTML =
        '<p class="empty">All caught up 🎉<br>No drafts waiting for review.</p>';
    }
  }

  function removeCard(card) {
    card.classList.add('gone');
    setTimeout(function () { card.remove(); updateCount(-1); }, 280);
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
      busy(true, 'Publishing…');
      api('publish', { post_id: id }).then(function (j) {
        if (!j.ok) { busy(false, '⚠ ' + (j.error || 'failed')); return; }
        status.textContent = '✓ Published — sharing to social…';
        setTimeout(function () { removeCard(card); }, 900);
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
