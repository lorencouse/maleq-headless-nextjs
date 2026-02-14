<?php
/**
 * Plugin Name: Male Q Order Tracking
 * Description: Order tracking management with admin UI, REST API, and customer email notifications
 * Version: 1.0
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Supported shipping carriers with tracking URL templates
 */
function maleq_get_shipping_carriers() {
    return [
        'UPS' => [
            'name' => 'UPS',
            'url_template' => 'https://www.ups.com/track?tracknum={number}',
        ],
        'USPS' => [
            'name' => 'USPS',
            'url_template' => 'https://tools.usps.com/go/TrackConfirmAction?tLabels={number}',
        ],
    ];
}

/**
 * Generate tracking URL for a carrier and tracking number
 */
function maleq_get_tracking_url($carrier, $tracking_number) {
    $carriers = maleq_get_shipping_carriers();

    if (!isset($carriers[$carrier])) {
        return '';
    }

    return str_replace('{number}', $tracking_number, $carriers[$carrier]['url_template']);
}

/**
 * Get tracking data from order
 */
function maleq_get_order_tracking($order) {
    if (!$order) {
        return null;
    }

    $order_id = $order->get_id();
    $tracking_items = get_post_meta($order_id, '_wc_shipment_tracking_items', true);

    // Also check order meta for HPOS compatibility
    if (empty($tracking_items)) {
        $tracking_items = $order->get_meta('_wc_shipment_tracking_items', true);
    }

    if (empty($tracking_items) || !is_array($tracking_items)) {
        return null;
    }

    // Return the first tracking item (most recent)
    return $tracking_items[0] ?? null;
}

/**
 * Save tracking data to order
 */
function maleq_save_order_tracking($order_id, $carrier, $tracking_number) {
    $tracking_url = maleq_get_tracking_url($carrier, $tracking_number);

    $tracking_data = [
        [
            'tracking_provider' => $carrier,
            'tracking_number'   => $tracking_number,
            'tracking_link'     => $tracking_url,
            'date_shipped'      => date('Y-m-d'),
        ]
    ];

    // Save to post meta (legacy)
    update_post_meta($order_id, '_wc_shipment_tracking_items', $tracking_data);

    // Also save to order meta for HPOS compatibility
    $order = wc_get_order($order_id);
    if ($order) {
        $order->update_meta_data('_wc_shipment_tracking_items', $tracking_data);
        $order->save();
    }

    return $tracking_data[0];
}

/**
 * Send tracking notification email to customer
 */
function maleq_send_tracking_email($order_id, $tracking_data) {
    $order = wc_get_order($order_id);

    if (!$order) {
        return false;
    }

    $customer_email = $order->get_billing_email();
    $customer_name = $order->get_billing_first_name();
    $order_number = $order->get_order_number();

    if (empty($customer_email)) {
        return false;
    }

    $carrier = $tracking_data['tracking_provider'];
    $tracking_number = $tracking_data['tracking_number'];
    $tracking_url = $tracking_data['tracking_link'];

    // Build order details URL (points to frontend)
    $frontend_url = defined('MALEQ_FRONTEND_URL') ? MALEQ_FRONTEND_URL : 'https://www.maleq.com';
    $order_url = $frontend_url . '/account/orders/' . $order_id;

    $subject = 'Your Order #' . $order_number . ' Has Shipped - Male Q';

    $message = sprintf(
        "Hi %s,\n\n" .
        "Great news! Your order #%s has shipped.\n\n" .
        "Shipping Details:\n" .
        "Carrier: %s\n" .
        "Tracking Number: %s\n\n" .
        "Track your package:\n" .
        "%s\n\n" .
        "View your order details:\n" .
        "%s\n\n" .
        "If you have any questions, please don't hesitate to contact us.\n\n" .
        "Thanks for shopping with us!\n" .
        "The Male Q Team",
        $customer_name ?: 'Valued Customer',
        $order_number,
        $carrier,
        $tracking_number,
        $tracking_url,
        $order_url
    );

    $headers = ['Content-Type: text/plain; charset=UTF-8'];

    $sent = wp_mail($customer_email, $subject, $message, $headers);

    if (!$sent) {
        error_log('Failed to send tracking email for order #' . $order_id . ' to: ' . $customer_email);
    }

    return $sent;
}

/**
 * Add tracking metabox to WooCommerce order edit page
 */
