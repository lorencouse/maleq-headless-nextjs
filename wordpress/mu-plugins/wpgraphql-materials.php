<?php
/**
 * Plugin Name: WPGraphQL Product Materials Support
 * Description: Registers Product Materials taxonomy with WPGraphQL for filtering products by material
 * Version: 1.0.0
 * Author: Maleq
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
 * Material normalization mapping
 * Maps variant names to canonical material names
 */
function get_material_normalization_map() {
    return [
        // ABS Plastic variants
        'abs' => 'ABS Plastic', 'abs / latex' => 'ABS Plastic', 'abs / pu' => 'ABS Plastic',
        'abs / silver plating' => 'ABS Plastic', 'abs plastic / rubber cote' => 'ABS Plastic',
        'abs plastic silver plating' => 'ABS Plastic', 'abs plastic with silver plating' => 'ABS Plastic',
        'abs silver plating' => 'ABS Plastic', 'abs with silver plating' => 'ABS Plastic', 'as' => 'ABS Plastic',

        // Aluminum variants
        'alumimum' => 'Aluminum', 'aluminium' => 'Aluminum', 'aluminum alloy' => 'Aluminum', 'alloy' => 'Aluminum',

        // TPE variants
        'thermoplastic elastomer' => 'TPE', 'thermoplastic elastomer tpe' => 'TPE',
        'thermoplastic elastomers' => 'TPE', 'thermoplastic elastomers tpe' => 'TPE',
        'fanta flesh tpe' => 'TPE', 'fanta flesh' => 'TPE',

        // TPR variants
        'thermoplastic rubber' => 'TPR', 'thermoplastic rubber tpr' => 'TPR',
        'thermoplastic rubber tpr abs plastic' => 'TPR', 'thermoplastic rubbertpr' => 'TPR',
        'thermoplastic elastomers tpr' => 'TPR', 'flextpr' => 'TPR', 'sensa feel tpr' => 'TPR',
        'senso tpr' => 'TPR', 'pure skin tpr' => 'TPR', 'pure skin thermoplastic rubber tpr' => 'TPR',
        'pure skin' => 'TPR', 'tpr blend' => 'TPR',

        // Silicone variants
        'silicone blend' => 'Silicone', 'silicone silk' => 'Silicone', 'pfblend silicone' => 'Silicone',
        'sil-a-gel' => 'Silicone', 'silaskin' => 'Silicone', 'si' => 'Silicone',

        // PVC variants
        'pvc plastic' => 'PVC', 'better-than-real pvc' => 'PVC',

        // Polyurethane variants
        'polyurethane pu' => 'Polyurethane', 'polyurethane pu rubber cote' => 'Polyurethane',
        'polyurethane sprayed over abs' => 'Polyurethane', 'pu' => 'Polyurethane',
        'pu coating' => 'Polyurethane', 'pu cote' => 'Polyurethane', 'tpu' => 'Polyurethane',

        // Faux Leather variants
        'pu faux leather' => 'Faux Leather', 'pu leather' => 'Faux Leather',
        'vegan leather' => 'Faux Leather', 'leatherette' => 'Faux Leather',

        // Polypropylene variants
        'pp' => 'Polypropylene', 'polypropylene pp' => 'Polypropylene', 'polyproplyene' => 'Polypropylene',
        'polyproylene pp' => 'Polypropylene', 'pp / gold plating' => 'Polypropylene',
        'pp fiber' => 'Polypropylene', 'pp. metal' => 'Polypropylene',

        // Polyester variants
        'poyester' => 'Polyester', 'polyester blend' => 'Polyester', 'polyester velvet' => 'Polyester',

        // Polycarbonate variants
        'polycarbonate pc' => 'Polycarbonate', 'pc' => 'Polycarbonate',

        // Glass variants
        'borosilicate glass' => 'Glass', 'glass fiber' => 'Glass', 'ffiberglass' => 'Fiberglass',

        // Steel variants
        'stainless steel' => 'Steel', 'anodized steel' => 'Steel', 'electro plated steel' => 'Steel',

        // Feather variants
        'feather' => 'Feathers', 'ostrich feather' => 'Feathers', 'turkey feathers' => 'Feathers',

        // Crystal variants
        'crystal' => 'Crystals',

        // Elastomer variants
        'elastomers' => 'Elastomer', 'elastan' => 'Elastomer', 'elastane' => 'Elastomer',
        'elastine' => 'Elastomer', 'sebs' => 'Elastomer',

        // Wax variants
        'microcrystalline wax' => 'Wax', 'paraffin wax' => 'Wax', 'parafin wax' => 'Wax',
        'soy wax' => 'Wax', 'synthetic wax' => 'Wax',

        // Nickel-free variants
        'nickel' => 'Nickel Free Metal', 'nickel free' => 'Nickel Free Metal',
        'nickel free alloy' => 'Nickel Free Metal', 'nickel free alloy metal' => 'Nickel Free Metal',

        // Bioskin variants
        'real skin' => 'Bioskin', 'ultraskyn' => 'Bioskin', 'vixskin' => 'Bioskin',

        // Misc
        'alkaline batteries' => 'Alkaline', 'anti-bacterial cleaner' => 'Antibacterial',
        'vinyln' => 'Vinyl', 'water-based' => 'Water',
    ];
}

