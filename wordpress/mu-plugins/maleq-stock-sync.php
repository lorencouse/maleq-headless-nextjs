<?php
/**
 * Plugin Name: Male Q Stock Sync
 * Description: REST API endpoints for bulk stock sync from headless frontend
 * Version: 1.0
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Verify admin API key from Authorization header.
 * Checks against MALEQ_ADMIN_KEY constant defined in wp-config.php.
 */
function maleq_stock_verify_admin_key(WP_REST_Request $request) {
    if (!defined('MALEQ_ADMIN_KEY') || empty(MALEQ_ADMIN_KEY)) {
        return new WP_Error(
            'not_configured',
            'MALEQ_ADMIN_KEY is not configured in wp-config.php',
            ['status' => 500]
        );
    }

    $auth_header = $request->get_header('authorization');
    if (!$auth_header || !hash_equals('Bearer ' . MALEQ_ADMIN_KEY, $auth_header)) {
        return new WP_Error(
            'unauthorized',
            'Invalid or missing Authorization header',
            ['status' => 401]
        );
    }

    return true;
}

/**
 * Register REST API endpoints
 */
add_action('rest_api_init', function () {
    // GET /wp-json/maleq/v1/stock-mapping
    register_rest_route('maleq/v1', '/stock-mapping', [
        'methods'             => 'GET',
        'callback'            => 'maleq_stock_mapping',
        'permission_callback' => 'maleq_stock_verify_admin_key',
    ]);

    // POST /wp-json/maleq/v1/stock-update
    register_rest_route('maleq/v1', '/stock-update', [
        'methods'             => 'POST',
        'callback'            => 'maleq_stock_update',
        'permission_callback' => 'maleq_stock_verify_admin_key',
    ]);
});

/**
 * GET /wp-json/maleq/v1/stock-mapping
 *
 * Returns all products with SKU, barcode, source, and stock info.
 * Used by the Vercel cron to build a mapping for stock updates.
 */
function maleq_stock_mapping(WP_REST_Request $request) {
    global $wpdb;

    $results = $wpdb->get_results("
        SELECT
            p.ID as id,
            MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) as sku,
            MAX(CASE WHEN pm.meta_key = '_wt_barcode' THEN pm.meta_value END) as barcode,
            MAX(CASE WHEN pm.meta_key = '_product_source' THEN pm.meta_value END) as source,
            MAX(CASE WHEN pm.meta_key = '_stock' THEN CAST(pm.meta_value AS SIGNED) END) as stock,
            MAX(CASE WHEN pm.meta_key = '_stock_status' THEN pm.meta_value END) as stock_status
        FROM {$wpdb->posts} p
        JOIN {$wpdb->postmeta} pm ON p.ID = pm.post_id
        WHERE p.post_type IN ('product', 'product_variation')
          AND p.post_status IN ('publish', 'draft', 'private')
        GROUP BY p.ID
        HAVING sku IS NOT NULL OR barcode IS NOT NULL
    ", ARRAY_A);

    if ($wpdb->last_error) {
        error_log('maleq-stock-sync: stock-mapping query failed: ' . $wpdb->last_error);
        return new WP_Error(
            'db_error',
            'Database query failed',
            ['status' => 500]
        );
    }

    // Cast numeric fields
    foreach ($results as &$row) {
        $row['id'] = (int) $row['id'];
        $row['stock'] = $row['stock'] !== null ? (int) $row['stock'] : null;
    }

    return new WP_REST_Response($results, 200);
}

/**
 * POST /wp-json/maleq/v1/stock-update
 *
 * Bulk update stock and/or meta fields.
 *
 * Request body:
 * {
 *   "updates": [
 *     { "id": 123, "stock": 42, "status": "instock" },
 *     { "id": 456, "meta_key": "wt_stock_count", "meta_value": "15" }
 *   ]
 * }
 *
 * - "stock" updates: sets _stock, _stock_status, and wp_wc_product_meta_lookup
 * - "meta_key" updates: sets arbitrary post meta (for wt_stock_count etc.)
 * - Max 500 updates per request
 */
