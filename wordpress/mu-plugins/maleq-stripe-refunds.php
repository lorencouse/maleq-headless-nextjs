<?php
/**
 * Plugin Name: Male Q Stripe Refunds
 * Description: Registers a refund-only "stripe" payment gateway so WooCommerce can issue real Stripe refunds from the order screen. Checkout itself stays headless in Next.js.
 * Version: 1.0.0
 *
 * Why this exists
 * ---------------
 * Checkout runs in the Next.js app, which talks to Stripe directly and then
 * creates the order over the REST API with `payment_method = 'stripe'`. No
 * WooCommerce Stripe plugin is installed, so nothing is registered under that
 * id — `wc_get_payment_gateway_by_order()` returns false and the order screen
 * only ever offers "Refund manually", which writes a bookkeeping record and
 * never moves money.
 *
 * This registers the smallest thing that closes that gap: a gateway whose only
 * capability is `refunds`. It is never available at checkout, has no settings
 * to configure, and processes no payments. It exists so that WooCommerce can
 * find something that knows how to refund a Stripe charge.
 *
 * Installing the full WooCommerce Stripe Gateway would also work, but it would
 * register a checkout gateway this store does not use and its own webhook
 * handlers, which would double-handle the events the Next.js app already
 * processes at /api/stripe/webhook.
 *
 * Configuration
 * -------------
 * Needs a Stripe secret key on the WordPress side:
 *
 *   wp config set MALEQ_STRIPE_SECRET_KEY 'rk_live_...' --type=constant
 *
 * A *restricted* key (rk_) with `Refunds: write` and `PaymentIntents: read` is
 * strongly preferred over the account secret key — this box only ever needs to
 * issue refunds, so a leak there should not expose the whole Stripe account.
 * Read by constant first, then getenv(), matching the other Male Q secrets.
 */

if (!defined('ABSPATH')) {
    exit;
}

const MALEQ_STRIPE_REFUNDS_API = 'https://api.stripe.com/v1/refunds';

/**
 * Currencies Stripe treats as zero-decimal — their amounts are not multiplied
 * by 100. https://stripe.com/docs/currencies#zero-decimal
 */
const MALEQ_STRIPE_ZERO_DECIMAL = [
    'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
    'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
];

/**
 * Resolve the Stripe secret key. Constant first, then environment.
 */
function maleq_stripe_refund_secret_key() {
    if (defined('MALEQ_STRIPE_SECRET_KEY') && MALEQ_STRIPE_SECRET_KEY) {
        return (string) MALEQ_STRIPE_SECRET_KEY;
    }
    $env = getenv('MALEQ_STRIPE_SECRET_KEY');
    if ($env) {
        return (string) $env;
    }
    $env = getenv('STRIPE_SECRET_KEY');
    return $env ? (string) $env : '';
}

add_action('plugins_loaded', 'maleq_stripe_refunds_init', 20);

