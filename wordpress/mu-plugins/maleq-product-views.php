<?php
/**
 * Plugin Name: Male Q Product Views
 * Description: Tracks product view counts and provides popularity scoring via REST API and WPGraphQL.
 *              Popularity score = views + (total_sales * 10) + (review_count * 10)
 * Version: 1.1
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Register REST API endpoints for view tracking
 */
add_action('rest_api_init', function () {
    // Increment view count (public — called from frontend on product page load)
    register_rest_route('maleq/v1', '/product-view', [
        'methods' => 'POST',
        'callback' => 'maleq_track_product_view',
        'permission_callback' => '__return_true',
        'args' => [
            'product_id' => [
                'required' => true,
                'type' => 'integer',
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);

    // Get top products by popularity score (public)
    register_rest_route('maleq/v1', '/trending-products', [
        'methods' => 'GET',
        'callback' => 'maleq_get_trending_products',
        'permission_callback' => '__return_true',
        'args' => [
            'limit' => [
                'default' => 12,
                'type' => 'integer',
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);
});

/**
 * Track a product view — increments _view_count meta
 */
function maleq_track_product_view(WP_REST_Request $request) {
    $product_id = $request->get_param('product_id');

    if (!$product_id || get_post_type($product_id) !== 'product') {
        return new WP_Error('invalid_product', 'Invalid product ID', ['status' => 400]);
    }

    $current = (int) get_post_meta($product_id, '_view_count', true);
    update_post_meta($product_id, '_view_count', $current + 1);

    return rest_ensure_response(['success' => true, 'views' => $current + 1]);
}

/**
 * Calculate popularity score for a product.
 * Score = views + (total_sales * 10) + (review_count * 10)
 */
function maleq_get_popularity_score($product_id) {
    $views = (int) get_post_meta($product_id, '_view_count', true);
    $sales = (int) get_post_meta($product_id, 'total_sales', true);

    // Get review count from comments
    $review_count = (int) get_comments([
        'post_id' => $product_id,
        'type' => 'review',
        'status' => 'approve',
        'count' => true,
    ]);

    return $views + ($sales * 10) + ($review_count * 10);
}

/**
 * Get trending products sorted by composite popularity score.
 * Uses a raw SQL query to compute: views + (total_sales * 10) + (review_count * 10)
 */
function maleq_get_trending_products(WP_REST_Request $request) {
    global $wpdb;

    $limit = min($request->get_param('limit'), 50);

    $results = $wpdb->get_results($wpdb->prepare("
        SELECT p.ID,
            COALESCE(views.meta_value + 0, 0)
            + (COALESCE(sales.meta_value + 0, 0) * 10)
            + (COALESCE(reviews.cnt, 0) * 10) AS popularity_score
        FROM {$wpdb->posts} p
        LEFT JOIN {$wpdb->postmeta} views
            ON views.post_id = p.ID AND views.meta_key = '_view_count'
        LEFT JOIN {$wpdb->postmeta} sales
            ON sales.post_id = p.ID AND sales.meta_key = 'total_sales'
        LEFT JOIN (
            SELECT comment_post_ID, COUNT(*) AS cnt
            FROM {$wpdb->comments}
            WHERE comment_type = 'review' AND comment_approved = '1'
            GROUP BY comment_post_ID
        ) reviews ON reviews.comment_post_ID = p.ID
        WHERE p.post_type = 'product'
            AND p.post_status = 'publish'
        HAVING popularity_score > 0
        ORDER BY popularity_score DESC
        LIMIT %d
    ", $limit));

    $product_ids = array_map(function ($row) {
        return (int) $row->ID;
    }, $results);

    return rest_ensure_response([
        'success' => true,
        'product_ids' => $product_ids,
        'total' => count($product_ids),
    ]);
}

/**
 * Register viewCount and popularityScore fields on WPGraphQL Product types
 */
add_action('graphql_register_types', function () {
    $product_types = ['SimpleProduct', 'VariableProduct', 'ExternalProduct', 'GroupProduct'];

    foreach ($product_types as $type) {
        register_graphql_field($type, 'viewCount', [
            'type' => 'Int',
            'description' => 'Number of times this product has been viewed',
            'resolve' => function ($product) {
                return (int) get_post_meta($product->databaseId, '_view_count', true);
            },
        ]);

        register_graphql_field($type, 'popularityScore', [
            'type' => 'Int',
            'description' => 'Composite popularity score: views + (sales * 10) + (reviews * 10)',
            'resolve' => function ($product) {
                return maleq_get_popularity_score($product->databaseId);
            },
        ]);
    }
});
