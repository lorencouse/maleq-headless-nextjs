<?php
/**
 * Plugin Name: Male Q Post Translations
 * Description: Adds an editor meta box to link a guide (blog post) to its
 *              sibling-language versions (English ⇄ Español ⇄ 中文 ⇄ 日本語).
 *              The site has no multilingual plugin — language is encoded by the
 *              post's top-level "language" category (en / espanol / cn /
 *              日本語-japanese) and the original↔translation links live here.
 *
 *              The chosen translations are stored as ordered CSV in a single
 *              protected meta key so the Next.js frontend can read them via
 *              direct SQL (lib/db/post-translations.ts) and render a language
 *              switcher + hreflang tags:
 *
 *                _maleq_translations → CSV of sibling post IDs (the post's set)
 *
 *              On save the set is reconciled symmetrically: every post you pick
 *              is updated to point back at the whole group, so a single 1-hop
 *              lookup yields a complete switcher on any post in the group.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

const MALEQ_TR_META = '_maleq_translations';

/**
 * Root "language" category slugs → display label. Mirrors
 * lib/i18n/guide-languages.ts. WordPress stores CJK slugs URL-encoded, so the
 * Japanese root appears in both encoded and decoded forms.
 */
function maleq_tr_language_labels() {
    return [
        'en'                                   => 'English',
        'espanol'                              => 'Español',
        'cn'                                   => '中文',
        '%e6%97%a5%e6%9c%ac%e8%aa%9e-japanese' => '日本語',
        '日本語-japanese'                       => '日本語',
    ];
}

/** Register the meta box on the standard "post" editor screen. */
add_action('add_meta_boxes', function () {
    add_meta_box(
        'maleq_post_translations',
        __('Translations', 'maleq'),
        'maleq_render_post_translations_box',
        'post',
        'side',
        'default'
    );
});

/**
 * Build a map of published post ID → root-language slug in one query, so the
 * meta box can group the picker options by language without N lookups.
 *
 * @return array<int,string> post ID → root language slug ('' if none)
 */
function maleq_tr_post_language_map() {
    global $wpdb;
    $slugs = array_keys(maleq_tr_language_labels());
    $in    = implode(',', array_fill(0, count($slugs), '%s'));

    // One row per (post, matching-root-category); posts have at most one root.
    $sql = $wpdb->prepare(
        "SELECT p.ID, t.slug
           FROM {$wpdb->posts} p
           JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
           JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
           JOIN {$wpdb->terms} t ON t.term_id = tt.term_id
          WHERE p.post_type = 'post' AND p.post_status = 'publish'
            AND t.slug IN ($in)",
        $slugs
    );

    $map = [];
    foreach ($wpdb->get_results($sql) as $row) {
        $map[(int) $row->ID] = $row->slug;
    }
    return $map;
}

/** Render the meta box UI: a language-grouped multi-select of other posts. */
function maleq_render_post_translations_box($post) {
    wp_nonce_field('maleq_tr_save', 'maleq_tr_nonce');

    $labels    = maleq_tr_language_labels();
    $lang_map  = maleq_tr_post_language_map();
    $selected  = maleq_tr_read_csv_ids(get_post_meta($post->ID, MALEQ_TR_META, true));
    $selected_lookup = array_flip($selected);

    // All published posts except the current one, newest first.
    $posts = get_posts([
        'post_type'      => 'post',
        'post_status'    => 'publish',
        'posts_per_page' => -1,
        'orderby'        => 'date',
        'order'          => 'DESC',
        'exclude'        => [$post->ID],
        'fields'         => 'ids',
    ]);

    // Group post IDs by language so the picker shows <optgroup>s.
    $groups = [];                 // label => [ [id,title], ... ]
    $other_label = __('Other / no language', 'maleq');
    foreach ($posts as $pid) {
        $slug  = isset($lang_map[$pid]) ? $lang_map[$pid] : '';
        $label = ($slug !== '' && isset($labels[$slug])) ? $labels[$slug] : $other_label;
        $groups[$label][] = [$pid, get_the_title($pid)];
    }

    // Show the known languages first, in canonical order, then "Other".
    $order = ['English', 'Español', '中文', '日本語', $other_label];
    uksort($groups, function ($a, $b) use ($order) {
        $ia = array_search($a, $order, true);
        $ib = array_search($b, $order, true);
        $ia = ($ia === false) ? PHP_INT_MAX : $ia;
        $ib = ($ib === false) ? PHP_INT_MAX : $ib;
        return $ia <=> $ib;
    });

    echo '<p class="description">' . esc_html__('Link this guide to its versions in other languages. Selecting them here keeps every linked post pointing back, so the language switcher stays in sync.', 'maleq') . '</p>';

    echo '<select id="maleq_translations" name="maleq_translations[]" multiple="multiple" class="maleq-translation-select" style="width:100%;min-height:160px;" data-placeholder="' . esc_attr__('Search posts to link…', 'maleq') . '">';
    foreach ($groups as $label => $items) {
        echo '<optgroup label="' . esc_attr($label) . '">';
        foreach ($items as $item) {
            list($pid, $title) = $item;
            printf(
                '<option value="%d"%s>%s</option>',
                (int) $pid,
                isset($selected_lookup[$pid]) ? ' selected="selected"' : '',
                esc_html($title !== '' ? $title : sprintf('#%d', $pid))
            );
        }
        echo '</optgroup>';
    }
    echo '</select>';

    // Progressively enhance with select2 if it's registered (e.g. WooCommerce
    // present); the native multi-select is a fine fallback otherwise.
    if (wp_script_is('select2', 'registered')) {
        wp_enqueue_script('select2');
        wp_enqueue_style('select2');
        add_action('admin_print_footer_scripts', function () {
            echo '<script>jQuery(function($){if($.fn.select2){$("#maleq_translations").select2({width:"100%"});}});</script>';
        });
    }
}

