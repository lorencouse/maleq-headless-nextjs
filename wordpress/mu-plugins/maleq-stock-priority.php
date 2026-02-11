<?php
/**
 * Plugin Name: MaleQ Stock Priority Ordering
 * Description: Orders WooCommerce products with in-stock items first, then by source priority (Williams Trading/manual before STC-only).
 * Version: 2.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Modify SQL clauses for product queries to prepend stock-status and source-priority ordering.
 *
 * Sort order:
 *   1. In-stock products first (stock_status = 'instock')
 *   2. Within same stock group: Williams Trading / manual (MUFFS) products before STC-only
 *   3. Original ordering (date DESC, etc.) preserved within each group
 *
 * Performance:
 *   - Uses wp_wc_product_meta_lookup (indexed) for stock_status instead of wp_postmeta
 *   - Only one wp_postmeta JOIN for _product_source
 *   - Guards against duplicate joins via alias check
 *   - Runs at priority 100 (after WooCommerce/WPGraphQL establish ORDER BY)
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

    return $clauses;
}, 100, 2);
