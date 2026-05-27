<?php
/**
 * Plugin Name: MaleQ Author Validation Cache
 * Description: Caches WP_User_Query has_published_posts + include lookups. WPGraphQL/WC trigger this query when resolving a post's author field; without caching it runs every request and scans 160k rows to return 1.
 * Version: 1.0.1
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Short-circuit WP_User_Query when it's the "is user X a published author?"
 * pattern. Caches the verified subset of include IDs for 5 minutes.
 *
 * The native query (DISTINCT wp_users.ID from wp_posts JOIN wp_users with an
 * OR'd post_type WHERE plus ORDER BY FIELD) examines ~160k rows per run.
 * Replaced with a single SELECT DISTINCT post_author scan that uses the
 * (post_type, post_status, post_author) composite index — ~1ms.
 */
add_filter('users_pre_query', function ($return, $query) {
    if (!$query instanceof WP_User_Query) return $return;
    $vars = $query->query_vars;

    if (empty($vars['has_published_posts']) || empty($vars['include'])) {
        return $return;
    }

    // Normalize has_published_posts. WP allows: true (= all public post types),
    // a string post type, or an array of post types. Casting `true` to (array)
    // gave `[true]`, which then matched no post_type and returned no users —
    // breaking author resolution in WPGraphQL.
    $raw_types = $vars['has_published_posts'];
    if ($raw_types === true) {
        $post_types = get_post_types(['public' => true]);
    } else {
        $post_types = (array)$raw_types;
    }
    $post_types = array_values(array_filter(array_map('strval', $post_types), function ($t) { return $t !== '' && $t !== '1'; }));

    $include_ids = array_values(array_filter(array_map('intval', (array)$vars['include']), function ($id) { return $id > 0; }));
    if (empty($include_ids) || empty($post_types)) return $return;

    sort($include_ids);
    sort($post_types);
    $fields = $vars['fields'] ?? 'all';
    $cache_key = 'mq_upub_' . md5(serialize([$post_types, $include_ids, $fields]));

    $cached = get_transient($cache_key);
    if ($cached !== false) {
        $query->total_users = is_array($cached) ? count($cached) : 0;
        return $cached;
    }

    // Compute the validated subset via an indexed query (no JOIN to wp_users).
    global $wpdb;
    $type_placeholders = implode(',', array_fill(0, count($post_types), '%s'));
    $id_placeholders = implode(',', array_fill(0, count($include_ids), '%d'));
    $args = array_merge($include_ids, $post_types);

    $valid_ids = array_map('intval', (array)$wpdb->get_col($wpdb->prepare(
        "SELECT DISTINCT post_author FROM {$wpdb->posts}
         WHERE post_author IN ($id_placeholders)
           AND post_status = 'publish'
           AND post_type IN ($type_placeholders)",
        $args
    )));

    if (empty($valid_ids)) {
        set_transient($cache_key, [], 5 * MINUTE_IN_SECONDS);
        $query->total_users = 0;
        return [];
    }

    // For ID-only fields (the common WPGraphQL author-resolution case),
    // we can return immediately. For other field shapes, defer to a normal
    // get_users() with the validated subset — which won't re-enter this
    // filter because it has no has_published_posts arg.
    if ($fields === 'ID' || $fields === 'ids') {
        set_transient($cache_key, $valid_ids, 5 * MINUTE_IN_SECONDS);
        $query->total_users = count($valid_ids);
        return $valid_ids;
    }

    $users = get_users([
        'include' => $valid_ids,
        'fields' => $fields,
        'orderby' => $vars['orderby'] ?? 'include',
        'order' => $vars['order'] ?? 'ASC',
    ]);
    set_transient($cache_key, $users, 5 * MINUTE_IN_SECONDS);
    $query->total_users = count($users);
    return $users;
}, 10, 2);

/**
 * Bust the cache when a published post is created/updated/trashed — a
 * previously-unpublished author may now be valid (or vice versa).
 */
add_action('transition_post_status', function ($new_status, $old_status, $post) {
    if ($new_status === 'publish' || $old_status === 'publish') {
        global $wpdb;
        $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_mq_upub_%' OR option_name LIKE '_transient_timeout_mq_upub_%'");
    }
}, 10, 3);
