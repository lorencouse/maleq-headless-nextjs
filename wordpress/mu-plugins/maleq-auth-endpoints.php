<?php
/**
 * Plugin Name: Male Q Auth Endpoints
 * Description: Provides authentication endpoints for headless frontend
 * Version: 1.0
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Register custom REST API endpoints for authentication
 */
add_action('rest_api_init', function () {
    // Password validation endpoint
    register_rest_route('maleq/v1', '/validate-password', [
        'methods' => 'POST',
        'callback' => 'maleq_validate_password',
        'permission_callback' => '__return_true',
    ]);

    // Forgot password endpoint
    register_rest_route('maleq/v1', '/forgot-password', [
        'methods' => 'POST',
        'callback' => 'maleq_forgot_password',
        'permission_callback' => '__return_true',
    ]);

    // Reset password endpoint
    register_rest_route('maleq/v1', '/reset-password', [
        'methods' => 'POST',
        'callback' => 'maleq_reset_password',
        'permission_callback' => '__return_true',
    ]);
});

/**
 * Validate user password
 */
function maleq_validate_password(WP_REST_Request $request) {
    $login = $request->get_param('login'); // Can be email or username
    $email = $request->get_param('email'); // Legacy support
    $password = $request->get_param('password');

    // Support both 'login' and 'email' parameters
    $identifier = !empty($login) ? sanitize_text_field($login) : sanitize_email($email);

    if (empty($identifier) || empty($password)) {
        return new WP_Error(
            'missing_credentials',
            'Email/username and password are required',
            ['status' => 400]
        );
    }

    // Try to get user by email first, then by username
    $user = is_email($identifier) ? get_user_by('email', $identifier) : null;

    if (!$user) {
        $user = get_user_by('login', $identifier);
    }

    if (!$user) {
        return new WP_Error(
            'invalid_login',
            'No account found with this email or username',
            ['status' => 401]
        );
    }

    // Validate password
    if (!wp_check_password($password, $user->user_pass, $user->ID)) {
        return new WP_Error(
            'incorrect_password',
            'Incorrect password',
            ['status' => 401]
        );
    }

    // Generate a secure token
    $token = wp_generate_password(64, false);
    $token_hash = wp_hash($token);

    // Store token with expiration (24 hours)
    update_user_meta($user->ID, 'maleq_auth_token', $token_hash);
    update_user_meta($user->ID, 'maleq_auth_token_expires', time() + DAY_IN_SECONDS);

    // Get customer data directly to avoid separate WooCommerce API call
    $customer_data = maleq_get_customer_data($user);

    return [
        'success' => true,
        'user_id' => $user->ID,
        'token' => $token,
        'customer' => $customer_data,
    ];
}

/**
 * Get customer data from WordPress user
 */
function maleq_get_customer_data($user) {
    $customer_data = [
        'id' => $user->ID,
        'email' => $user->user_email,
        'first_name' => get_user_meta($user->ID, 'first_name', true),
        'last_name' => get_user_meta($user->ID, 'last_name', true),
        'username' => $user->user_login,
        'avatar_url' => get_avatar_url($user->ID),
        'role' => !empty($user->roles) ? $user->roles[0] : 'customer',
    ];

    // Get WooCommerce billing/shipping if available
    if (class_exists('WooCommerce')) {
        $customer_data['billing'] = [
            'first_name' => get_user_meta($user->ID, 'billing_first_name', true),
            'last_name' => get_user_meta($user->ID, 'billing_last_name', true),
            'company' => get_user_meta($user->ID, 'billing_company', true),
            'address_1' => get_user_meta($user->ID, 'billing_address_1', true),
            'address_2' => get_user_meta($user->ID, 'billing_address_2', true),
            'city' => get_user_meta($user->ID, 'billing_city', true),
            'state' => get_user_meta($user->ID, 'billing_state', true),
            'postcode' => get_user_meta($user->ID, 'billing_postcode', true),
            'country' => get_user_meta($user->ID, 'billing_country', true),
            'email' => get_user_meta($user->ID, 'billing_email', true) ?: $user->user_email,
            'phone' => get_user_meta($user->ID, 'billing_phone', true),
        ];

        $customer_data['shipping'] = [
            'first_name' => get_user_meta($user->ID, 'shipping_first_name', true),
            'last_name' => get_user_meta($user->ID, 'shipping_last_name', true),
            'company' => get_user_meta($user->ID, 'shipping_company', true),
            'address_1' => get_user_meta($user->ID, 'shipping_address_1', true),
            'address_2' => get_user_meta($user->ID, 'shipping_address_2', true),
            'city' => get_user_meta($user->ID, 'shipping_city', true),
            'state' => get_user_meta($user->ID, 'shipping_state', true),
            'postcode' => get_user_meta($user->ID, 'shipping_postcode', true),
            'country' => get_user_meta($user->ID, 'shipping_country', true),
        ];
    }

    return $customer_data;
}

