<?php
/**
 * Plugin Name: WPGraphQL Render Blocks
 * Description: Processes Gutenberg blocks (including reusable blocks) in GraphQL content response
 * Version: 1.0.0
 * Author: Maleq Development
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Process Gutenberg blocks in GraphQL content response
 * This resolves reusable blocks and other dynamic blocks before returning content
 */
add_filter('graphql_resolve_field', function($result, $source, $args, $context, $info) {
    // Only process the 'content' field on Post types
    if ($info->fieldName === 'content' && $source instanceof \WPGraphQL\Model\Post) {
        // Get the raw post content
        $post_id = $source->ID;
        $post = get_post($post_id);

        if ($post && !empty($post->post_content)) {
            // Parse and render all blocks (including reusable blocks)
            $content = do_blocks($post->post_content);
            // Apply standard content filters (shortcodes, autop, etc.)
            $content = apply_filters('the_content', $content);
            return $content;
        }
    }
    return $result;
}, 10, 5);