add_action('add_meta_boxes', function () {
    $screen = class_exists('\Automattic\WooCommerce\Internal\DataStores\Orders\CustomOrdersTableController')
        && wc_get_container()->get(\Automattic\WooCommerce\Internal\DataStores\Orders\CustomOrdersTableController::class)->custom_orders_table_usage_is_enabled()
        ? wc_get_page_screen_id('shop-order')
        : 'shop_order';

    add_meta_box(
        'maleq_order_tracking',
        'Shipment Tracking',
        'maleq_render_tracking_metabox',
        $screen,
        'side',
        'high'
    );
});

/**
 * Render the tracking metabox content
 */
function maleq_render_tracking_metabox($post_or_order) {
    // Handle both legacy (WP_Post) and HPOS (WC_Order) objects
    if ($post_or_order instanceof WP_Post) {
        $order = wc_get_order($post_or_order->ID);
    } else {
        $order = $post_or_order;
    }

    if (!$order) {
        echo '<p>Order not found.</p>';
        return;
    }

    $tracking = maleq_get_order_tracking($order);
    $carriers = maleq_get_shipping_carriers();

    wp_nonce_field('maleq_tracking_nonce', 'maleq_tracking_nonce');
    ?>

    <?php if ($tracking): ?>
    <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 10px; margin-bottom: 15px; border-radius: 4px;">
        <strong>Current Tracking:</strong><br>
        <?php echo esc_html($tracking['tracking_provider']); ?>:
        <a href="<?php echo esc_url($tracking['tracking_link']); ?>" target="_blank">
            <?php echo esc_html($tracking['tracking_number']); ?>
        </a>
        <br>
        <small>Shipped: <?php echo esc_html($tracking['date_shipped']); ?></small>
    </div>
    <?php endif; ?>

    <p>
        <label for="maleq_tracking_carrier"><strong>Carrier:</strong></label><br>
        <select name="maleq_tracking_carrier" id="maleq_tracking_carrier" style="width: 100%;">
            <option value="">-- Select Carrier --</option>
            <?php foreach ($carriers as $code => $carrier): ?>
                <option value="<?php echo esc_attr($code); ?>" <?php selected($tracking['tracking_provider'] ?? '', $code); ?>>
                    <?php echo esc_html($carrier['name']); ?>
                </option>
            <?php endforeach; ?>
        </select>
    </p>

    <p>
        <label for="maleq_tracking_number"><strong>Tracking Number:</strong></label><br>
        <input type="text"
               name="maleq_tracking_number"
               id="maleq_tracking_number"
               value="<?php echo esc_attr($tracking['tracking_number'] ?? ''); ?>"
               style="width: 100%;"
               placeholder="Enter tracking number">
    </p>

    <p>
        <label>
            <input type="checkbox" name="maleq_send_tracking_email" value="1">
            Send email notification to customer
        </label>
    </p>

    <p class="description">
        Tracking info will be saved when you update the order.
    </p>
    <?php
}

/**
 * Save tracking data when order is saved (legacy post-based orders)
 */
add_action('woocommerce_process_shop_order_meta', function ($order_id) {
    maleq_process_tracking_save($order_id);
});

/**
 * Save tracking data when order is saved (HPOS orders)
 */
add_action('woocommerce_update_order', function ($order_id) {
    // Avoid double-processing if already handled by legacy hook
    if (did_action('woocommerce_process_shop_order_meta')) {
        return;
    }
    maleq_process_tracking_save($order_id);
});

/**
 * Process tracking data save from admin metabox
 */
function maleq_process_tracking_save($order_id) {
    // Verify nonce
    if (!isset($_POST['maleq_tracking_nonce']) || !wp_verify_nonce($_POST['maleq_tracking_nonce'], 'maleq_tracking_nonce')) {
        return;
    }

    $carrier = isset($_POST['maleq_tracking_carrier']) ? sanitize_text_field($_POST['maleq_tracking_carrier']) : '';
    $tracking_number = isset($_POST['maleq_tracking_number']) ? sanitize_text_field($_POST['maleq_tracking_number']) : '';
    $send_email = isset($_POST['maleq_send_tracking_email']) && $_POST['maleq_send_tracking_email'] === '1';

    // Only save if both carrier and tracking number are provided
    if (empty($carrier) || empty($tracking_number)) {
        return;
    }

    // Get existing tracking to check if it changed
    $order = wc_get_order($order_id);
    $existing_tracking = maleq_get_order_tracking($order);
    $tracking_changed = !$existing_tracking
        || $existing_tracking['tracking_provider'] !== $carrier
        || $existing_tracking['tracking_number'] !== $tracking_number;

    // Save tracking
    $tracking_data = maleq_save_order_tracking($order_id, $carrier, $tracking_number);

    // Send email if requested and tracking changed
    if ($send_email && $tracking_changed) {
        maleq_send_tracking_email($order_id, $tracking_data);
    }
}