/**
 * Persist the translation links on save, reconciling the group symmetrically,
 * and notify the Next.js frontend to revalidate every affected guide page.
 *
 * The dynamic `save_post_post` hook fires only for the "post" post type.
 */
add_action('save_post_post', 'maleq_save_post_translations');
function maleq_save_post_translations($post_id) {
    if (!isset($_POST['maleq_tr_nonce']) || !wp_verify_nonce($_POST['maleq_tr_nonce'], 'maleq_tr_save')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (wp_is_post_revision($post_id) || !current_user_can('edit_post', $post_id)) {
        return;
    }

    $post_id = (int) $post_id;

    // Editor's intended translation set for THIS post (excludes self, de-duped).
    $new_set = isset($_POST['maleq_translations'])
        ? maleq_tr_unique_ints(array_map('absint', (array) $_POST['maleq_translations']))
        : [];
    $new_set = array_values(array_filter($new_set, fn($id) => $id !== $post_id));

    $old_set = maleq_tr_read_csv_ids(get_post_meta($post_id, MALEQ_TR_META, true));

    // The full group defined by this save: this post + everything it links to.
    $group = array_merge([$post_id], $new_set);

    // Every member references all other members.
    foreach ($group as $member) {
        $siblings = maleq_tr_unique_ints(array_values(array_filter($group, fn($id) => $id !== $member)));
        maleq_tr_write_ids($member, $siblings);
    }

    // Posts dropped from the set: strip the whole group (incl. this post) from
    // their list so the relationship stays symmetric.
    $removed = array_diff($old_set, $new_set);
    foreach ($removed as $r) {
        $r = (int) $r;
        if (in_array($r, $group, true)) {
            continue; // still in the group; already handled above
        }
        $list = maleq_tr_read_csv_ids(get_post_meta($r, MALEQ_TR_META, true));
        $list = array_values(array_diff($list, $group));
        maleq_tr_write_ids($r, $list);
    }

    // Revalidate this guide plus every post whose links changed.
    if (function_exists('maleq_revalidate_frontend_cache')) {
        $touched = maleq_tr_unique_ints(array_merge($group, array_map('intval', $removed)));
        foreach ($touched as $pid) {
            maleq_revalidate_frontend_cache($pid, 'post');
        }
    }
}

/** Write (or delete) the CSV translation list for a post. */
function maleq_tr_write_ids($post_id, array $ids) {
    $ids = maleq_tr_unique_ints($ids);
    if ($ids) {
        update_post_meta($post_id, MALEQ_TR_META, implode(',', $ids));
    } else {
        delete_post_meta($post_id, MALEQ_TR_META);
    }
}

/** Parse a stored CSV meta value into a clean list of positive ints (order kept). */
function maleq_tr_read_csv_ids($value) {
    if (empty($value) || !is_string($value)) {
        return [];
    }
    return maleq_tr_unique_ints(array_map('absint', explode(',', $value)));
}

/** De-duplicate a list of ints, dropping zeros, preserving first-seen order. */
function maleq_tr_unique_ints($ids) {
    $out = [];
    foreach ($ids as $id) {
        $id = (int) $id;
        if ($id > 0 && !in_array($id, $out, true)) {
            $out[] = $id;
        }
    }
    return $out;
}
