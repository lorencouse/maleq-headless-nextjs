<?php
/**
 * Plugin Name: MaleQ Stock Priority Ordering
 * Description: Orders WooCommerce products with in-stock items first, then by source priority (Williams Trading/manual before STC-only).
 * Version: 2.1.0
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Heuristic: query asks for at most $threshold rows. Used to skip the
 * expensive CASE WHEN sort for existence checks / single-row lookups where
 * curated ordering doesn't materially affect the answer.
 */
function maleq_query_has_small_limit($limits_clause, $threshold = 5) {
    if (empty($limits_clause)) return false;
    // Matches "LIMIT N" or "LIMIT offset, N"
    if (preg_match('/LIMIT\s+(?:\d+\s*,\s*)?(\d+)/i', $limits_clause, $m)) {
        return ((int)$m[1]) <= $threshold;
    }
    return false;
}

/**
 * Modify SQL clauses for product queries to prepend stock-status and source-priority ordering.
 *
 * Sort order:
 *   1. In-stock products first (stock_status = 'instock')
 *   2. Within same stock group: Williams Trading / manual (MUFFS) products before STC-only
 *   3. Original ordering (date DESC, etc.) preserved within each group
 *
 * Performance notes:
 *   - Skips the custom sort entirely for queries with small LIMITs — those are
 *     existence checks or single-row lookups where the curated order doesn't
 *     materially change the result and the CASE WHEN sort over 35K rows is
 *     pure waste (this was the dominant slow-query pattern: LIMIT 0,1).
 *   - Uses wp_wc_product_meta_lookup (indexed) for stock_status instead of wp_postmeta.
 *   - Only one wp_postmeta JOIN for _product_source.
 *   - Guards against duplicate joins via alias check.
 *   - Runs at priority 100 (after WooCommerce/WPGraphQL establish ORDER BY).
 */
add_filter('posts_clauses', function ($clauses, $query) {
    global $wpdb;

    // Only modify product queries - handle both string and array post_type (WPGraphQL compat)
    $post_type = $query->get('post_type');
    $is_product = false;
    if (is_array($post_type)) {
        $is_product = in_array('product', $post_type, true);
    } else {
        $is_product = ($post_type === 'product');
    }
    if (!$is_product) {
        return $clauses;
    }

    // Skip admin queries to avoid interfering with wp-admin
    if (is_admin() && !wp_doing_ajax() && !defined('GRAPHQL_REQUEST')) {
        return $clauses;
    }

    // Skip when LIMIT is tiny — existence checks / single-row lookups don't
    // benefit from the custom sort, and the CASE WHEN sort over the full
    // matching set is the single biggest source of slow queries here.
    if (maleq_query_has_small_limit($clauses['limits'] ?? '', 5)) {
        return $clauses;
    }

    // Guard against duplicate joins (e.g. if filter fires twice)
    if (strpos($clauses['join'], 'mq_stock_lookup') !== false) {
        return $clauses;
    }

    // Use wp_wc_product_meta_lookup for stock_status (indexed, fast)
    $lookup_table = $wpdb->prefix . 'wc_product_meta_lookup';
    $clauses['join'] .= " LEFT JOIN {$lookup_table} AS mq_stock_lookup ON ({$wpdb->posts}.ID = mq_stock_lookup.product_id)";

    // One wp_postmeta JOIN for _product_source
    $clauses['join'] .= " LEFT JOIN {$wpdb->postmeta} AS mq_source ON ({$wpdb->posts}.ID = mq_source.post_id AND mq_source.meta_key = '_product_source')";

    // Stock ordering: instock = 0 (first), everything else = 1 (last)
    $stock_order = "CASE WHEN mq_stock_lookup.stock_status = 'instock' THEN 0 ELSE 1 END ASC";

    // Source ordering: williams_trading/MUFFS = 0, mixed = 1, stc-only = 2, unknown = 1
    $source_order = "CASE
        WHEN mq_source.meta_value IN ('williams_trading', 'MUFFS') THEN 0
        WHEN mq_source.meta_value LIKE '%williams_trading%' THEN 1
        WHEN mq_source.meta_value = 'stc' THEN 2
        ELSE 1
    END ASC";

    // Prepend our ordering before the existing ORDER BY
    if (!empty($clauses['orderby'])) {
        $clauses['orderby'] = "{$stock_order}, {$source_order}, " . $clauses['orderby'];
    } else {
        $clauses['orderby'] = "{$stock_order}, {$source_order}";
    }

    // Mark this query so the SQL_CALC_FOUND_ROWS shim below can split the
    // count into a cheaper standalone COUNT(*) (no ORDER BY needed for count).
    $query->maleq_custom_sort = true;

    return $clauses;
}, 100, 2);

/**
 * Strip SQL_CALC_FOUND_ROWS from our heavy product queries; we provide the
 * total via a separate COUNT(*) below. The combination of SQL_CALC_FOUND_ROWS
 * with our expensive CASE WHEN sort forced MySQL to materialize and sort the
 * full matching set even for LIMIT 1 — this avoids that.
 */
add_filter('posts_request', function ($request, $query) {
    if (empty($query->maleq_custom_sort)) return $request;
    if (strpos($request, 'SQL_CALC_FOUND_ROWS') === false) return $request;
    return preg_replace('/^SELECT\s+SQL_CALC_FOUND_ROWS\s+/i', 'SELECT ', $request);
}, 100, 2);

/**
 * When we stripped SQL_CALC_FOUND_ROWS, do a cheaper standalone COUNT(*)
 * by rewriting WP's "SELECT FOUND_ROWS()" placeholder.
 */
add_filter('found_posts_query', function ($sql, $query) {
    if (empty($query->maleq_custom_sort) || empty($query->request)) return $sql;

    $req = $query->request;
    // Strip trailing LIMIT
    $req = preg_replace('/\s+LIMIT\s+\d+(?:\s*,\s*\d+)?\s*$/i', '', $req);
    // Strip ORDER BY (anything from ORDER BY to end)
    $req = preg_replace('/\s+ORDER\s+BY\s+.+$/is', '', $req);
    // Replace SELECT-list with COUNT(DISTINCT wp_posts.ID)
    $req = preg_replace('/^SELECT\s+.+?\s+FROM\s+/is', 'SELECT COUNT(DISTINCT wp_posts.ID) FROM ', $req);
    return $req;
}, 100, 2);
