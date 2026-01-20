<?php
/**
 * Plugin Name: WPGraphQL Product Materials Support
 * Description: Registers Product Materials taxonomy with WPGraphQL for filtering products by material
 * Version: 1.0.0
 * Author: Maleq
 *
 * Add this file to wp-content/mu-plugins/ for automatic loading.
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

// Register the product_material taxonomy
add_action('init', function() {
    $labels = array(
        'name'              => 'Materials',
        'singular_name'     => 'Material',
        'search_items'      => 'Search Materials',
        'all_items'         => 'All Materials',
        'parent_item'       => 'Parent Material',
        'parent_item_colon' => 'Parent Material:',
        'edit_item'         => 'Edit Material',
        'update_item'       => 'Update Material',
        'add_new_item'      => 'Add New Material',
        'new_item_name'     => 'New Material Name',
        'menu_name'         => 'Materials',
    );

    $args = array(
        'hierarchical'      => false,
        'labels'            => $labels,
        'show_ui'           => true,
        'show_admin_column' => true,
        'query_var'         => true,
        'rewrite'           => array('slug' => 'product-material'),
        'show_in_rest'      => true,
        // WPGraphQL settings
        'show_in_graphql'     => true,
        'graphql_single_name' => 'productMaterial',
        'graphql_plural_name' => 'productMaterials',
    );

    register_taxonomy('product_material', array('product'), $args);
});

/**
 * Auto-assign product_material taxonomy terms when _wt_material meta is saved
 * This handles both REST API imports and manual edits
 */
add_action('woocommerce_process_product_meta', 'auto_assign_material_taxonomy', 20, 1);
add_action('woocommerce_rest_insert_product_object', 'auto_assign_material_taxonomy_rest', 20, 1);

function auto_assign_material_taxonomy($product_id) {
    $material_raw = get_post_meta($product_id, '_wt_material', true);

    if (empty($material_raw)) {
        return;
    }

    // Split comma-separated materials
    $materials = preg_split('/[,\/]+/', $material_raw);
    $term_ids = [];

    foreach ($materials as $material) {
        $material = trim($material);
        if (empty($material)) continue;

        // Normalize material name (title case)
        $material = ucwords(strtolower($material));

        // Create or get the term
        $term = term_exists($material, 'product_material');
        if (!$term) {
            $term = wp_insert_term($material, 'product_material');
        }

        if (!is_wp_error($term)) {
            $term_id = is_array($term) ? $term['term_id'] : $term;
            $term_ids[] = (int)$term_id;
        }
    }

    // Assign terms to product
    if (!empty($term_ids)) {
        wp_set_object_terms($product_id, $term_ids, 'product_material', false);
    }
}

function auto_assign_material_taxonomy_rest($product) {
    auto_assign_material_taxonomy($product->get_id());
}

// Add productMaterials connection to Product type
add_action('graphql_register_types', function() {
    // Check if WPGraphQL and WooGraphQL are active
    if (!class_exists('WPGraphQL') || !class_exists('WPGraphQL\WooCommerce\WooCommerce')) {
        return;
    }

    register_graphql_connection([
        'fromType' => 'Product',
        'toType' => 'ProductMaterial',
        'fromFieldName' => 'productMaterials',
        'connectionTypeName' => 'ProductToProductMaterialConnection',
        'resolve' => function($product, $args, $context, $info) {
            $resolver = new \WPGraphQL\Data\Connection\TermObjectConnectionResolver($product, $args, $context, $info, 'product_material');
            return $resolver->get_connection();
        }
    ]);
});

/**
 * Utility function to migrate existing _wt_material meta to taxonomy terms
 * Processes in batches to avoid memory issues.
 *
 * Usage:
 *   - Start: ?migrate_materials=1
 *   - Continue: ?migrate_materials=1&offset=100 (auto-redirects)
 */
add_action('admin_init', function() {
    if (!isset($_GET['migrate_materials']) || !current_user_can('manage_options')) {
        return;
    }

    $batch_size = 100;
    $offset = isset($_GET['offset']) ? intval($_GET['offset']) : 0;

    // Get total count first
    $total_products = wp_count_posts('product')->publish + wp_count_posts('product')->draft;

    $products = get_posts([
        'post_type' => 'product',
        'posts_per_page' => $batch_size,
        'offset' => $offset,
        'post_status' => 'any',
        'fields' => 'ids', // Only get IDs to save memory
    ]);

    $migrated = 0;
    $skipped = 0;
    $terms_created = 0;

    foreach ($products as $product_id) {
        $material_raw = get_post_meta($product_id, '_wt_material', true);

        if (empty($material_raw)) {
            $skipped++;
            continue;
        }

        // Split comma-separated materials
        $materials = preg_split('/[,\/]+/', $material_raw);
        $term_ids = [];

        foreach ($materials as $material) {
            $material = trim($material);
            if (empty($material)) {
                continue;
            }

            // Normalize material name (title case)
            $material = ucwords(strtolower($material));

            // Create or get the term
            $term = term_exists($material, 'product_material');
            if (!$term) {
                $term = wp_insert_term($material, 'product_material');
                if (!is_wp_error($term)) {
                    $terms_created++;
                }
            }

            if (!is_wp_error($term)) {
                $term_id = is_array($term) ? $term['term_id'] : $term;
                $term_ids[] = (int)$term_id;
            }
        }

        // Assign all material terms to the product
        if (!empty($term_ids)) {
            wp_set_object_terms($product_id, $term_ids, 'product_material', false);
            $migrated++;
        }

        // Clear cache for this product to free memory
        clean_post_cache($product_id);
    }

    $processed = $offset + count($products);
    $has_more = count($products) === $batch_size;

    // Store running totals in transient
    $running_totals = get_transient('material_migration_totals') ?: ['migrated' => 0, 'skipped' => 0, 'terms_created' => 0];
    $running_totals['migrated'] += $migrated;
    $running_totals['skipped'] += $skipped;
    $running_totals['terms_created'] += $terms_created;
    set_transient('material_migration_totals', $running_totals, HOUR_IN_SECONDS);

    if ($has_more) {
        // Redirect to next batch - use current URL as base
        $next_url = admin_url('index.php') . '?migrate_materials=1&offset=' . $processed;

        add_action('admin_notices', function() use ($processed, $total_products, $next_url) {
            echo '<div class="notice notice-info"><p>';
            echo "Processing... {$processed} / ~{$total_products} products. ";
            echo "<a href='" . esc_url($next_url) . "'>Continue migration</a> (or wait for auto-redirect)";
            echo '</p></div>';
            echo "<script>setTimeout(function(){ window.location.href = '" . esc_url($next_url) . "'; }, 1000);</script>";
        });
    } else {
        // Migration complete
        $totals = $running_totals;
        delete_transient('material_migration_totals');

        add_action('admin_notices', function() use ($totals) {
            echo '<div class="notice notice-success"><p>';
            echo "<strong>Material migration complete!</strong><br>";
            echo "Products migrated: {$totals['migrated']}<br>";
            echo "Products skipped (no material): {$totals['skipped']}<br>";
            echo "New terms created: {$totals['terms_created']}";
            echo '</p></div>';
        });
    }
});
