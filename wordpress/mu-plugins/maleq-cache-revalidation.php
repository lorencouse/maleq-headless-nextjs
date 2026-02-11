<?php
/**
 * Plugin Name: Male Q Cache Revalidation
 * Description: Triggers Next.js cache revalidation when products are created, updated, or deleted.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) exit;

/**
 * Notify the Next.js frontend to revalidate its product cache.
 * Uses a non-blocking request so it doesn't slow down WordPress admin operations.
 */
function maleq_revalidate_frontend_cache($post_id, $type = 'product') {
    // Get frontend URL and secret from wp-config.php constants or options
    $frontend_url = defined('MALEQ_FRONTEND_URL') ? MALEQ_FRONTEND_URL : '';
    $secret = defined('MALEQ_REVALIDATION_SECRET') ? MALEQ_REVALIDATION_SECRET : '';

    if (empty($frontend_url) || empty($secret)) {
        return;
    }

    $slug = get_post_field('post_name', $post_id);

    wp_remote_post($frontend_url . '/api/revalidate', array(
        'headers' => array(
            'Content-Type' => 'application/json',
            'x-revalidation-secret' => $secret,
        ),
        'body' => wp_json_encode(array(
            'type' => $type,
            'slug' => $slug,
        )),
        'timeout' => 5,
        'blocking' => false,
    ));
}

/**
 * Hook into WooCommerce product save/update/delete events.
 */
function maleq_on_product_save($post_id) {
    if (get_post_type($post_id) !== 'product') return;
    if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) return;

    maleq_revalidate_frontend_cache($post_id, 'product');
}
add_action('save_post_product', 'maleq_on_product_save');

function maleq_on_product_update($product_id) {
    maleq_revalidate_frontend_cache($product_id, 'product');
}
add_action('woocommerce_update_product', 'maleq_on_product_update');

function maleq_on_product_delete($post_id) {
    if (get_post_type($post_id) !== 'product') return;
    maleq_revalidate_frontend_cache($post_id, 'product');
}
add_action('before_delete_post', 'maleq_on_product_delete');

/**
 * Also revalidate when product variations are updated.
 */
function maleq_on_variation_save($variation_id, $i = null) {
    $parent_id = wp_get_post_parent_id($variation_id);
    if ($parent_id) {
        maleq_revalidate_frontend_cache($parent_id, 'product');
    }
}
add_action('woocommerce_save_product_variation', 'maleq_on_variation_save', 10, 2);

/**
 * Revalidate when stock is updated (e.g., after an order).
 */
function maleq_on_stock_change($product) {
    if ($product && method_exists($product, 'get_id')) {
        $product_id = $product->get_id();
        if ($product->is_type('variation')) {
            $product_id = $product->get_parent_id();
        }
        maleq_revalidate_frontend_cache($product_id, 'product');
    }
}
add_action('woocommerce_product_set_stock', 'maleq_on_stock_change');
add_action('woocommerce_variation_set_stock', 'maleq_on_stock_change');
