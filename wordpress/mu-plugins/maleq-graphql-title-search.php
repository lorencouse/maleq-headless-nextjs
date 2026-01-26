<?php
/**
 * Plugin Name: MaleQ GraphQL Title Search
 * Description: Adds titleSearch parameter to WPGraphQL for searching posts and products by title only
 * Version: 1.1.0
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Register the titleSearch argument for posts and products queries in WPGraphQL
 */
add_filter('graphql_connection_query_args', function ($query_args, $connection_resolver) {
    // Get the args from the resolver
    $args = $connection_resolver->get_args();

    // Check if titleSearch is provided
    if (!empty($args['where']['titleSearch'])) {
        $title_search = $args['where']['titleSearch'];

        // Remove the default search if set (to prevent conflict)
        if (isset($query_args['s'])) {
            unset($query_args['s']);
        }

        // Use post_title LIKE query for title-only search
        $query_args['_maleq_title_search'] = $title_search;
    }

    return $query_args;
}, 10, 2);

/**
 * Modify the WHERE clause to search by title only
 */
add_filter('posts_where', function ($where, $query) {
    global $wpdb;

    $title_search = $query->get('_maleq_title_search');

    if (!empty($title_search)) {
        $like = '%' . $wpdb->esc_like($title_search) . '%';
        $where .= $wpdb->prepare(" AND {$wpdb->posts}.post_title LIKE %s", $like);
    }

    return $where;
}, 10, 2);

/**
 * Register the titleSearch input field for Posts and Products
 */
add_action('graphql_register_types', function () {
    // Add titleSearch to posts where args
    register_graphql_field('RootQueryToPostConnectionWhereArgs', 'titleSearch', [
        'type' => 'String',
        'description' => __('Search posts by title only (case-insensitive partial match)', 'maleq'),
    ]);

    // Add titleSearch to products where args (WooGraphQL uses union type)
    register_graphql_field('RootQueryToProductUnionConnectionWhereArgs', 'titleSearch', [
        'type' => 'String',
        'description' => __('Search products by title/name only (case-insensitive partial match)', 'maleq'),
    ]);
});
