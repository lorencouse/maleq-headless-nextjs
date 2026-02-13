<?php
/**
 * Plugin Name: Male Q - GraphQL Query Limit
 * Description: Increases WPGraphQL max query amount for sitemap and bulk operations
 */

add_filter('graphql_connection_max_query_amount', function ($max) {
    return 500;
}, 10, 1);