/**
 * List of non-material terms to skip
 */
function get_excluded_materials() {
    return [
        'catalog', 'adult games', 'cuffs', 'luv cuffs', 'sexual enhancers', 'sensual enhancement',
        'shave cream', 'coochy shave cream', 'see ingredients in description', 'testers',
        'get lucky', 'earthly body - edible oil gift set', 'furry holiday bagathers', 'intramed',
        'kirite', 'kraft cheese', 'bath bomb', 'bath salts', 'cleaner', 'confetti', 'massage oil',
        'scented diffusers', 'synthetic urine', 'metallic dice', 'lidocaine', 'cbd', 'herbs',
        'mixed berry flavor', 'mint', 'honey', 'cocoa butter', 'royal jelly', 'shea butter',
        'vitamin e', 'aloe vera', 'aloe vera  - organic', 'natural', 'paperback book',
        'card stock paper', 'paper', 'sign', 'tape', 'paper plates',
    ];
}

/**
 * Normalize a material name to its canonical form
 */
function normalize_material_name($material) {
    $material = trim($material);
    if (empty($material)) return null;

    $lower = strtolower($material);

    // Check if it's an excluded non-material
    if (in_array($lower, get_excluded_materials())) {
        return null;
    }

    // Check normalization map
    $map = get_material_normalization_map();
    if (isset($map[$lower])) {
        return $map[$lower];
    }

    // Default: title case
    return ucwords($lower);
}

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
        // Normalize the material name
        $normalized = normalize_material_name($material);
        if (empty($normalized)) continue;

        // Create or get the term
        $term = term_exists($normalized, 'product_material');
        if (!$term) {
            $term = wp_insert_term($normalized, 'product_material');
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
 * Usage: ?migrate_materials=1
 * Reset: ?migrate_materials=reset
 */
add_action('admin_init', function() {
    if (!current_user_can('manage_options')) {
        return;
    }

    // Reset option
    if (isset($_GET['migrate_materials']) && $_GET['migrate_materials'] === 'reset') {
        delete_transient('material_migration_totals');
        add_action('admin_notices', function() {
            echo '<div class="notice notice-info"><p>Migration state reset. <a href="' . admin_url('index.php?migrate_materials=1') . '">Start fresh migration</a></p></div>';
        });
        return;
    }

    if (!isset($_GET['migrate_materials'])) {
        return;
    }

    $batch_size = 50;
    $offset = isset($_GET['offset']) ? intval($_GET['offset']) : 0;

    $products = get_posts([
        'post_type' => 'product',
        'posts_per_page' => $batch_size,
        'offset' => $offset,
        'post_status' => 'any',
        'fields' => 'ids',
        'orderby' => 'ID',
        'order' => 'ASC',
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

        $materials = preg_split('/[,\/]+/', $material_raw);
        $term_ids = [];

        foreach ($materials as $material) {
            $material = trim($material);
            if (empty($material)) continue;

            $material = ucwords(strtolower($material));

            $term = term_exists($material, 'product_material');
            if (!$term) {
                $term = wp_insert_term($material, 'product_material');
                if (!is_wp_error($term)) $terms_created++;
            }

            if (!is_wp_error($term)) {
                $term_id = is_array($term) ? $term['term_id'] : $term;
                $term_ids[] = (int)$term_id;
            }
        }

        if (!empty($term_ids)) {
            wp_set_object_terms($product_id, $term_ids, 'product_material', false);
            $migrated++;
        }

        clean_post_cache($product_id);
    }

    $new_offset = $offset + count($products);
    $has_more = count($products) === $batch_size;

    // Update running totals
    $totals = get_transient('material_migration_totals') ?: ['migrated' => 0, 'skipped' => 0, 'terms_created' => 0];
    $totals['migrated'] += $migrated;
    $totals['skipped'] += $skipped;
    $totals['terms_created'] += $terms_created;
    set_transient('material_migration_totals', $totals, HOUR_IN_SECONDS);

    if ($has_more) {
        // Show progress page with meta refresh (avoids redirect limit)
        $next_url = admin_url('index.php?migrate_materials=1&offset=' . $new_offset);
        add_action('admin_notices', function() use ($new_offset, $totals, $next_url) {
            echo '<div class="notice notice-info"><p>';
            echo "<strong>Migration in progress...</strong><br>";
            echo "Processed: {$new_offset} products<br>";
            echo "Migrated so far: {$totals['migrated']}<br>";
            echo "Terms created: {$totals['terms_created']}<br><br>";
            echo "<a href='" . esc_url($next_url) . "'>Click here if not auto-redirecting...</a>";
            echo '</p></div>';
            // Use meta refresh instead of redirect to avoid ERR_TOO_MANY_REDIRECTS
            echo '<meta http-equiv="refresh" content="1;url=' . esc_url($next_url) . '">';
        });
        return;
    } else {
        // Done - show results
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
