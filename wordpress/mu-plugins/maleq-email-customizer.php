<?php
/**
 * Plugin Name: MaleQ Email Customizer
 * Description: Customizes WooCommerce email templates with improved styling
 * Version: 1.0
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Custom email styles - injected into all WooCommerce emails
 */
add_filter('woocommerce_email_styles', function($css) {
    $css .= '
    /* Header logo image */
    #template_header_image {
        padding: 24px 0 20px 0 !important;
    }
    #template_header_image p {
        margin: 0 !important;
    }
    #template_header_image img {
        max-width: 200px !important;
        height: auto !important;
        margin: 0 auto !important;
        display: block !important;
    }

    /* Header title bar */
    #template_header {
        border-top-left-radius: 8px;
        border-top-right-radius: 8px;
    }
    #template_header h1 {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 24px;
        font-weight: 600;
        letter-spacing: -0.02em;
    }

    /* Body */
    #body_content {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    #body_content_inner {
        padding: 28px 48px 32px !important;
    }
    #body_content table td {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.6;
        color: #1a1a1a;
    }
    #body_content table td p {
        margin: 0 0 16px;
    }

    /* Order table */
    .td {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        border-color: #e5e5e5 !important;
    }
    .order_item td {
        padding: 12px !important;
    }
    .order_item td.td {
        border-bottom: 1px solid #f0f0f0 !important;
    }

    /* Order totals */
    tfoot .td {
        border-top: 1px solid #e5e5e5 !important;
    }
    tfoot tr:last-child .td {
        font-weight: 700 !important;
        font-size: 15px !important;
    }

    /* Order table header */
    thead .td {
        font-weight: 600 !important;
        color: #333 !important;
        text-transform: uppercase !important;
        font-size: 12px !important;
        letter-spacing: 0.04em !important;
        padding: 10px 12px !important;
        background: #f9f9f9 !important;
    }

    /* Address blocks */
    address {
        font-style: normal !important;
        line-height: 1.7 !important;
        color: #444 !important;
        padding: 16px 20px !important;
        background: #f9f9f9 !important;
        border-radius: 6px !important;
        border: 1px solid #e5e5e5 !important;
        margin: 0 !important;
    }
    /* Reset the wrapping td so padding only comes from the address element */
    .addresses .address {
        padding: 0 !important;
    }
    .addresses td.td {
        padding: 0 12px 12px 0 !important;
        vertical-align: top !important;
    }
    .addresses td.td:last-child {
        padding-right: 0 !important;
    }
    .addresses h3,
    .addresses h2 {
        margin: 0 0 8px !important;
        padding-bottom: 0 !important;
        border-bottom: none !important;
        font-size: 14px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.04em !important;
        color: #666 !important;
    }

    /* Links */
    #body_content a {
        color: #E63946;
        text-decoration: none;
        font-weight: 500;
    }
    #body_content a:hover {
        text-decoration: underline;
    }

    /* Footer */
    #template_footer {
        border-bottom-left-radius: 8px;
        border-bottom-right-radius: 8px;
    }
    #template_footer td {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    #credit {
        font-size: 12px;
        color: #999;
        padding: 20px 48px;
        line-height: 1.6;
        border-top: 1px solid #eee;
    }
    #credit a {
        color: #E63946 !important;
        text-decoration: none;
    }

    /* Wrapper */
    #wrapper {
        padding: 40px 0;
        background-color: #f7f7f7;
    }
    #template_container {
        border-radius: 8px;
        border: 1px solid #e5e5e5 !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }

    /* Headings in body */
    h2 {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 18px;
        font-weight: 600;
        color: #1a1a1a;
        border-bottom: 2px solid #E63946;
        padding-bottom: 8px;
        margin-bottom: 16px;
    }
    h3 {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 15px;
        font-weight: 600;
        color: #333;
    }
    ';
    return $css;
});

/**
 * Add contextual status banners to order emails
 */
add_filter('woocommerce_email_order_meta', function($order, $sent_to_admin, $plain_text, $email) {
    if ($plain_text || $sent_to_admin) return;

    $order_status = $order->get_status();
    $note = '';

    if ($order_status === 'completed') {
        $note = '<p style="margin: 16px 0; padding: 16px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; color: #166534; font-size: 14px;">Your order has been shipped! You should receive it within 5-7 business days.</p>';
    } elseif ($order_status === 'processing') {
        $note = '<p style="margin: 16px 0; padding: 16px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; color: #1e40af; font-size: 14px;">We are preparing your order and will notify you when it ships.</p>';
    }

    echo $note;
}, 10, 4);

/**
 * Add a shop CTA after order details
 */
add_action('woocommerce_email_after_order_table', function($order, $sent_to_admin, $plain_text) {
    if ($plain_text || $sent_to_admin) return;
    echo '<p style="text-align: center; margin: 24px 0 8px;">
        <a href="https://maleq.com/shop" style="display: inline-block; padding: 12px 32px; background: #E63946; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">Continue Shopping</a>
    </p>';
}, 10, 3);

