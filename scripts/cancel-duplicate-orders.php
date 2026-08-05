<?php
/**
 * One-off: cancel the duplicate orders created by the Stripe webhook race.
 *
 * Run with wp-cli on the WordPress server:
 *   wp eval-file scripts/cancel-duplicate-orders.php          # dry run
 *   wp eval-file scripts/cancel-duplicate-orders.php apply    # write
 *
 * SILENCE
 * -------
 * Nothing may reach the customer. Two independent guards:
 *
 *   1. `pre_wp_mail` is short-circuited, which blocks EVERY email at the
 *      WordPress level — WooCommerce transactional mail, admin notices, SMTP
 *      via maleq-smtp.php, anything. Blocked attempts are logged, not sent.
 *   2. The push-notification hook in maleq-push-notifications.php is unhooked.
 *      (It only fires on shipped/completed/processing, so 'cancelled' would not
 *      trigger it anyway — removed belt-and-braces.)
 *
 * STOCK
 * -----
 * Cancelling normally restores stock via wc_maybe_increase_stock_levels().
 * fix-duplicate-order-stock.php already reverted these orders' reductions and
 * cleared their per-item `_reduced_stock`, so wc_increase_stock_levels() skips
 * every line. This script snapshots stock before and after and fails loudly if
 * a single unit moves.
 */

if ( ! defined( 'ABSPATH' ) ) {
	WP_CLI::error( 'Must be run through wp-cli.' );
}

$apply = in_array( 'apply', $args, true );

/** Duplicate order => the order retained for that payment. */
$duplicates = array(
	// 595542 reduced no stock at all, so it was outside the stock repair — but it
	// is still a second order for one payment, so it is cancelled with the rest.
	595542 => 595543,
	596858 => 596859,
	596897 => 596896,
	597005 => 597004,
	597139 => 597138,
);

/** Products touched by the earlier stock repair — used to prove nothing moves. */
$watch_products = array(
	594232, 193181, 544560, 595311, 188453, 196046, 542651,
	198810, 203908, 538536, 200297, 195467, 201038,
	196400, 196402, 196403, // pair 595542/595543
);

WP_CLI::line( $apply ? '=== APPLYING ===' : '=== DRY RUN (pass "apply" to write) ===' );
WP_CLI::line( '' );

// ---------------------------------------------------------------------------
// 1. Total mail blackout.
// ---------------------------------------------------------------------------

$GLOBALS['maleq_blocked_mail'] = array();

add_filter(
	'pre_wp_mail',
	function ( $short_circuit, $atts ) {
		$to      = isset( $atts['to'] ) ? $atts['to'] : '(unknown)';
		$subject = isset( $atts['subject'] ) ? $atts['subject'] : '(no subject)';
		$GLOBALS['maleq_blocked_mail'][] = sprintf(
			'%s -> %s',
			$subject,
			is_array( $to ) ? implode( ',', $to ) : $to
		);
		return true; // Short-circuit: report success to the caller, send nothing.
	},
	PHP_INT_MAX,
	2
);

remove_action( 'woocommerce_order_status_changed', 'maleq_push_on_order_status_changed', 10 );

WP_CLI::line( 'Mail blackout armed (pre_wp_mail short-circuited); push hook removed.' );
WP_CLI::line( '' );

// ---------------------------------------------------------------------------
// 2. Snapshot stock.
// ---------------------------------------------------------------------------

$snapshot = function () use ( $watch_products ) {
	$out = array();
	foreach ( $watch_products as $pid ) {
		$product = wc_get_product( $pid );
		$out[ $pid ] = $product ? $product->get_stock_quantity() : 'missing';
	}
	return $out;
};

$before_stock = $snapshot();

// ---------------------------------------------------------------------------
// 3. Cancel.
// ---------------------------------------------------------------------------

$prior_status = array();

foreach ( $duplicates as $order_id => $keep_id ) {
	$order = wc_get_order( $order_id );
	if ( ! $order ) {
		WP_CLI::warning( "Order {$order_id} not found — skipping." );
		continue;
	}

	$status = $order->get_status();
	$prior_status[ $order_id ] = $status;

	// Report any line still carrying a reduction — that would restore stock.
	$risky = 0;
	foreach ( $order->get_items() as $item ) {
		if ( '' !== $item->get_meta( '_reduced_stock', true ) ) {
			$risky++;
		}
	}

	WP_CLI::line( sprintf(
		'#%d  %-14s -> cancelled   (duplicate of #%d)%s',
		$order_id,
		$status,
		$keep_id,
		$risky ? sprintf( '  [!! %d line(s) still hold _reduced_stock]', $risky ) : ''
	) );

	if ( 'cancelled' === $status ) {
		WP_CLI::line( '        already cancelled — skipping' );
		continue;
	}

	if ( ! $apply ) {
		continue;
	}

	$order->update_status(
		'cancelled',
		sprintf(
			'Cancelled as a duplicate: created alongside #%d for the same Stripe payment by the '
			. 'webhook recovery race. Stock for this purchase is accounted for by #%d. '
			. 'Customer was not notified.',
			$keep_id,
			$keep_id
		)
	);
}

// ---------------------------------------------------------------------------
// 4. Prove nothing moved and nothing was sent.
// ---------------------------------------------------------------------------

$after_stock = $snapshot();

WP_CLI::line( '' );
WP_CLI::line( '--- Stock drift check ---' );
$drift = 0;
foreach ( $before_stock as $pid => $before ) {
	$after = $after_stock[ $pid ];
	if ( $before !== $after ) {
		$drift++;
		WP_CLI::warning( sprintf( 'Product %d moved: %s -> %s', $pid, var_export( $before, true ), var_export( $after, true ) ) );
	}
}
if ( 0 === $drift ) {
	WP_CLI::line( sprintf( 'OK — all %d watched products unchanged.', count( $before_stock ) ) );
}

WP_CLI::line( '' );
WP_CLI::line( '--- Mail blocked ---' );
if ( empty( $GLOBALS['maleq_blocked_mail'] ) ) {
	WP_CLI::line( 'No email was even attempted.' );
} else {
	foreach ( $GLOBALS['maleq_blocked_mail'] as $blocked ) {
		WP_CLI::line( '  BLOCKED: ' . $blocked );
	}
}

WP_CLI::line( '' );
WP_CLI::line( '--- Rollback ---' );
foreach ( $prior_status as $order_id => $status ) {
	WP_CLI::line( sprintf(
		'wp eval \'$o = wc_get_order(%d); $o->set_status("%s"); $o->save();\'',
		$order_id,
		$status
	) );
}

if ( $apply ) {
	WP_CLI::success( 'Applied.' );
}
