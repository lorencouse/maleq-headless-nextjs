<?php
/**
 * Plugin Name: Mark Products Source - MUFFS (One-Time)
 * Description: Adds _product_source meta to all existing products. Run once then delete this file.
 *
 * Usage: Visit /wp-admin/?mark_muffs_source=1 while logged in as admin
 */

add_action('admin_init', function() {
    if (!isset($_GET['mark_muffs_source']) || $_GET['mark_muffs_source'] !== '1') {
        return;
    }

    if (!current_user_can('manage_options')) {
        wp_die('Unauthorized');
    }

    global $wpdb;

    // Get all products and variations without a source
    $products = $wpdb->get_col("
        SELECT p.ID
        FROM {$wpdb->posts} p
        LEFT JOIN {$wpdb->postmeta} pm ON p.ID = pm.post_id AND pm.meta_key = '_product_source'
        WHERE p.post_type IN ('product', 'product_variation')
        AND p.post_status IN ('publish', 'draft', 'pending', 'private')
        AND pm.meta_id IS NULL
    ");

    $count = 0;
    foreach ($products as $product_id) {
        update_post_meta($product_id, '_product_source', 'MUFFS');
        $count++;
    }

    // Get total count for verification
    $total = $wpdb->get_var("
        SELECT COUNT(*)
        FROM {$wpdb->postmeta} pm
        INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id
        WHERE pm.meta_key = '_product_source'
        AND pm.meta_value = 'MUFFS'
        AND p.post_type = 'product'
    ");

    wp_die("
        <h2>Products Marked as MUFFS Source</h2>
        <p><strong>Updated:</strong> {$count} products/variations</p>
        <p><strong>Total products with MUFFS source:</strong> {$total}</p>
        <p style='color: green;'>✓ Done! You can now delete this mu-plugin file.</p>
        <p><a href='" . admin_url() . "'>← Back to Admin</a></p>
    ");
});