/**
 * Send password reset email
 */
function maleq_forgot_password(WP_REST_Request $request) {
    $email = sanitize_email($request->get_param('email'));

    if (empty($email)) {
        return new WP_Error(
            'missing_email',
            'Email is required',
            ['status' => 400]
        );
    }

    // Get user by email
    $user = get_user_by('email', $email);

    // Always return success to prevent email enumeration
    if (!$user) {
        return [
            'success' => true,
            'message' => 'If an account exists with this email, password reset instructions have been sent.',
        ];
    }

    // Generate reset key
    $reset_key = get_password_reset_key($user);

    if (is_wp_error($reset_key)) {
        // Log error but don't expose to user
        error_log('Password reset key generation failed: ' . $reset_key->get_error_message());
        return [
            'success' => true,
            'message' => 'If an account exists with this email, password reset instructions have been sent.',
        ];
    }

    // Build reset URL (points to frontend)
    $frontend_url = defined('MALEQ_FRONTEND_URL') ? MALEQ_FRONTEND_URL : 'https://www.maleq.com';
    $reset_url = $frontend_url . '/reset-password?key=' . $reset_key . '&email=' . rawurlencode($email);

    // Send email
    $subject = 'Password Reset Request - Male Q';
    $message = sprintf(
        "Hi %s,\n\n" .
        "Someone requested a password reset for your account.\n\n" .
        "If this was you, click the link below to reset your password:\n" .
        "%s\n\n" .
        "This link will expire in 24 hours.\n\n" .
        "If you didn't request this, you can safely ignore this email.\n\n" .
        "Thanks,\n" .
        "The Male Q Team",
        $user->display_name,
        $reset_url
    );

    $headers = ['Content-Type: text/plain; charset=UTF-8'];

    $sent = wp_mail($email, $subject, $message, $headers);

    if (!$sent) {
        error_log('Failed to send password reset email to: ' . $email);
    }

    return [
        'success' => true,
        'message' => 'If an account exists with this email, password reset instructions have been sent.',
    ];
}

/**
 * Reset password with key
 */
function maleq_reset_password(WP_REST_Request $request) {
    $email = sanitize_email($request->get_param('email'));
    $key = $request->get_param('key');
    $password = $request->get_param('password');

    if (empty($email) || empty($key) || empty($password)) {
        return new WP_Error(
            'missing_params',
            'Email, key, and new password are required',
            ['status' => 400]
        );
    }

    // Validate password strength
    if (strlen($password) < 8) {
        return new WP_Error(
            'weak_password',
            'Password must be at least 8 characters',
            ['status' => 400]
        );
    }

    // Get user by email
    $user = get_user_by('email', $email);

    if (!$user) {
        return new WP_Error(
            'invalid_key',
            'Invalid or expired reset link',
            ['status' => 400]
        );
    }

    // Verify reset key
    $check = check_password_reset_key($key, $user->user_login);

    if (is_wp_error($check)) {
        return new WP_Error(
            'invalid_key',
            'Invalid or expired reset link',
            ['status' => 400]
        );
    }

    // Reset the password
    reset_password($user, $password);

    return [
        'success' => true,
        'message' => 'Password has been reset successfully. You can now log in with your new password.',
    ];
}

/**
 * Validate auth token
 */
function maleq_validate_token($user_id, $token) {
    $stored_hash = get_user_meta($user_id, 'maleq_auth_token', true);
    $expires = get_user_meta($user_id, 'maleq_auth_token_expires', true);

    if (empty($stored_hash) || empty($expires)) {
        return false;
    }

    // Check expiration
    if (time() > $expires) {
        delete_user_meta($user_id, 'maleq_auth_token');
        delete_user_meta($user_id, 'maleq_auth_token_expires');
        return false;
    }

    // Validate token
    return wp_hash($token) === $stored_hash;
}
