<?php
/**
 * Plugin Name: Male Q News — Cover Picker
 * Description: Editor tool to replace a News post's auto-selected cover. A "Cover image" meta box on News posts with: the current cover, pre-filled Browse links to the image sources (Pexels / TMDB / Wikimedia Commons / Openverse) seeded from the post's own cover keywords, a "Re-roll" button (auto-picks a different candidate from the same sources), and a paste-a-URL field with a "Set as cover" button that imports the image as the featured image — optionally through the same headline-overlay pipeline the auto covers use (toggle, default on; falls back to the raw image if compositing is unavailable). Reuses scripts/news-agent (compose-cover.ts / pick-cover.ts) via Bun.
 * Version: 1.0
 */

if (!defined('ABSPATH')) {
    exit;
}

const MALEQ_COVER_NEWS_SLUG = 'news';

/** Bun + news-agent locations on this host (override via env if they ever move). */
function maleq_cover_bun(): string { return getenv('NEWS_AGENT_BUN') ?: '/home/maleq-wp/.bun/bin/bun'; }
function maleq_cover_appdir(): string { return getenv('NEWS_AGENT_DIR') ?: '/home/maleq-wp/news-agent'; }

/** Postmeta keys — mirror scripts/news-agent/config.ts. */
function maleq_cover_meta_keys(): array {
    return [
        'query'    => '_maleq_news_cover_query',
        'person'   => '_maleq_news_cover_person',
        'work'     => '_maleq_news_cover_work',
        'workKind' => '_maleq_news_cover_work_kind',
        'headline' => '_maleq_news_cover_headline',
        'url'      => '_maleq_news_cover_url',
        'credit'   => '_maleq_news_cover_credit',
        'done'     => '_maleq_news_cover_done',
    ];
}

/**
 * Run one of the pure Bun cover helpers from the news-agent dir (so its .env, with
 * the Pexels/TMDB keys, auto-loads). Returns trimmed stdout, or '' on any failure
 * (non-zero exit, timeout, exec disabled) so callers can fall back gracefully.
 */
function maleq_cover_run_bun(string $script, array $args): string {
    if (!function_exists('exec')) {
        return '';
    }
    $cmd = 'cd ' . escapeshellarg(maleq_cover_appdir()) . ' && timeout 90 '
         . escapeshellarg(maleq_cover_bun()) . ' run '
         . escapeshellarg('scripts/news-agent/' . $script);
    foreach ($args as $a) {
        $cmd .= ' ' . escapeshellarg((string) $a);
    }
    $cmd .= ' 2>/dev/null';
    $output = [];
    $code = 0;
    @exec($cmd, $output, $code);
    return $code === 0 ? trim(implode("\n", $output)) : '';
}

/** Best keyword string for stock search when the drafter left no coverQuery. */
function maleq_cover_keywords_fallback(int $post_id): string {
    $tags = wp_get_post_tags($post_id, ['fields' => 'names']);
    if (!empty($tags)) {
        return implode(' ', array_slice($tags, 0, 3));
    }
    return (string) get_the_title($post_id);
}

/* ───────────────────────────── REST API ───────────────────────────── */

add_action('rest_api_init', function () {
    $can_edit = function ($req) {
        $id = (int) $req['post_id'];
        return $id > 0 && current_user_can('edit_post', $id);
    };
    register_rest_route('maleq/v1', '/cover/reroll', [
        'methods'             => 'POST',
        'permission_callback' => $can_edit,
        'callback'            => 'maleq_cover_reroll',
    ]);
    register_rest_route('maleq/v1', '/cover/set', [
        'methods'             => 'POST',
        'permission_callback' => $can_edit,
        'callback'            => 'maleq_cover_set',
    ]);
});