/**
 * Register REST API endpoint for tracking
 */
add_action('rest_api_init', function () {
    // Public endpoint for customer order tracking (no auth required)
    register_rest_route('maleq/v1', '/track-order', [
        'methods'             => 'POST',
        'callback'            => 'maleq_api_public_track_order',
        'permission_callback' => 'maleq_track_order_rate_limit',
        'args'                => [
            'order_number' => [
                'required'          => true,
                'type'              => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'email' => [
                'required'          => true,
                'type'              => 'string',
                'sanitize_callback' => 'sanitize_email',
                'validate_callback' => function ($value) {
                    return is_email($value);
                },
            ],
        ],
    ]);

    register_rest_route('maleq/v1', '/orders/(?P<order_id>\d+)/tracking', [
        'methods' => 'PUT',
        'callback' => 'maleq_api_update_tracking',
        'permission_callback' => 'maleq_tracking_api_permission_check',
        'args' => [
            'order_id' => [
                'required' => true,
                'type' => 'integer',
                'sanitize_callback' => 'absint',
            ],
            'carrier' => [
                'required' => true,
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'tracking_number' => [
                'required' => true,
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'send_email' => [
                'required' => false,
                'type' => 'boolean',
                'default' => false,
            ],
        ],
    ]);

    register_rest_route('maleq/v1', '/orders/(?P<order_id>\d+)/tracking', [
        'methods' => 'GET',
        'callback' => 'maleq_api_get_tracking',
        'permission_callback' => 'maleq_tracking_api_permission_check',
        'args' => [
            'order_id' => [
                'required' => true,
                'type' => 'integer',
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);
});

/**
 * Permission check for tracking API
 * Allows admin users or API key authentication
 */
function maleq_tracking_api_permission_check(WP_REST_Request $request) {
    // Check for API key authentication
    $api_key = $request->get_header('X-Maleq-Api-Key');

    if (!empty($api_key) && defined('MALEQ_TRACKING_API_KEY')) {
        if (hash_equals(MALEQ_TRACKING_API_KEY, $api_key)) {
            return true;
        }
    }

    // Check for logged-in admin user with WooCommerce capability
    if (current_user_can('manage_woocommerce')) {
        return true;
    }

    return new WP_Error(
        'unauthorized',
        'Authentication required. Use X-Maleq-Api-Key header or authenticate as admin.',
        ['status' => 401]
    );
}

/**
 * API endpoint to update tracking
 */
function maleq_api_update_tracking(WP_REST_Request $request) {
    $order_id = $request->get_param('order_id');
    $carrier = $request->get_param('carrier');
    $tracking_number = $request->get_param('tracking_number');
    $send_email = $request->get_param('send_email');

    // Validate order exists
    $order = wc_get_order($order_id);

    if (!$order) {
        return new WP_Error(
            'order_not_found',
            'Order not found',
            ['status' => 404]
        );
    }

    // Validate carrier
    $carriers = maleq_get_shipping_carriers();

    if (!isset($carriers[$carrier])) {
        return new WP_Error(
            'invalid_carrier',
            'Invalid carrier. Supported carriers: ' . implode(', ', array_keys($carriers)),
            ['status' => 400]
        );
    }

    // Validate tracking number
    if (empty($tracking_number)) {
        return new WP_Error(
            'missing_tracking_number',
            'Tracking number is required',
            ['status' => 400]
        );
    }

    // Get existing tracking to check if it changed
    $existing_tracking = maleq_get_order_tracking($order);
    $tracking_changed = !$existing_tracking
        || $existing_tracking['tracking_provider'] !== $carrier
        || $existing_tracking['tracking_number'] !== $tracking_number;

    // Save tracking
    $tracking_data = maleq_save_order_tracking($order_id, $carrier, $tracking_number);

    // Send email if requested and tracking changed
    $email_sent = false;
    if ($send_email && $tracking_changed) {
        $email_sent = maleq_send_tracking_email($order_id, $tracking_data);
    }

    return [
        'success' => true,
        'order_id' => $order_id,
        'tracking' => $tracking_data,
        'email_sent' => $email_sent,
    ];
}

/**
 * API endpoint to get tracking
 */
function maleq_api_get_tracking(WP_REST_Request $request) {
    $order_id = $request->get_param('order_id');

    $order = wc_get_order($order_id);

    if (!$order) {
        return new WP_Error(
            'order_not_found',
            'Order not found',
            ['status' => 404]
        );
    }

    $tracking = maleq_get_order_tracking($order);

    return [
        'success' => true,
        'order_id' => $order_id,
        'tracking' => $tracking,
    ];
}

/**
 * Rate limit for public track-order endpoint: 5 requests per minute per IP.
 */
function maleq_track_order_rate_limit() {
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $key = 'maleq_track_' . md5($ip);
    $count = (int) get_transient($key);

    if ($count >= 5) {
        return new WP_Error(
            'rate_limited',
            'Too many requests. Please wait a minute and try again.',
            ['status' => 429]
        );
    }

    set_transient($key, $count + 1, 60);
    return true;
}

/**
 * Public endpoint for customers to track their order by order number + billing email.
 */
function maleq_api_public_track_order(WP_REST_Request $request) {
    $order_number = trim($request->get_param('order_number'));
    $email = strtolower(trim($request->get_param('email')));

    if (empty($order_number) || empty($email)) {
        return new WP_Error(
            'missing_fields',
            'Order number and email are required.',
            ['status' => 400]
        );
    }

    // Look up order by number
    $order = wc_get_order($order_number);

    if (!$order) {
        // Try searching by custom order number meta
        $orders = wc_get_orders([
            'limit'      => 1,
            'meta_key'   => '_order_number',
            'meta_value' => $order_number,
        ]);
        $order = !empty($orders) ? $orders[0] : null;
    }

    if (!$order) {
        return new WP_Error(
            'order_not_found',
            'No order found. Please check your order number and email.',
            ['status' => 404]
        );
    }

    // Verify billing email matches (same error to prevent enumeration)
    $billing_email = strtolower($order->get_billing_email());
    if ($billing_email !== $email) {
        return new WP_Error(
            'order_not_found',
            'No order found. Please check your order number and email.',
            ['status' => 404]
        );
    }

    // Build items summary
    $items = [];
    foreach ($order->get_items() as $item) {
        $product = $item->get_product();
        $items[] = [
            'name'     => $item->get_name(),
            'quantity' => $item->get_quantity(),
            'total'    => $item->get_total(),
            'image'    => $product ? wp_get_attachment_url($product->get_image_id()) : null,
        ];
    }

    // Get tracking data using existing helper
    $tracking_items = $order->get_meta('_wc_shipment_tracking_items', true);
    $tracking = [];

    if (!empty($tracking_items) && is_array($tracking_items)) {
        foreach ($tracking_items as $item) {
            $tracking[] = [
                'tracking_provider' => $item['tracking_provider'] ?? '',
                'tracking_number'   => $item['tracking_number'] ?? '',
                'tracking_link'     => $item['tracking_link'] ?? '',
                'date_shipped'      => $item['date_shipped'] ?? '',
            ];
        }
    }

    // Map WooCommerce status to display-friendly label
    $status_map = [
        'pending'    => 'Pending Payment',
        'processing' => 'Processing',
        'on-hold'    => 'On Hold',
        'completed'  => 'Completed',
        'cancelled'  => 'Cancelled',
        'refunded'   => 'Refunded',
        'failed'     => 'Failed',
        'shipped'    => 'Shipped',
        'delivered'  => 'Delivered',
    ];

    $raw_status = $order->get_status();
    $status_label = $status_map[$raw_status] ?? ucfirst($raw_status);

    return rest_ensure_response([
        'success' => true,
        'order'   => [
            'number'          => $order->get_order_number(),
            'status'          => $raw_status,
            'status_label'    => $status_label,
            'date_created'    => $order->get_date_created()?->format('Y-m-d'),
            'total'           => $order->get_total(),
            'currency'        => $order->get_currency(),
            'items'           => $items,
            'shipping_method' => $order->get_shipping_method(),
            'tracking'        => $tracking,
        ],
    ]);
}
