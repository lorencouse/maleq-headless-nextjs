<?php
/**
 * Plugin Name: Male Q Brand & Manufacturer Meta
 * Description: Adds a manufacturer website URL + product-URL template to the product_brand taxonomy, and a per-product manufacturer-page override. Powers the "View on manufacturer's site" link and per-SKU manufacturer mapping in the headless frontend.
 * Version: 1.0.0
 *
 * Storage:
 *   wp_termmeta (product_brand term):
 *     - maleq_brand_website               Manufacturer homepage URL
 *     - maleq_brand_product_url_template  e.g. https://www.brand.com/p/{sku}  ({sku} is replaced by the product SKU)
 *   wp_postmeta (product):
 *     - _maleq_mfr_url                     Explicit manufacturer product-page URL (overrides the template)
 *
 * The frontend reads these via direct SQL (lib/db/taxonomy-loader.ts,
 * lib/db/product-queries.ts), so no GraphQL registration is required.
 */

if (!defined('ABSPATH')) {
    exit;
}

const MALEQ_BRAND_WEBSITE_KEY  = 'maleq_brand_website';
const MALEQ_BRAND_TEMPLATE_KEY = 'maleq_brand_product_url_template';
const MALEQ_PRODUCT_MFR_URL_KEY = '_maleq_mfr_url';

/* ─────────────────────────────────────────────────────────────────────────
 * Register term meta (sanitization + REST exposure)
 * ──────────────────────────────────────────────────────────────────────── */
add_action('init', function () {
    register_term_meta('product_brand', MALEQ_BRAND_WEBSITE_KEY, [
        'type'              => 'string',
        'single'            => true,
        'show_in_rest'      => true,
        'sanitize_callback' => 'esc_url_raw',
    ]);
    register_term_meta('product_brand', MALEQ_BRAND_TEMPLATE_KEY, [
        'type'              => 'string',
        'single'            => true,
        'show_in_rest'      => true,
        // Keep the {sku} placeholder intact — esc_url_raw would strip the braces.
        'sanitize_callback' => 'maleq_sanitize_url_template',
    ]);
});

/**
 * Sanitize a URL template that contains a {sku} placeholder.
 * Validates the URL with the placeholder swapped for a dummy token, then
 * restores the placeholder so it survives in storage.
 */
function maleq_sanitize_url_template($value) {
    $value = trim((string) $value);
    if ($value === '') {
        return '';
    }
    $probe = str_replace('{sku}', 'SKUPLACEHOLDER', $value);
    $clean = esc_url_raw($probe);
    return str_replace('SKUPLACEHOLDER', '{sku}', $clean);
}

/* ─────────────────────────────────────────────────────────────────────────
 * product_brand "Add new" form fields
 * ──────────────────────────────────────────────────────────────────────── */
add_action('product_brand_add_form_fields', function () {
    ?>
    <div class="form-field">
        <label for="<?php echo esc_attr(MALEQ_BRAND_WEBSITE_KEY); ?>">Manufacturer website</label>
        <input type="url" name="<?php echo esc_attr(MALEQ_BRAND_WEBSITE_KEY); ?>"
               id="<?php echo esc_attr(MALEQ_BRAND_WEBSITE_KEY); ?>"
               value="" placeholder="https://www.brand.com" />
        <p>The brand/manufacturer's official homepage. Shown on the brand page.</p>
    </div>
    <div class="form-field">
        <label for="<?php echo esc_attr(MALEQ_BRAND_TEMPLATE_KEY); ?>">Product URL template</label>
        <input type="text" name="<?php echo esc_attr(MALEQ_BRAND_TEMPLATE_KEY); ?>"
               id="<?php echo esc_attr(MALEQ_BRAND_TEMPLATE_KEY); ?>"
               value="" placeholder="https://www.brand.com/products/{sku}" />
        <p>Optional. Use <code>{sku}</code> where the product SKU goes. Used to build a per-product link to the manufacturer's page.</p>
    </div>
    <?php
});

