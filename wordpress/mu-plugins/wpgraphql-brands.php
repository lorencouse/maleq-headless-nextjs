<?php
/**
 * Plugin Name: WPGraphQL Product Brands
 * Description: Registers WooCommerce product_brand taxonomy with WPGraphQL and adds product-level brand connections.
 * Version: 1.1.0
 */

if (!defined('ABSPATH')) {
    exit;
}

// Register product_brand taxonomy with WPGraphQL
add_filter('register_taxonomy_args', function($args, $taxonomy) {
    if ('product_brand' === $taxonomy) {
        $args['show_in_graphql'] = true;
        $args['graphql_single_name'] = 'productBrand';
        $args['graphql_plural_name'] = 'productBrands';
    }
    return $args;
}, 10, 2);

// Add productBrands connection to Product type
add_action('graphql_register_types', function() {
    register_graphql_connection([
        'fromType' => 'Product',
        'toType' => 'ProductBrand',
        'fromFieldName' => 'productBrands',
        'connectionTypeName' => 'ProductToProductBrandConnection',
        'resolve' => function($product, $args, $context, $info) {
            $resolver = new \WPGraphQL\Data\Connection\TermObjectConnectionResolver($product, $args, $context, $info, 'product_brand');
            // Filter to only brands assigned to this specific product
            $resolver->set_query_arg('object_ids', [$product->databaseId]);
            return $resolver->get_connection();
        }
    ]);
});