/** Re-roll: hand back ONE fresh auto-picked candidate (not yet applied). */
function maleq_cover_reroll(WP_REST_Request $req) {
    $post_id = (int) $req['post_id'];
    $m = maleq_cover_meta_keys();

    $exclude = array_filter(array_map('esc_url_raw', (array) $req->get_param('exclude')));
    $current = (string) get_post_meta($post_id, $m['url'], true);
    if ($current) {
        $exclude[] = $current;
    }

    $query = (string) get_post_meta($post_id, $m['query'], true);
    if ($query === '') {
        $query = maleq_cover_keywords_fallback($post_id);
    }
    $args = ['--query', $query, '--exclude', implode(',', array_values(array_unique($exclude)))];

    $person = (string) get_post_meta($post_id, $m['person'], true);
    if ($person !== '') { $args[] = '--person'; $args[] = $person; }
    $work = (string) get_post_meta($post_id, $m['work'], true);
    if ($work !== '') {
        $args[] = '--work'; $args[] = $work;
        $wk = (string) get_post_meta($post_id, $m['workKind'], true);
        if ($wk !== '') { $args[] = '--work-kind'; $args[] = $wk; }
    }

    $out  = maleq_cover_run_bun('pick-cover.ts', $args);
    $data = $out !== '' ? json_decode($out, true) : null;
    if (!is_array($data) || empty($data['url'])) {
        return ['ok' => false, 'message' => 'No new image found from the sources — try the Browse links above.'];
    }
    return [
        'ok'          => true,
        'url'         => (string) $data['url'],
        'credit'      => (string) ($data['credit'] ?? ''),
        'creditUrl'   => (string) ($data['creditUrl'] ?? ''),
        'source'      => (string) ($data['source'] ?? ''),
        'licenseName' => (string) ($data['licenseName'] ?? ''),
        'licenseUrl'  => (string) ($data['licenseUrl'] ?? ''),
        'alt'         => (string) ($data['alt'] ?? ''),
    ];
}

/** Set a chosen image URL as the post's featured cover (optionally overlaid). */
function maleq_cover_set(WP_REST_Request $req) {
    $post_id = (int) $req['post_id'];
    $post    = get_post($post_id);
    if (!$post) {
        return new WP_Error('no_post', 'Post not found', ['status' => 404]);
    }
    $old_thumb = (int) get_post_thumbnail_id($post_id); // capture before we replace it
    $url = esc_url_raw(trim((string) $req->get_param('image_url')));
    if ($url === '' || !preg_match('#^https?://#i', $url)) {
        return new WP_Error('bad_url', 'Provide a valid image URL (http/https).', ['status' => 400]);
    }
    $overlay     = filter_var($req->get_param('overlay'), FILTER_VALIDATE_BOOLEAN);
    $source      = sanitize_text_field((string) $req->get_param('source'));        // pexels|commons|openverse|tmdb|'' (manual)
    $credit      = sanitize_text_field((string) $req->get_param('credit'));
    $credit_url  = esc_url_raw(trim((string) $req->get_param('credit_url')));
    $license     = sanitize_text_field((string) $req->get_param('license_name'));
    $license_url = esc_url_raw(trim((string) $req->get_param('license_url')));
    $m           = maleq_cover_meta_keys();

    require_once ABSPATH . 'wp-admin/includes/media.php';
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/image.php';

    $slug    = $post->post_name ?: ('cover-' . $post_id);
    $att_id  = 0;
    $applied_overlay = false;

    // 1) Try the overlay pipeline (Bun): compose a webp to a temp file, then sideload it.
    if ($overlay) {
        $headline = (string) get_post_meta($post_id, $m['headline'], true);
        if ($headline === '') {
            $headline = (string) get_the_title($post_id);
        }
        $args = ['--url', $url, '--slug', $slug];
        if ($headline !== '') { $args[] = '--headline'; $args[] = mb_substr($headline, 0, 70); }
        $local = maleq_cover_run_bun('compose-cover.ts', $args);
        if ($local !== '' && is_file($local)) {
            $sideloaded = media_handle_sideload(['name' => $slug . '.webp', 'tmp_name' => $local], $post_id, $post->post_title);
            @unlink($local);
            if (!is_wp_error($sideloaded)) {
                $att_id = (int) $sideloaded;
                $applied_overlay = true;
            }
        }
    }

    // 2) Fall back to importing the raw URL (no overlay, or compositing unavailable).
    if (!$att_id) {
        $imported = media_sideload_image($url, $post_id, $post->post_title, 'id');
        if (is_wp_error($imported)) {
            return new WP_Error('import_failed', $imported->get_error_message(), ['status' => 500]);
        }
        $att_id = (int) $imported;
    }
    if (!$att_id) {
        return new WP_Error('import_failed', 'Could not import the image.', ['status' => 500]);
    }

    set_post_thumbnail($post_id, $att_id);
    update_post_meta($att_id, '_wp_attachment_image_alt', wp_strip_all_tags(get_the_title($post_id)));

    // Credit line: build a source-correct attribution (matching the auto covers).
    // Only rewrite the body when we actually have a replacement credit — otherwise
    // leave the post's existing credit line untouched.
    $content = (string) $post->post_content;
    $line    = maleq_cover_credit_line($source, $credit, $credit_url, $license, $license_url);
    if ($line !== '') {
        $content = preg_replace('#\s*<p class="image-credit">.*?</p>#is', '', $content);
        $content = rtrim($content) . "\n" . $line;
        wp_update_post(['ID' => $post_id, 'post_content' => $content]);
    }

    update_post_meta($post_id, $m['url'], $url);
    update_post_meta($post_id, $m['credit'], $credit);
    update_post_meta($post_id, $m['done'], '1');

    // Delete the previous cover from the library so replaced covers don't pile up.
    $deleted_old = maleq_cover_delete_old($old_thumb, $att_id, $post_id, $content);

    return [
        'ok'          => true,
        'att_id'      => $att_id,
        'thumb'       => get_the_post_thumbnail_url($post_id, 'medium'),
        'overlay'     => $applied_overlay,
        'deleted_old' => $deleted_old,
    ];
}

