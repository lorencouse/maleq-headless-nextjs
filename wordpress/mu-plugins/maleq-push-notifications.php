<?php
/**
 * Plugin Name: Male Q Push Notifications
 * Description: Sends Web Push notifications for order status changes and back-in-stock products.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) exit;

/**
 * Send a push notification via the Next.js frontend API.
 * Non-blocking so it doesn't slow down WordPress admin operations.
 */
function maleq_send_push($payload) {
    $frontend_url = defined('MALEQ_FRONTEND_URL') ? MALEQ_FRONTEND_URL : '';
    $admin_key = defined('MALEQ_ADMIN_KEY') ? MALEQ_ADMIN_KEY : '';

    if (empty($frontend_url) || empty($admin_key)) {
        return;
    }

    wp_remote_post($frontend_url . '/api/push/send', array(
        'headers' => array(
            'Content-Type' => 'application/json',
            'Authorization' => 'Bearer ' . $admin_key,
        ),
        'body' => wp_json_encode($payload),
        'timeout' => 5,
        'blocking' => false,
    ));
}

/**
 * Hook: Order status changed — send push notification for key transitions.
 */
function maleq_push_on_order_status_changed($order_id, $old_status, $new_status) {
    $notify_statuses = array(
        'shipped'    => 'Your order has been shipped!',
        'completed'  => 'Your order has been delivered!',
        'processing' => 'Your order is being processed.',
    );

    if (!isset($notify_statuses[$new_status])) {
        return;
    }

    $order = wc_get_order($order_id);
    if (!$order) return;

    $customer_id = $order->get_customer_id();
    if (!$customer_id) return;

    maleq_send_push(array(
        'type'       => 'order_update',
        'title'      => 'Order #' . $order_id . ' Update',
        'body'       => $notify_statuses[$new_status],
        'url'        => '/account/orders',
        'customerId' => $customer_id,
    ));
}
add_action('woocommerce_order_status_changed', 'maleq_push_on_order_status_changed', 10, 3);

/**
 * Hook: Product stock status changed to instock — trigger back-in-stock push.
 */
function maleq_push_on_stock_status_change($product_id, $stock_status) {
    if ($stock_status !== 'instock') {
        return;
    }

    $product = wc_get_product($product_id);
    if (!$product) return;

    // For variations, use the parent product
    if ($product->is_type('variation')) {
        $product = wc_get_product($product->get_parent_id());
        if (!$product) return;
    }

    maleq_send_push(array(
        'type'      => 'back_in_stock',
        'title'     => 'Back in Stock!',
        'body'      => $product->get_name() . ' is available again.',
        'url'       => '/product/' . $product->get_slug(),
        'productId' => $product->get_id(),
    ));
}
add_action('woocommerce_product_set_stock_status', 'maleq_push_on_stock_status_change', 10, 2);
