<?php
/**
 * Plugin Name: WPGraphQL Increase Query Limit
 * Description: Increases WPGraphQL max query amount from 100 to 500 for taxonomy queries (brands, materials, etc.)
 * Version: 1.0.0
 */

// Increase the max query amount for WPGraphQL connections
// Default is 100, which can truncate large taxonomy lists (e.g., brands stopping at 'O')
add_filter('graphql_connection_max_query_amount', function($max, $source, $args, $context, $info) {
    // Allow up to 500 items per query for all connections
    return 500;
}, 10, 5);
