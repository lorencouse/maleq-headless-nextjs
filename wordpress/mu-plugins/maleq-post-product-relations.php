<?php
/**
 * Plugin Name: Male Q Post ⇄ Product Relations
 * Description: Adds an editor meta box to relate blog posts to specific products and
 *              product categories (one-to-many). Stored as ordered CSV in post meta so
 *              the Next.js frontend can read it via direct SQL and the order doubles as a
 *              ranking (used by the future "top 10" post generator).
 *
 *              Meta keys (protected, underscore-prefixed so they stay out of the default
 *              Custom Fields box):
 *                _maleq_related_products      → CSV of product post IDs, in display order
 *                _maleq_related_product_cats  → CSV of product_cat term IDs
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

const MALEQ_PPR_PRODUCTS_META = '_maleq_related_products';
const MALEQ_PPR_CATS_META     = '_maleq_related_product_cats';

/**
 * Register the meta box on the standard "post" editor screen.
 */
add_action('add_meta_boxes', function () {
    add_meta_box(
        'maleq_post_product_relations',
        __('Related Products & Categories', 'maleq'),
        'maleq_render_post_product_relations_box',
        'post',
        'normal',
        'high'
    );
});

/**
 * Enqueue WooCommerce's enhanced-select (select2 + AJAX product search) on the
 * post editor only. WC localizes the search nonce onto this handle, which the
 * `.wc-product-search` field below relies on.
 */
add_action('admin_enqueue_scripts', function ($hook) {
    if ($hook !== 'post.php' && $hook !== 'post-new.php') {
        return;
    }
    $screen = get_current_screen();
    if (!$screen || $screen->post_type !== 'post') {
        return;
    }
    if (function_exists('WC')) {
        wp_enqueue_script('wc-enhanced-select');
        wp_enqueue_style('woocommerce_admin_styles');
        wp_enqueue_style('select2');
    }
});

/**
 * Render the meta box UI.
 */
function maleq_render_post_product_relations_box($post) {
    wp_nonce_field('maleq_ppr_save', 'maleq_ppr_nonce');

    if (!function_exists('WC')) {
        echo '<p>' . esc_html__('WooCommerce is not active — product relations are unavailable.', 'maleq') . '</p>';
        return;
    }

    $product_ids = maleq_ppr_read_csv_ids(get_post_meta($post->ID, MALEQ_PPR_PRODUCTS_META, true));
    $cat_ids     = maleq_ppr_read_csv_ids(get_post_meta($post->ID, MALEQ_PPR_CATS_META, true));

    // ── Related products (AJAX search over the whole catalog) ──
    echo '<p><label for="maleq_related_products"><strong>' . esc_html__('Related products', 'maleq') . '</strong></label><br/>';
    echo '<span class="description">' . esc_html__('Search and add products. Selection order is preserved (top = first).', 'maleq') . '</span></p>';
    echo '<select class="wc-product-search" multiple="multiple" style="width:100%;" id="maleq_related_products" name="maleq_related_products[]" data-placeholder="' . esc_attr__('Search for a product…', 'maleq') . '" data-action="woocommerce_json_search_products" data-allow_clear="true">';
    foreach ($product_ids as $pid) {
        $product = wc_get_product($pid);
        if ($product) {
            printf(
                '<option value="%d" selected="selected">%s</option>',
                (int) $pid,
                esc_html(wp_strip_all_tags($product->get_formatted_name()))
            );
        }
    }
    echo '</select>';

    // ── Related product categories ──
    echo '<p style="margin-top:1.25em;"><label for="maleq_related_product_cats"><strong>' . esc_html__('Related product categories', 'maleq') . '</strong></label><br/>';
    echo '<span class="description">' . esc_html__('Categories to recommend alongside this post (and to surface this post on category products).', 'maleq') . '</span></p>';

    $terms = get_terms([
        'taxonomy'   => 'product_cat',
        'hide_empty' => false,
        'orderby'    => 'name',
    ]);
    echo '<select class="wc-enhanced-select" multiple="multiple" style="width:100%;" id="maleq_related_product_cats" name="maleq_related_product_cats[]" data-placeholder="' . esc_attr__('Select product categories…', 'maleq') . '">';
    if (!is_wp_error($terms)) {
        foreach ($terms as $term) {
            printf(
                '<option value="%d"%s>%s</option>',
                (int) $term->term_id,
                in_array((int) $term->term_id, $cat_ids, true) ? ' selected="selected"' : '',
                esc_html($term->name)
            );
        }
    }
    echo '</select>';
}

/**
 * Persist the relations on save and notify the Next.js frontend to revalidate.
 * The dynamic `save_post_post` hook fires only for the "post" post type.
 */
add_action('save_post_post', 'maleq_save_post_product_relations');
function maleq_save_post_product_relations($post_id) {
    if (!isset($_POST['maleq_ppr_nonce']) || !wp_verify_nonce($_POST['maleq_ppr_nonce'], 'maleq_ppr_save')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (wp_is_post_revision($post_id) || !current_user_can('edit_post', $post_id)) {
        return;
    }

    // Preserve user-selected order; de-dupe while keeping the first occurrence.
    $products = isset($_POST['maleq_related_products'])
        ? maleq_ppr_unique_ints(array_map('absint', (array) $_POST['maleq_related_products']))
        : [];
    $cats = isset($_POST['maleq_related_product_cats'])
        ? maleq_ppr_unique_ints(array_map('absint', (array) $_POST['maleq_related_product_cats']))
        : [];

    if ($products) {
        update_post_meta($post_id, MALEQ_PPR_PRODUCTS_META, implode(',', $products));
    } else {
        delete_post_meta($post_id, MALEQ_PPR_PRODUCTS_META);
    }

    if ($cats) {
        update_post_meta($post_id, MALEQ_PPR_CATS_META, implode(',', $cats));
    } else {
        delete_post_meta($post_id, MALEQ_PPR_CATS_META);
    }

    // Revalidate this guide page plus any referenced product pages so their
    // "Related Guides" lists update. Helper lives in maleq-cache-revalidation.php.
    if (function_exists('maleq_revalidate_frontend_cache')) {
        maleq_revalidate_frontend_cache($post_id, 'post');
        foreach ($products as $pid) {
            maleq_revalidate_frontend_cache($pid, 'product');
        }
    }
}

/**
 * Parse a stored CSV meta value into a clean list of positive ints (order kept).
 */
function maleq_ppr_read_csv_ids($value) {
    if (empty($value) || !is_string($value)) {
        return [];
    }
    return maleq_ppr_unique_ints(array_map('absint', explode(',', $value)));
}

/**
 * De-duplicate a list of ints, dropping zeros, preserving first-seen order.
 */
function maleq_ppr_unique_ints($ids) {
    $out = [];
    foreach ($ids as $id) {
        $id = (int) $id;
        if ($id > 0 && !in_array($id, $out, true)) {
            $out[] = $id;
        }
    }
    return $out;
}