function maleq_stripe_refunds_init() {
    if (!class_exists('WC_Payment_Gateway')) {
        return;
    }

    class MaleQ_Stripe_Refund_Gateway extends WC_Payment_Gateway {

        public function __construct() {
            $this->id                 = 'stripe'; // Must match orders' payment_method.
            $this->method_title       = 'Stripe (refunds only)';
            $this->method_description = 'Refund-only gateway for the headless Next.js checkout. '
                . 'Payments are taken by the Next.js app; this exists so refunds issued here reach Stripe. '
                . 'Not offered at checkout.';
            $this->title              = 'Credit Card (Stripe)';
            $this->has_fields         = false;
            $this->supports           = ['refunds'];

            // Never offered as a checkout option — checkout is headless.
            $this->enabled = 'no';
        }

        /** Keep it out of checkout entirely; it is only ever used for refunds. */
        public function is_available() {
            return false;
        }

        /** No settings — the key comes from wp-config, not the options table. */
        public function init_form_fields() {
            $this->form_fields = [];
        }

        /**
         * Issue a real refund against the order's PaymentIntent.
         *
         * @param int        $order_id
         * @param float|null $amount Refund amount in store currency; null means full.
         * @param string     $reason Free text from the order screen.
         * @return bool|WP_Error True on success; WP_Error surfaces in the admin UI.
         */
        public function process_refund($order_id, $amount = null, $reason = '') {
            $order = wc_get_order($order_id);
            if (!$order) {
                return new WP_Error('maleq_stripe_refund', "Order {$order_id} not found.");
            }

            $secret = maleq_stripe_refund_secret_key();
            if (!$secret) {
                return new WP_Error(
                    'maleq_stripe_refund',
                    'Stripe secret key is not configured on WordPress. Set MALEQ_STRIPE_SECRET_KEY in wp-config.php.'
                );
            }

            $intent = $this->get_payment_intent_id($order);
            if (!$intent) {
                return new WP_Error(
                    'maleq_stripe_refund',
                    'No Stripe PaymentIntent is recorded on this order, so it cannot be refunded automatically. '
                    . 'Refund it in the Stripe dashboard, then record a manual refund here.'
                );
            }

            if (null === $amount || '' === $amount) {
                $amount = $order->get_total();
            }
            $amount = (float) $amount;
            if ($amount <= 0) {
                return new WP_Error('maleq_stripe_refund', 'Refund amount must be greater than zero.');
            }

            $currency = strtoupper($order->get_currency());
            $minor    = in_array($currency, MALEQ_STRIPE_ZERO_DECIMAL, true)
                ? (int) round($amount)
                : (int) round($amount * 100);

            $body = [
                'payment_intent'                   => $intent,
                'amount'                           => $minor,
                'metadata[woocommerce_order_id]'   => (string) $order->get_id(),
                'metadata[refund_reason]'          => mb_substr((string) $reason, 0, 500),
                'metadata[refunded_by]'            => (string) get_current_user_id(),
            ];

            // Stable across a retry of the same click, distinct for each
            // subsequent partial refund, so a network retry cannot double-refund.
            $idempotency_key = 'maleq-refund-' . md5(implode('|', [
                $order->get_id(),
                $intent,
                $minor,
                count($order->get_refunds()),
            ]));

            $response = wp_remote_post(MALEQ_STRIPE_REFUNDS_API, [
                'timeout' => 30,
                'headers' => [
                    'Authorization'   => 'Bearer ' . $secret,
                    'Content-Type'    => 'application/x-www-form-urlencoded',
                    'Idempotency-Key' => $idempotency_key,
                ],
                'body'    => $body,
            ]);

            if (is_wp_error($response)) {
                return new WP_Error(
                    'maleq_stripe_refund',
                    'Could not reach Stripe: ' . $response->get_error_message()
                );
            }

            $code = (int) wp_remote_retrieve_response_code($response);
            $data = json_decode(wp_remote_retrieve_body($response), true);

            if ($code < 200 || $code >= 300) {
                $message = isset($data['error']['message'])
                    ? $data['error']['message']
                    : "Stripe returned HTTP {$code}.";
                $order->add_order_note('Stripe refund FAILED: ' . $message);
                return new WP_Error('maleq_stripe_refund', 'Stripe refused the refund: ' . $message);
            }

            $refund_id = isset($data['id']) ? $data['id'] : '(unknown)';
            $status    = isset($data['status']) ? $data['status'] : 'unknown';

            $order->add_order_note(sprintf(
                'Stripe refund of %s issued (%s, status: %s) against %s.%s',
                wc_price($amount, ['currency' => $currency]),
                $refund_id,
                $status,
                $intent,
                $reason ? ' Reason: ' . $reason : ''
            ));

            $order->update_meta_data('_maleq_last_stripe_refund_id', $refund_id);
            $order->save();

            return true;
        }

        /**
         * The PaymentIntent lives in meta written by the Next.js checkout, with
         * transaction_id as a fallback. Both are set on orders from either the
         * checkout route or the webhook recovery path.
         */
        private function get_payment_intent_id($order) {
            $candidates = [
                $order->get_meta('_stripe_payment_intent_id'),
                $order->get_transaction_id(),
            ];
            foreach ($candidates as $value) {
                $value = trim((string) $value);
                if ($value && 0 === strpos($value, 'pi_')) {
                    return $value;
                }
            }
            return '';
        }
    }
}

/**
 * Register the gateway so wc_get_payment_gateway_by_order() can find it for
 * orders whose payment_method is 'stripe'.
 */
add_filter('woocommerce_payment_gateways', 'maleq_stripe_refunds_register');

function maleq_stripe_refunds_register($gateways) {
    if (class_exists('MaleQ_Stripe_Refund_Gateway')) {
        $gateways[] = 'MaleQ_Stripe_Refund_Gateway';
    }
    return $gateways;
}