/* ─────────────────────────────────────────────────────────────────────────
 * product_brand "Edit" form fields
 * ──────────────────────────────────────────────────────────────────────── */
add_action('product_brand_edit_form_fields', function ($term) {
    $website  = get_term_meta($term->term_id, MALEQ_BRAND_WEBSITE_KEY, true);
    $template = get_term_meta($term->term_id, MALEQ_BRAND_TEMPLATE_KEY, true);
    ?>
    <tr class="form-field">
        <th scope="row"><label for="<?php echo esc_attr(MALEQ_BRAND_WEBSITE_KEY); ?>">Manufacturer website</label></th>
        <td>
            <input type="url" name="<?php echo esc_attr(MALEQ_BRAND_WEBSITE_KEY); ?>"
                   id="<?php echo esc_attr(MALEQ_BRAND_WEBSITE_KEY); ?>"
                   value="<?php echo esc_attr($website); ?>" placeholder="https://www.brand.com" />
            <p class="description">The brand/manufacturer's official homepage. Shown on the brand page.</p>
        </td>
    </tr>
    <tr class="form-field">
        <th scope="row"><label for="<?php echo esc_attr(MALEQ_BRAND_TEMPLATE_KEY); ?>">Product URL template</label></th>
        <td>
            <input type="text" name="<?php echo esc_attr(MALEQ_BRAND_TEMPLATE_KEY); ?>"
                   id="<?php echo esc_attr(MALEQ_BRAND_TEMPLATE_KEY); ?>"
                   value="<?php echo esc_attr($template); ?>" placeholder="https://www.brand.com/products/{sku}" />
            <p class="description">Optional. Use <code>{sku}</code> where the product SKU goes. Used to build a per-product link to the manufacturer's page.</p>
        </td>
    </tr>
    <?php
});

/* ─────────────────────────────────────────────────────────────────────────
 * Save product_brand fields
 * ──────────────────────────────────────────────────────────────────────── */
function maleq_save_brand_meta($term_id) {
    if (isset($_POST[MALEQ_BRAND_WEBSITE_KEY])) {
        update_term_meta($term_id, MALEQ_BRAND_WEBSITE_KEY, esc_url_raw(wp_unslash($_POST[MALEQ_BRAND_WEBSITE_KEY])));
    }
    if (isset($_POST[MALEQ_BRAND_TEMPLATE_KEY])) {
        update_term_meta($term_id, MALEQ_BRAND_TEMPLATE_KEY, maleq_sanitize_url_template(wp_unslash($_POST[MALEQ_BRAND_TEMPLATE_KEY])));
    }
}
add_action('created_product_brand', 'maleq_save_brand_meta');
add_action('edited_product_brand', 'maleq_save_brand_meta');

/* ─────────────────────────────────────────────────────────────────────────
 * Per-product manufacturer-URL override (WooCommerce product data → Advanced)
 * ──────────────────────────────────────────────────────────────────────── */
add_action('init', function () {
    register_post_meta('product', MALEQ_PRODUCT_MFR_URL_KEY, [
        'type'              => 'string',
        'single'            => true,
        'show_in_rest'      => true,
        'sanitize_callback' => 'esc_url_raw',
        'auth_callback'     => function () { return current_user_can('edit_products'); },
    ]);
});

add_action('woocommerce_product_options_advanced', function () {
    woocommerce_wp_text_input([
        'id'          => MALEQ_PRODUCT_MFR_URL_KEY,
        'label'       => 'Manufacturer page URL',
        'placeholder' => 'Auto-built from the brand template if left blank',
        'desc_tip'    => true,
        'description' => 'Direct link to this product on the manufacturer\'s website. Overrides the brand\'s product-URL template. For internal reference.',
        'type'        => 'url',
    ]);
});

add_action('woocommerce_process_product_meta', function ($post_id) {
    if (isset($_POST[MALEQ_PRODUCT_MFR_URL_KEY])) {
        update_post_meta($post_id, MALEQ_PRODUCT_MFR_URL_KEY, esc_url_raw(wp_unslash($_POST[MALEQ_PRODUCT_MFR_URL_KEY])));
    }
});
