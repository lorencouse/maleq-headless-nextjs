<?php
/**
 * Headless URL Rewrite for Male Q
 *
 * Rewrites WordPress-generated URLs to point to the headless Next.js frontend.
 * This ensures that links in the Gutenberg editor, content, and anywhere else
 * WordPress generates URLs will use the correct headless site paths.
 *
 * URL Mappings:
 * - Products: /product/{slug} -> /shop/product/{slug}
 * - Product Categories: /product-category/{slug} -> /shop/category/{slug}
 * - Blog Posts: /{slug} or /blog/{slug} -> /blog/{slug}
 * - Blog Categories: /category/{slug} -> /blog/category/{slug}
 *
 * Installation:
 * 1. Add this code to your theme's functions.php
 * 2. Or install as a mu-plugin in wp-content/mu-plugins/
 * 3. Or use a code snippets plugin
 *
 * Configuration:
 * Set HEADLESS_FRONTEND_URL constant or it will default to site URL
 */

// Define the headless frontend URL (change this to your production URL)
if (!defined('HEADLESS_FRONTEND_URL')) {
    // Use environment variable if available, otherwise use site URL
    define('HEADLESS_FRONTEND_URL', getenv('HEADLESS_FRONTEND_URL') ?: get_site_url());
}

/**
 * Rewrite WooCommerce product permalinks
 * Changes /product/{slug} to /shop/product/{slug}
 */
add_filter('post_type_link', 'maleq_rewrite_product_permalink', 10, 2);
function maleq_rewrite_product_permalink($permalink, $post) {
    if ($post->post_type !== 'product') {
        return $permalink;
    }

    $headless_url = rtrim(HEADLESS_FRONTEND_URL, '/');
    return $headless_url . '/shop/product/' . $post->post_name;
}

/**
 * Rewrite product category permalinks
 * Changes /product-category/{slug} to /shop/category/{slug}
 */
add_filter('term_link', 'maleq_rewrite_term_permalink', 10, 3);
function maleq_rewrite_term_permalink($termlink, $term, $taxonomy) {
    $headless_url = rtrim(HEADLESS_FRONTEND_URL, '/');

    // Product categories
    if ($taxonomy === 'product_cat') {
        return $headless_url . '/shop/category/' . $term->slug;
    }

    // Product brands
    if ($taxonomy === 'product_brand') {
        return $headless_url . '/shop?brand=' . $term->slug;
    }

    // Product materials
    if ($taxonomy === 'product_material') {
        return $headless_url . '/shop?material=' . $term->slug;
    }

    // Blog categories
    if ($taxonomy === 'category') {
        return $headless_url . '/blog/category/' . $term->slug;
    }

    // Blog tags
    if ($taxonomy === 'post_tag') {
        return $headless_url . '/blog/tag/' . $term->slug;
    }

    return $termlink;
}

/**
 * Rewrite blog post permalinks
 * Changes various formats to /blog/{slug}
 */
add_filter('post_link', 'maleq_rewrite_post_permalink', 10, 2);
function maleq_rewrite_post_permalink($permalink, $post) {
    if ($post->post_type !== 'post') {
        return $permalink;
    }

    $headless_url = rtrim(HEADLESS_FRONTEND_URL, '/');
    return $headless_url . '/blog/' . $post->post_name;
}

/**
 * Rewrite page permalinks
 */
add_filter('page_link', 'maleq_rewrite_page_permalink', 10, 2);
function maleq_rewrite_page_permalink($permalink, $post_id) {
    $post = get_post($post_id);
    if (!$post) {
        return $permalink;
    }

    $headless_url = rtrim(HEADLESS_FRONTEND_URL, '/');

    // Map specific pages to headless routes
    $page_mappings = [
        'shop' => '/shop',
        'cart' => '/cart',
        'checkout' => '/checkout',
        'my-account' => '/account',
        'wishlist' => '/account/wishlist',
        'contact' => '/contact',
        'about' => '/about',
        'faq' => '/faq',
        'privacy-policy' => '/privacy-policy',
        'terms-of-service' => '/terms-of-service',
        'shipping-returns' => '/shipping-returns',
    ];

    if (isset($page_mappings[$post->post_name])) {
        return $headless_url . $page_mappings[$post->post_name];
    }

    // Default: use the page slug
    return $headless_url . '/' . $post->post_name;
}

