<?php
/**
 * Plugin Name: Wholesale Price Display
 * Description: Displays wholesale price in WooCommerce variation edit panels
 * Version: 1.0
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Add wholesale price field to variation options
 */
add_action('woocommerce_variation_options_pricing', 'display_wholesale_price_in_variation', 10, 3);

function display_wholesale_price_in_variation($loop, $variation_data, $variation) {
    $wholesale_price = get_post_meta($variation->ID, 'wt_wholesale_price', true);

    if ($wholesale_price) {
        ?>
        <p class="form-row form-row-first">
            <label style="color: #0073aa; font-weight: bold;">
                Wholesale Price:
                <span style="font-size: 14px; color: #d63638;">$<?php echo esc_html(number_format((float)$wholesale_price, 2)); ?></span>
            </label>
        </p>
        <?php
    }
}

/**
 * Add wholesale price to simple product pricing section
 */
add_action('woocommerce_product_options_pricing', 'display_wholesale_price_in_simple_product');

function display_wholesale_price_in_simple_product() {
    global $post;
    $wholesale_price = get_post_meta($post->ID, 'wt_wholesale_price', true);

    if ($wholesale_price) {
        ?>
        <p class="form-field">
            <label style="color: #0073aa; font-weight: bold;">Wholesale Price</label>
            <span style="font-size: 14px; color: #d63638; font-weight: bold; padding: 5px 0; display: inline-block;">
                $<?php echo esc_html(number_format((float)$wholesale_price, 2)); ?>
            </span>
        </p>
        <?php
    }
}
