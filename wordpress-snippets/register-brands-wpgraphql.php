<?php
/**
 * Register WooCommerce Brands taxonomy with WPGraphQL
 *
 * Add this code to your theme's functions.php or use a plugin like Code Snippets.
 * This exposes the product_brand taxonomy to GraphQL queries.
 */

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
    // Register connection from Product to ProductBrand
    register_graphql_connection([
        'fromType' => 'Product',
        'toType' => 'ProductBrand',
        'fromFieldName' => 'productBrands',
        'connectionTypeName' => 'ProductToProductBrandConnection',
        'resolve' => function($product, $args, $context, $info) {
            $resolver = new \WPGraphQL\Data\Connection\TermObjectConnectionResolver($product, $args, $context, $info, 'product_brand');
            return $resolver->get_connection();
        }
    ]);
});
