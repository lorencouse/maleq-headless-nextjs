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
    // Password validation endpoint (login)
    register_rest_route('maleq/v1', '/validate-password', [
        'methods' => 'POST',
        'callback' => 'maleq_validate_password',
        'permission_callback' => '__return_true',
    ]);

    // Verify password endpoint (for password change)
    register_rest_route('maleq/v1', '/verify-password', [
        'methods' => 'POST',
        'callback' => 'maleq_verify_password',
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

    // Avatar upload endpoint
    register_rest_route('maleq/v1', '/upload-avatar', [
        'methods' => 'POST',
        'callback' => 'maleq_upload_avatar',
        'permission_callback' => '__return_true',
    ]);

    // Delete account endpoint
    register_rest_route('maleq/v1', '/delete-account', [
        'methods' => 'POST',
        'callback' => 'maleq_delete_account',
        'permission_callback' => '__return_true',
    ]);

    // Get customer data endpoint
    register_rest_route('maleq/v1', '/customer/(?P<id>\d+)', [
        'methods' => 'GET',
        'callback' => 'maleq_get_customer',
        'permission_callback' => '__return_true',
    ]);

    // Update customer data endpoint
    register_rest_route('maleq/v1', '/customer/(?P<id>\d+)', [
        'methods' => 'PUT',
        'callback' => 'maleq_update_customer',
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

/**
 * Verify user password (for password change validation)
 */
function maleq_verify_password(WP_REST_Request $request) {
    $user_id = absint($request->get_param('user_id'));
    $password = $request->get_param('password');

    if (empty($user_id) || empty($password)) {
        return new WP_Error(
            'missing_params',
            'User ID and password are required',
            ['status' => 400]
        );
    }

    $user = get_user_by('ID', $user_id);

    if (!$user) {
        return new WP_Error(
            'invalid_user',
            'User not found',
            ['status' => 404]
        );
    }

    if (!wp_check_password($password, $user->user_pass, $user->ID)) {
        return new WP_Error(
            'incorrect_password',
            'Incorrect password',
            ['status' => 401]
        );
    }

    return [
        'success' => true,
        'valid' => true,
    ];
}

/**
 * Upload user avatar
 */
function maleq_upload_avatar(WP_REST_Request $request) {
    $user_id = absint($request->get_param('user_id'));
    $files = $request->get_file_params();

    if (empty($user_id)) {
        return new WP_Error(
            'missing_user_id',
            'User ID is required',
            ['status' => 400]
        );
    }

    if (empty($files['file'])) {
        return new WP_Error(
            'missing_file',
            'No file uploaded',
            ['status' => 400]
        );
    }

    $user = get_user_by('ID', $user_id);
    if (!$user) {
        return new WP_Error(
            'invalid_user',
            'User not found',
            ['status' => 404]
        );
    }

    // Include required files for media handling
    require_once ABSPATH . 'wp-admin/includes/image.php';
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/media.php';

    // Handle the upload
    $upload = wp_handle_upload($files['file'], ['test_form' => false]);

    if (isset($upload['error'])) {
        return new WP_Error(
            'upload_failed',
            $upload['error'],
            ['status' => 500]
        );
    }

    // Create attachment
    $attachment = [
        'post_mime_type' => $upload['type'],
        'post_title' => sanitize_file_name(pathinfo($upload['file'], PATHINFO_FILENAME)),
        'post_content' => '',
        'post_status' => 'inherit',
    ];

    $attachment_id = wp_insert_attachment($attachment, $upload['file']);

    if (is_wp_error($attachment_id)) {
        return new WP_Error(
            'attachment_failed',
            'Failed to create attachment',
            ['status' => 500]
        );
    }

    // Generate attachment metadata
    $attachment_data = wp_generate_attachment_metadata($attachment_id, $upload['file']);
    wp_update_attachment_metadata($attachment_id, $attachment_data);

    // Delete old avatar if exists
    $old_avatar_id = get_user_meta($user_id, 'maleq_avatar_attachment_id', true);
    if ($old_avatar_id) {
        wp_delete_attachment($old_avatar_id, true);
    }

    // Store new avatar attachment ID
    update_user_meta($user_id, 'maleq_avatar_attachment_id', $attachment_id);
    update_user_meta($user_id, 'maleq_avatar_url', $upload['url']);

    return [
        'success' => true,
        'avatar_url' => $upload['url'],
        'attachment_id' => $attachment_id,
    ];
}

/**
 * Filter avatar URL to use custom avatar if set
 */
add_filter('get_avatar_url', function($url, $id_or_email, $args) {
    $user_id = null;

    if (is_numeric($id_or_email)) {
        $user_id = (int) $id_or_email;
    } elseif (is_object($id_or_email) && isset($id_or_email->user_id)) {
        $user_id = (int) $id_or_email->user_id;
    } elseif (is_string($id_or_email) && is_email($id_or_email)) {
        $user = get_user_by('email', $id_or_email);
        if ($user) {
            $user_id = $user->ID;
        }
    }

    if ($user_id) {
        $custom_avatar = get_user_meta($user_id, 'maleq_avatar_url', true);
        if (!empty($custom_avatar)) {
            return $custom_avatar;
        }
    }

    return $url;
}, 10, 3);

/**
 * Delete user account
 */
function maleq_delete_account(WP_REST_Request $request) {
    $user_id = absint($request->get_param('user_id'));
    $password = $request->get_param('password');

    if (empty($user_id) || empty($password)) {
        return new WP_Error(
            'missing_params',
            'User ID and password are required',
            ['status' => 400]
        );
    }

    $user = get_user_by('ID', $user_id);

    if (!$user) {
        return new WP_Error(
            'invalid_user',
            'User not found',
            ['status' => 404]
        );
    }

    // Verify password before deletion
    if (!wp_check_password($password, $user->user_pass, $user->ID)) {
        return new WP_Error(
            'incorrect_password',
            'Incorrect password',
            ['status' => 401]
        );
    }

    // Don't allow deleting administrators
    if (in_array('administrator', $user->roles)) {
        return new WP_Error(
            'cannot_delete_admin',
            'Administrator accounts cannot be deleted this way',
            ['status' => 403]
        );
    }

    // Delete custom avatar if exists
    $avatar_id = get_user_meta($user_id, 'maleq_avatar_attachment_id', true);
    if ($avatar_id) {
        wp_delete_attachment($avatar_id, true);
    }

    // Include required file for wp_delete_user
    require_once ABSPATH . 'wp-admin/includes/user.php';

    // Delete the user (reassign content to admin)
    $deleted = wp_delete_user($user_id, 1);

    if (!$deleted) {
        return new WP_Error(
            'delete_failed',
            'Failed to delete account',
            ['status' => 500]
        );
    }

    return [
        'success' => true,
        'message' => 'Account deleted successfully',
    ];
}

/**
 * Get customer data
 */
function maleq_get_customer(WP_REST_Request $request) {
    $user_id = absint($request->get_param('id'));

    if (empty($user_id)) {
        return new WP_Error(
            'missing_user_id',
            'User ID is required',
            ['status' => 400]
        );
    }

    $user = get_user_by('ID', $user_id);

    if (!$user) {
        return new WP_Error(
            'invalid_user',
            'User not found',
            ['status' => 404]
        );
    }

    return maleq_get_customer_data($user);
}

/**
 * Update customer data
 */
function maleq_update_customer(WP_REST_Request $request) {
    $user_id = absint($request->get_param('id'));
    $data = $request->get_json_params();

    if (empty($user_id)) {
        return new WP_Error(
            'missing_user_id',
            'User ID is required',
            ['status' => 400]
        );
    }

    $user = get_user_by('ID', $user_id);

    if (!$user) {
        return new WP_Error(
            'invalid_user',
            'User not found',
            ['status' => 404]
        );
    }

    // Update basic user data
    $user_data = ['ID' => $user_id];

    if (isset($data['first_name'])) {
        $user_data['first_name'] = sanitize_text_field($data['first_name']);
        update_user_meta($user_id, 'first_name', $user_data['first_name']);
    }

    if (isset($data['last_name'])) {
        $user_data['last_name'] = sanitize_text_field($data['last_name']);
        update_user_meta($user_id, 'last_name', $user_data['last_name']);
    }

    if (isset($data['email'])) {
        $new_email = sanitize_email($data['email']);
        // Check if email is already in use by another user
        $existing_user = get_user_by('email', $new_email);
        if ($existing_user && $existing_user->ID !== $user_id) {
            return new WP_Error(
                'email_exists',
                'This email address is already in use',
                ['status' => 400]
            );
        }
        $user_data['user_email'] = $new_email;
    }

    if (isset($data['password']) && !empty($data['password'])) {
        if (strlen($data['password']) < 8) {
            return new WP_Error(
                'weak_password',
                'Password must be at least 8 characters',
                ['status' => 400]
            );
        }
        $user_data['user_pass'] = $data['password'];
    }

    // Update user
    $result = wp_update_user($user_data);

    if (is_wp_error($result)) {
        return $result;
    }

    // Update billing address
    if (isset($data['billing']) && is_array($data['billing'])) {
        foreach ($data['billing'] as $key => $value) {
            update_user_meta($user_id, 'billing_' . $key, sanitize_text_field($value));
        }
    }

    // Update shipping address
    if (isset($data['shipping']) && is_array($data['shipping'])) {
        foreach ($data['shipping'] as $key => $value) {
            update_user_meta($user_id, 'shipping_' . $key, sanitize_text_field($value));
        }
    }

    // Return updated customer data
    $user = get_user_by('ID', $user_id);
    return maleq_get_customer_data($user);
}