/**
 * Build the on-post credit line, matching scripts/news-agent/attach-covers.ts so a
 * manually-set cover reads exactly like an auto one. Source-aware:
 *   pexels   → "Cover photo: <author> / Pexels"
 *   tmdb     → "Poster via The Movie Database (TMDB)"
 *   commons  → "Cover photo: <author>, <license>, via Wikimedia Commons"
 *   openverse→ "Cover photo: <author>, <license>, via Openverse"
 *   (other / manual) → "Cover image: <credit>"
 * Returns '' when there's no credit to write (caller then leaves the body alone).
 */
function maleq_cover_credit_line(string $source, string $credit, string $credit_url, string $license, string $license_url): string {
    if ($credit === '') {
        return '';
    }
    $a = function (string $url, string $text): string {
        $t = esc_html($text);
        return $url !== '' ? '<a href="' . esc_url($url) . '" target="_blank" rel="nofollow noopener">' . $t . '</a>' : $t;
    };
    $creditA = $a($credit_url, $credit);
    switch ($source) {
        case 'pexels':
            $body = 'Cover photo: ' . $creditA . ' / Pexels';
            break;
        case 'tmdb':
            $body = 'Poster via ' . $creditA;
            break;
        case 'commons':
        case 'openverse':
            $platform = $source === 'commons' ? 'Wikimedia Commons' : 'Openverse';
            $lic = $license !== '' ? ', ' . $a($license_url, $license) : '';
            $body = 'Cover photo: ' . $creditA . $lic . ', via ' . $platform;
            break;
        default:
            $body = 'Cover image: ' . $creditA;
    }
    return '<p class="image-credit"><em>' . $body . '</em></p>';
}

/**
 * Permanently delete the prior cover attachment — but ONLY when it's safe: it must
 * be a real attachment, different from the new one, dedicated to THIS post
 * (post_parent == this post, as our imports set it), not used as any other post's
 * featured image, and not still referenced in this post's body. Returns true if
 * it deleted something.
 */
function maleq_cover_delete_old(int $old_id, int $new_id, int $post_id, string $content): bool {
    if ($old_id <= 0 || $old_id === $new_id) {
        return false;
    }
    $old = get_post($old_id);
    if (!$old || $old->post_type !== 'attachment' || (int) $old->post_parent !== $post_id) {
        return false; // not a dedicated cover for this post — leave it alone
    }
    // Don't delete if another post uses it as its featured image.
    global $wpdb;
    $used_elsewhere = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE meta_key = '_thumbnail_id' AND meta_value = %d AND post_id <> %d",
        $old_id, $post_id
    ));
    if ($used_elsewhere > 0) {
        return false;
    }
    // Don't delete if the image is still embedded in this post's body.
    $old_url = wp_get_attachment_url($old_id);
    if ($old_url && strpos($content, preg_replace('#^https?:#', '', $old_url)) !== false) {
        return false;
    }
    return (bool) wp_delete_attachment($old_id, true); // true = bypass trash, remove files
}