/**
 * Add headless URL to WPGraphQL Product type
 * This exposes a 'headlessUrl' field in GraphQL queries
 */
add_action('graphql_register_types', 'maleq_register_headless_url_field');
function maleq_register_headless_url_field() {
    $headless_url = rtrim(HEADLESS_FRONTEND_URL, '/');

    // Add headlessUrl to Product
    register_graphql_field('Product', 'headlessUrl', [
        'type' => 'String',
        'description' => 'URL to the product on the headless frontend',
        'resolve' => function($product) use ($headless_url) {
            return $headless_url . '/shop/product/' . $product->slug;
        }
    ]);

    // Add headlessUrl to SimpleProduct
    register_graphql_field('SimpleProduct', 'headlessUrl', [
        'type' => 'String',
        'description' => 'URL to the product on the headless frontend',
        'resolve' => function($product) use ($headless_url) {
            return $headless_url . '/shop/product/' . $product->slug;
        }
    ]);

    // Add headlessUrl to VariableProduct
    register_graphql_field('VariableProduct', 'headlessUrl', [
        'type' => 'String',
        'description' => 'URL to the product on the headless frontend',
        'resolve' => function($product) use ($headless_url) {
            return $headless_url . '/shop/product/' . $product->slug;
        }
    ]);

    // Add headlessUrl to ProductCategory
    register_graphql_field('ProductCategory', 'headlessUrl', [
        'type' => 'String',
        'description' => 'URL to the category on the headless frontend',
        'resolve' => function($term) use ($headless_url) {
            return $headless_url . '/shop/category/' . $term->slug;
        }
    ]);

    // Add headlessUrl to Post (blog)
    register_graphql_field('Post', 'headlessUrl', [
        'type' => 'String',
        'description' => 'URL to the post on the headless frontend',
        'resolve' => function($post) use ($headless_url) {
            return $headless_url . '/blog/' . $post->slug;
        }
    ]);

    // Add headlessUrl to Category (blog categories)
    register_graphql_field('Category', 'headlessUrl', [
        'type' => 'String',
        'description' => 'URL to the category on the headless frontend',
        'resolve' => function($term) use ($headless_url) {
            return $headless_url . '/blog/category/' . $term->slug;
        }
    ]);
}

/**
 * Filter content to replace old WordPress URLs with headless URLs
 * This catches any hardcoded URLs in post content
 */
add_filter('the_content', 'maleq_replace_content_urls', 20);
function maleq_replace_content_urls($content) {
    $site_url = get_site_url();
    $headless_url = rtrim(HEADLESS_FRONTEND_URL, '/');

    // If headless URL is same as site URL, no replacement needed
    if ($site_url === $headless_url) {
        return $content;
    }

    // Replace product URLs: /product/{slug} -> /shop/product/{slug}
    $content = preg_replace(
        '#' . preg_quote($site_url, '#') . '/product/([^/"\'>\s]+)#',
        $headless_url . '/shop/product/$1',
        $content
    );

    // Replace product category URLs: /product-category/{slug} -> /shop/category/{slug}
    $content = preg_replace(
        '#' . preg_quote($site_url, '#') . '/product-category/([^/"\'>\s]+)#',
        $headless_url . '/shop/category/$1',
        $content
    );

    // Replace any remaining site URLs
    $content = str_replace($site_url, $headless_url, $content);

    return $content;
}

/**
 * Filter GraphQL content field to replace URLs
 */
add_filter('graphql_resolve_field', 'maleq_filter_graphql_content_urls', 10, 9);
function maleq_filter_graphql_content_urls($result, $source, $args, $context, $info, $type_name, $field_key, $field, $field_resolver) {
    // Only filter content fields
    if (!in_array($field_key, ['content', 'excerpt', 'description'])) {
        return $result;
    }

    // Only filter if result is a string
    if (!is_string($result)) {
        return $result;
    }

    return maleq_replace_content_urls($result);
}
