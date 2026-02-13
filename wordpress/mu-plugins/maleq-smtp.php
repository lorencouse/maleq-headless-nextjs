<?php
/**
 * Plugin Name: MaleQ SMTP Configuration
 * Description: Routes WordPress emails through iCloud SMTP
 * Version: 1.0
 */

// Configure PHPMailer to use SMTP
add_action('phpmailer_init', function($phpmailer) {
    $phpmailer->isSMTP();
    $phpmailer->Host       = 'smtp.mail.me.com';
    $phpmailer->SMTPAuth   = true;
    $phpmailer->Port       = 587;
    $phpmailer->SMTPSecure = 'tls';
    $phpmailer->Username   = defined('SMTP_USERNAME') ? SMTP_USERNAME : '';
    $phpmailer->Password   = defined('SMTP_PASSWORD') ? SMTP_PASSWORD : '';
});

// Set default "From" for general WordPress emails
add_filter('wp_mail_from', function($from) {
    return 'info@maleq.com';
});

add_filter('wp_mail_from_name', function($name) {
    return 'Male Q';
});

// Set WooCommerce emails to come from sales@maleq.com
add_filter('woocommerce_email_from_address', function($from, $email_obj) {
    return 'sales@maleq.com';
}, 10, 2);

add_filter('woocommerce_email_from_name', function($name, $email_obj) {
    return 'Male Q';
}, 10, 2);