function maleq_stock_update(WP_REST_Request $request) {
    global $wpdb;

    $body = $request->get_json_params();
    $updates = isset($body['updates']) ? $body['updates'] : [];

    if (empty($updates)) {
        return new WP_Error(
            'no_updates',
            'No updates provided',
            ['status' => 400]
        );
    }

    if (count($updates) > 500) {
        return new WP_Error(
            'too_many_updates',
            'Maximum 500 updates per request',
            ['status' => 400]
        );
    }

    $results = [
        'updated' => 0,
        'failed'  => 0,
        'errors'  => [],
    ];

    // Track parent variable products that need stock status recalculation
    $parent_ids_to_sync = [];

    foreach ($updates as $update) {
        $post_id = isset($update['id']) ? (int) $update['id'] : 0;
        if (!$post_id) {
            $results['failed']++;
            $results['errors'][] = 'Missing product ID';
            continue;
        }

        try {
            if (isset($update['stock'])) {
                // Stock update: _stock + _stock_status + lookup table
                $stock = (int) $update['stock'];
                $status = isset($update['status']) ? $update['status'] : ($stock > 0 ? 'instock' : 'outofstock');

                update_post_meta($post_id, '_stock', $stock);
                update_post_meta($post_id, '_stock_status', $status);

                // Update WooCommerce lookup table for performance
                $wpdb->update(
                    $wpdb->prefix . 'wc_product_meta_lookup',
                    [
                        'stock_quantity' => $stock,
                        'stock_status'   => $status,
                    ],
                    ['product_id' => $post_id],
                    ['%d', '%s'],
                    ['%d']
                );

                // If this is a variation, recalculate parent variable product stock status
                $post_type = get_post_type($post_id);
                if ($post_type === 'product_variation') {
                    $parent_id = wp_get_post_parent_id($post_id);
                    if ($parent_id) {
                        $parent_ids_to_sync[$parent_id] = true;
                    }
                }

                $results['updated']++;
            } elseif (isset($update['meta_key']) && isset($update['meta_value'])) {
                // Custom meta update (e.g., wt_stock_count)
                update_post_meta($post_id, $update['meta_key'], $update['meta_value']);
                $results['updated']++;
            } else {
                $results['failed']++;
                $results['errors'][] = "Invalid update for product $post_id: missing stock or meta_key/meta_value";
            }
        } catch (Exception $e) {
            $results['failed']++;
            $results['errors'][] = "Product $post_id: " . $e->getMessage();
        }
    }

    // Recalculate parent variable product stock status
    // Parent is 'instock' if ANY variation is instock, otherwise 'outofstock'
    foreach (array_keys($parent_ids_to_sync) as $parent_id) {
        $has_instock = $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$wpdb->posts} v
             INNER JOIN {$wpdb->postmeta} pm ON v.ID = pm.post_id AND pm.meta_key = '_stock_status'
             WHERE v.post_parent = %d AND v.post_type = 'product_variation'
               AND v.post_status = 'publish' AND pm.meta_value = 'instock'",
            $parent_id
        ));

        $parent_status = $has_instock > 0 ? 'instock' : 'outofstock';
        update_post_meta($parent_id, '_stock_status', $parent_status);

        $wpdb->update(
            $wpdb->prefix . 'wc_product_meta_lookup',
            ['stock_status' => $parent_status],
            ['product_id' => $parent_id],
            ['%s'],
            ['%d']
        );
    }

    if (!empty($parent_ids_to_sync)) {
        $results['parents_synced'] = count($parent_ids_to_sync);
    }

    // Truncate errors array to avoid massive responses
    if (count($results['errors']) > 20) {
        $total_errors = count($results['errors']);
        $results['errors'] = array_slice($results['errors'], 0, 20);
        $results['errors'][] = "... and " . ($total_errors - 20) . " more errors";
    }

    return new WP_REST_Response($results, 200);
}
