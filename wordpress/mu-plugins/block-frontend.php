<?php
/**
 * Plugin Name: Block Frontend Access
 * Description: Blocks public access to WP frontend for headless setup. Allows admin, API, GraphQL, and cron.
 */

// Only run on frontend requests
if (is_admin() || wp_doing_cron() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
    return;
}

add_action('template_redirect', function() {
    // Allow WPGraphQL (handled before template_redirect, but just in case)
    if (isset($_SERVER['REQUEST_URI']) && strpos($_SERVER['REQUEST_URI'], '/graphql') !== false) {
        return;
    }

    // Allow REST API
    if (isset($_SERVER['REQUEST_URI']) && strpos($_SERVER['REQUEST_URI'], '/wp-json') !== false) {
        return;
    }

    // Block everything else - return a simple page
    status_header(403);
    nocache_headers();
    echo '<!DOCTYPE html><html><head><title>maleq.com</title></head>';
    echo '<body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#111;color:#fff">';
    echo '<div style="text-align:center"><h1>maleq.com</h1><p>Visit <a href="https://maleq.com" style="color:#4af">maleq.com</a></p></div>';
    echo '</body></html>';
    exit;
});
