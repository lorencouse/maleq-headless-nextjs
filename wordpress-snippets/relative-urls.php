<?php
/**
 * Relative URLs for Headless WordPress
 *
 * Converts internal URLs to relative paths for portability across environments.
 * This allows the same database to work on localhost, staging, and production.
 *
 * What it does:
 * - Converts internal page/post links to relative paths on save
 * - Strips domain from internal links in GraphQL output
 * - Preserves external URLs and image URLs (handled by Next.js)
 *
 * Installation:
 * 1. Add to theme's functions.php, OR
 * 2. Save as mu-plugin in wp-content/mu-plugins/, OR
 * 3. Use a code snippets plugin
 */

/**
 * Get all site domains that should be converted to relative URLs
 * Includes common local development domains
 */
function maleq_get_site_domains() {
    $domains = [
        get_site_url(),
        get_home_url(),
        // Add any additional domains that might be in your content
        'http://maleq-local.local',
        'https://maleq-local.local',
        'http://maleq.com',
        'https://maleq.com',
        'http://www.maleq.com',
        'https://www.maleq.com',
        'http://staging.maleq.com',
        'https://staging.maleq.com',
    ];

    // Remove duplicates and empty values
    return array_unique(array_filter($domains));
}

/**
 * Convert absolute internal URLs to relative paths
 * Preserves image URLs (wp-content/uploads) for Next.js image handling
 *
 * @param string $content The content to process
 * @param bool $preserve_images Whether to keep image URLs absolute
 * @return string Content with relative URLs
 */
function maleq_convert_to_relative_urls($content, $preserve_images = true) {
    if (empty($content)) {
        return $content;
    }

    $domains = maleq_get_site_domains();

    foreach ($domains as $domain) {
        $domain = rtrim($domain, '/');

        if ($preserve_images) {
            // Replace internal links but NOT image URLs
            // Match URLs that don't contain /wp-content/uploads/
            $pattern = '#' . preg_quote($domain, '#') . '(/(?!wp-content/uploads/)[^"\'<>\s]*)#i';
            $content = preg_replace($pattern, '$1', $content);
        } else {
            // Replace all internal URLs including images
            $content = str_replace($domain, '', $content);
        }
    }

    return $content;
}

/**
 * Convert relative URLs back to absolute (for WordPress admin)
 *
 * @param string $content The content to process
 * @return string Content with absolute URLs
 */
function maleq_convert_to_absolute_urls($content) {
    if (empty($content)) {
        return $content;
    }

    $site_url = get_site_url();

    // Convert relative URLs starting with / to absolute
    // But only for href and src attributes to avoid breaking other content
    $content = preg_replace(
        '#(href|src)=(["\'])(/[^"\']+)(["\'])#i',
        '$1=$2' . $site_url . '$3$4',
        $content
    );

    return $content;
}

/**
 * Strip domain from content when saving posts
 * This ensures the database stores relative URLs
 */
add_filter('content_save_pre', 'maleq_strip_domain_on_save', 10, 1);
function maleq_strip_domain_on_save($content) {
    return maleq_convert_to_relative_urls($content, true);
}

/**
 * Strip domain from excerpt when saving
 */
add_filter('excerpt_save_pre', 'maleq_strip_domain_on_save', 10, 1);

/**
 * Filter GraphQL content to ensure relative URLs
 * This catches any URLs that weren't converted on save
 */
add_filter('graphql_resolve_field', 'maleq_filter_graphql_urls', 10, 9);
function maleq_filter_graphql_urls($result, $source, $args, $context, $info, $type_name, $field_key, $field, $field_resolver) {
    // Only filter content-type fields
    $content_fields = ['content', 'excerpt', 'description'];

    if (!in_array($field_key, $content_fields)) {
        return $result;
    }

    if (!is_string($result)) {
        return $result;
    }

    return maleq_convert_to_relative_urls($result, true);
}

/**
 * Filter post links in REST API responses
 */
add_filter('rest_prepare_post', 'maleq_filter_rest_urls', 10, 3);
add_filter('rest_prepare_page', 'maleq_filter_rest_urls', 10, 3);
function maleq_filter_rest_urls($response, $post, $request) {
    $data = $response->get_data();

    if (isset($data['content']['rendered'])) {
        $data['content']['rendered'] = maleq_convert_to_relative_urls($data['content']['rendered'], true);
    }

    if (isset($data['excerpt']['rendered'])) {
        $data['excerpt']['rendered'] = maleq_convert_to_relative_urls($data['excerpt']['rendered'], true);
    }

    $response->set_data($data);
    return $response;
}

/**
 * Add absolute URLs back for the WordPress editor
 * This makes links clickable in the admin
 */
add_filter('the_editor_content', 'maleq_add_domain_for_editor', 10, 2);
function maleq_add_domain_for_editor($content, $default_editor) {
    return maleq_convert_to_absolute_urls($content);
}

/**
 * WP-CLI command to convert existing URLs in the database
 *
 * Usage: wp maleq convert-urls [--dry-run]
 */
if (defined('WP_CLI') && WP_CLI) {
    WP_CLI::add_command('maleq convert-urls', function($args, $assoc_args) {
        global $wpdb;

        $dry_run = isset($assoc_args['dry-run']);

        if ($dry_run) {
            WP_CLI::log('DRY RUN - No changes will be made');
        }

        // Get all published posts
        $posts = $wpdb->get_results("
            SELECT ID, post_content, post_excerpt
            FROM {$wpdb->posts}
            WHERE post_status = 'publish'
            AND (post_content LIKE '%maleq%' OR post_content LIKE '%" . get_site_url() . "%')
        ");

        $updated = 0;

        foreach ($posts as $post) {
            $new_content = maleq_convert_to_relative_urls($post->post_content, true);
            $new_excerpt = maleq_convert_to_relative_urls($post->post_excerpt, true);

            if ($new_content !== $post->post_content || $new_excerpt !== $post->post_excerpt) {
                $updated++;

                if (!$dry_run) {
                    $wpdb->update(
                        $wpdb->posts,
                        [
                            'post_content' => $new_content,
                            'post_excerpt' => $new_excerpt,
                        ],
                        ['ID' => $post->ID]
                    );
                }

                WP_CLI::log("Post {$post->ID}: URLs converted");
            }
        }

        WP_CLI::success("Processed {$updated} posts" . ($dry_run ? ' (dry run)' : ''));
    });
}