/* ───────────────────────────── Meta box ───────────────────────────── */

add_action('add_meta_boxes', function ($post_type, $post) {
    if ($post_type !== 'post' || !$post || !has_category(MALEQ_COVER_NEWS_SLUG, $post)) {
        return;
    }
    add_meta_box('maleq-news-cover-picker', 'Cover image', 'maleq_news_cover_box', 'post', 'normal', 'high');
}, 10, 2);

function maleq_news_cover_box($post) {
    $m        = maleq_cover_meta_keys();
    $query    = (string) get_post_meta($post->ID, $m['query'], true);
    if ($query === '') {
        $query = maleq_cover_keywords_fallback($post->ID);
    }
    $person   = (string) get_post_meta($post->ID, $m['person'], true);
    $work     = (string) get_post_meta($post->ID, $m['work'], true);
    $title    = (string) get_the_title($post->ID);
    $thumb    = get_the_post_thumbnail_url($post->ID, 'medium');
    $nonce    = wp_create_nonce('wp_rest');

    // Source search links, each seeded with the most relevant keyword we have.
    $pexels   = 'https://www.pexels.com/search/' . rawurlencode($query) . '/';
    $tmdb     = 'https://www.themoviedb.org/search?query=' . rawurlencode($work !== '' ? $work : $title);
    $commons  = 'https://commons.wikimedia.org/w/index.php?search=' . rawurlencode($person !== '' ? $person : $title) . '&title=Special:MediaSearch&type=image';
    $openvers = 'https://openverse.org/search/?q=' . rawurlencode($person !== '' ? $person : $query);
    $btn      = 'class="button button-small" target="_blank" rel="noopener"';
    ?>
    <div id="maleq-cover-box" style="font-size:13px;" data-post="<?php echo (int) $post->ID; ?>" data-nonce="<?php echo esc_attr($nonce); ?>">
        <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">
            <div style="flex:0 0 auto;">
                <p style="margin:0 0 4px;font-weight:600;">Current cover</p>
                <img id="maleq-cover-current" src="<?php echo esc_url($thumb ?: ''); ?>" alt=""
                     style="max-width:220px;height:auto;border:1px solid #dcdcde;border-radius:3px;<?php echo $thumb ? '' : 'display:none;'; ?>">
                <p id="maleq-cover-none" style="color:#646970;<?php echo $thumb ? 'display:none;' : ''; ?>">No cover yet.</p>
            </div>
            <div style="flex:1 1 320px;min-width:300px;">
                <p style="margin:0 0 6px;font-weight:600;">Browse a different image</p>
                <p style="margin:0 0 10px;">
                    <a href="<?php echo esc_url($pexels); ?>" <?php echo $btn; ?>>Pexels (stock)</a>
                    <a href="<?php echo esc_url($tmdb); ?>" <?php echo $btn; ?>>TMDB (film/TV)</a>
                    <a href="<?php echo esc_url($commons); ?>" <?php echo $btn; ?>>Wikimedia Commons</a>
                    <a href="<?php echo esc_url($openvers); ?>" <?php echo $btn; ?>>Openverse</a>
                    <a href="#" id="maleq-cover-reroll" class="button button-small">↻ Re-roll (auto-pick)</a>
                </p>
                <p style="margin:0 0 4px;">Image URL</p>
                <input type="url" id="maleq-cover-url" placeholder="https://… paste an image URL, or use Re-roll" style="width:100%;margin-bottom:8px;">
                <div style="display:flex;gap:8px;margin-bottom:8px;">
                    <input type="text" id="maleq-cover-credit" placeholder="Credit (optional)" style="flex:1 1 50%;">
                    <input type="url" id="maleq-cover-credit-url" placeholder="Credit link (optional)" style="flex:1 1 50%;">
                </div>
                <p style="margin:0 0 8px;">
                    <label><input type="checkbox" id="maleq-cover-overlay" checked> Add the headline overlay (like the auto covers)</label>
                </p>
                <p style="margin:0 0 6px;">
                    <a href="#" id="maleq-cover-set" class="button button-primary">Set as cover</a>
                    <span id="maleq-cover-status" style="margin-left:8px;color:#646970;"></span>
                </p>
                <p style="margin:0;color:#646970;">Preview:</p>
                <img id="maleq-cover-preview" src="" alt="" style="max-width:260px;height:auto;border:1px solid #dcdcde;border-radius:3px;display:none;margin-top:4px;">
            </div>
        </div>
    </div>
    <script>
    (function () {
        var box   = document.getElementById('maleq-cover-box');
        if (!box) { return; }
        var POST  = box.getAttribute('data-post');
        var NONCE = box.getAttribute('data-nonce');
        var urlIn = document.getElementById('maleq-cover-url');
        var credit = document.getElementById('maleq-cover-credit');
        var creditUrl = document.getElementById('maleq-cover-credit-url');
        var overlay = document.getElementById('maleq-cover-overlay');
        var status = document.getElementById('maleq-cover-status');
        var preview = document.getElementById('maleq-cover-preview');
        var shown = [];
        var last = {}; // last re-rolled candidate {url, source, licenseName, licenseUrl}

        function setStatus(t, busy) { status.textContent = t; status.style.color = busy ? '#646970' : (t.indexOf('✓') === 0 ? '#008a20' : '#646970'); }
        function showPreview() {
            var u = urlIn.value.trim();
            if (u) { preview.src = u; preview.style.display = ''; } else { preview.style.display = 'none'; }
        }
        urlIn.addEventListener('input', showPreview);

        function api(path, body) {
            return fetch('/wp-json/maleq/v1/' + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE },
                body: JSON.stringify(body)
            }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
        }

        document.getElementById('maleq-cover-reroll').addEventListener('click', function (e) {
            e.preventDefault();
            setStatus('Finding another image…', true);
            api('cover/reroll', { post_id: POST, exclude: shown }).then(function (res) {
                var j = res.j || {};
                if (!j.ok) { setStatus(j.message || 'No image found.'); return; }
                urlIn.value = j.url; showPreview(); shown.push(j.url);
                credit.value = j.credit || ''; creditUrl.value = j.creditUrl || '';
                last = { url: j.url, source: j.source || '', licenseName: j.licenseName || '', licenseUrl: j.licenseUrl || '' };
                setStatus('Suggested a ' + (j.source || 'new') + ' image — review, then Set as cover.');
            }).catch(function () { setStatus('Re-roll failed.'); });
        });

        document.getElementById('maleq-cover-set').addEventListener('click', function (e) {
            e.preventDefault();
            var u = urlIn.value.trim();
            if (!u) { setStatus('Paste an image URL first (or Re-roll).'); return; }
            setStatus('Importing…', true);
            var body = {
                post_id: POST, image_url: u, overlay: overlay.checked,
                credit: credit.value.trim(), credit_url: creditUrl.value.trim()
            };
            // Carry the source/license through ONLY when the URL is still the one we
            // re-rolled (so source-correct attribution applies; a hand-pasted URL stays generic).
            if (last.url && last.url === u) {
                body.source = last.source; body.license_name = last.licenseName; body.license_url = last.licenseUrl;
            }
            api('cover/set', body).then(function (res) {
                var j = res.j || {};
                if (!res.ok || !j.ok) { setStatus((j && j.message) || 'Import failed.'); return; }
                if (j.thumb) {
                    var img = document.getElementById('maleq-cover-current');
                    img.src = j.thumb + (j.thumb.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now();
                    img.style.display = '';
                    document.getElementById('maleq-cover-none').style.display = 'none';
                }
                // Sync the editor's featured-image state so a later "Update" doesn't revert it.
                if (j.att_id && window.wp && wp.data && wp.data.dispatch && wp.data.select('core/editor')) {
                    try { wp.data.dispatch('core/editor').editPost({ featured_media: parseInt(j.att_id, 10) }); } catch (e) {}
                }
                setStatus('✓ Cover updated' + (j.overlay ? ' (with overlay)' : ' (raw image)') + (j.deleted_old ? '; old cover removed.' : '.'));
            }).catch(function () { setStatus('Import failed.'); });
        });
    })();
    </script>
    <?php
}
