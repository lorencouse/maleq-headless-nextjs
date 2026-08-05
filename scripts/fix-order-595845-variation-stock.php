<?php
/**
 * One-off: correct order #595845, which deducted stock from a variable parent.
 *
 * Run with wp-cli on the WordPress server:
 *   wp eval-file scripts/fix-order-595845-variation-stock.php          # dry run
 *   wp eval-file scripts/fix-order-595845-variation-stock.php apply    # write
 *
 * Background
 * ----------
 * Same root cause as the duplicate-order stock damage: /api/orders/create sent
 * `sku` in its line items, and WooCommerce resolves a line by SKU ahead of
 * product_id/variation_id, discarding `variation_id`. Here there was no
 * duplicate order and no SKU collision — the cart simply carried the *parent*
 * SKU (VAR-BL-STAY-HARD-COCK-SLEEVE), so the line resolved to parent 196713 and
 * stock came off the parent, taking it to -1 while all six variations stayed
 * fully stocked (364/58/25/117/21/265).
 *
 * The variation the customer actually chose survives in the order's
 * `_fulfillment_allocations_json`, which is built from cartItems rather than the
 * WooCommerce line items:
 *
 *   {"productId":196713,"variationId":196714,...,"stcUpc":"853858007062"}
 *
 * 853858007062 is the SKU of variation 196714 "Stay Hard Cock Sleeve - 01 Clear".
 *
 * Repair
 * ------
 *   1. parent 196713    -1 -> 0    (undo the wrong deduction)
 *   2. variation 196714 364 -> 363 (apply the deduction that should have happened)
 *   3. point the order line at variation 196714 so its `_reduced_stock` is
 *      attributed correctly — otherwise a later cancellation would restore the
 *      unit to the parent and recreate the negative.
 *
 * The parent's `stock_status` is deliberately left as 'instock'. It was instock
 * before the bad deduction, its variations are stocked, and 788 other products
 * in this catalogue are likewise instock at a parent quantity <= 0 — flipping
 * this one to outofstock would hide a stocked product for no reason.
 */

if ( ! defined( 'ABSPATH' ) ) {
	WP_CLI::error( 'Must be run through wp-cli.' );
}

$apply = in_array( 'apply', $args, true );

$order_id     = 595845;
$parent_id    = 196713;
$variation_id = 196714;

WP_CLI::line( $apply ? '=== APPLYING ===' : '=== DRY RUN (pass "apply" to write) ===' );
WP_CLI::line( '' );

// ---------------------------------------------------------------------------
// Mail blackout — nothing may reach the customer.
// ---------------------------------------------------------------------------

$GLOBALS['maleq_blocked_mail'] = array();
add_filter(
	'pre_wp_mail',
	function ( $sc, $atts ) {
		$to = isset( $atts['to'] ) ? $atts['to'] : '(unknown)';
		$GLOBALS['maleq_blocked_mail'][] = ( isset( $atts['subject'] ) ? $atts['subject'] : '(no subject)' )
			. ' -> ' . ( is_array( $to ) ? implode( ',', $to ) : $to );
		return true;
	},
	PHP_INT_MAX,
	2
);
remove_action( 'woocommerce_order_status_changed', 'maleq_push_on_order_status_changed', 10 );

// ---------------------------------------------------------------------------
// Sanity checks — bail rather than guess if the world does not look as expected.
// ---------------------------------------------------------------------------

$order = wc_get_order( $order_id );
if ( ! $order ) {
	WP_CLI::error( "Order {$order_id} not found." );
}

$variation = wc_get_product( $variation_id );
if ( ! $variation || $variation->get_parent_id() !== $parent_id ) {
	WP_CLI::error( "Variation {$variation_id} is not a child of {$parent_id}." );
}

$target_item = null;
foreach ( $order->get_items() as $item_id => $item ) {
	if ( (int) $item->get_product_id() === $parent_id && ! $item->get_variation_id() ) {
		$target_item = $item;
		break;
	}
}
if ( ! $target_item ) {
	WP_CLI::error( "No line item on #{$order_id} points at parent {$parent_id} without a variation. Already fixed?" );
}

$reduced = (int) $target_item->get_meta( '_reduced_stock', true );
if ( 1 !== $reduced ) {
	WP_CLI::error( "Expected _reduced_stock = 1 on the line item, found '{$reduced}'. Aborting." );
}

$parent      = wc_get_product( $parent_id );
$parent_qty  = $parent->get_stock_quantity();
$var_qty     = $variation->get_stock_quantity();

WP_CLI::line( sprintf( 'Order #%d (%s) item %d — qty %d', $order_id, $order->get_status(), $target_item->get_id(), $target_item->get_quantity() ) );
WP_CLI::line( '' );
WP_CLI::line( sprintf( '  parent    %-8d %-42s %5d -> %d', $parent_id, $parent->get_name(), $parent_qty, $parent_qty + $reduced ) );
WP_CLI::line( sprintf( '  variation %-8d %-42s %5d -> %d', $variation_id, $variation->get_name(), $var_qty, $var_qty - $reduced ) );
WP_CLI::line( sprintf( '  line item -> variation_id %d, name "%s"', $variation_id, $variation->get_name() ) );
WP_CLI::line( '' );

if ( ! $apply ) {
	WP_CLI::line( '(dry run — nothing written)' );
	return;
}

// ---------------------------------------------------------------------------
// Apply.
// ---------------------------------------------------------------------------

// 1. Parent: undo the wrong deduction, preserving its stock_status.
$parent->set_stock_quantity( $parent_qty + $reduced );
$parent->set_stock_status( 'instock' );
$parent->save();

// 2. Variation: apply the deduction that should have happened.
wc_update_product_stock( $variation, $var_qty - $reduced, 'set' );

// 3. Re-point the line item so _reduced_stock is attributed to the variation.
$target_item->set_variation_id( $variation_id );
$target_item->set_name( $variation->get_name() );
$target_item->save();

wc_delete_product_transients( $parent_id );
wc_delete_product_transients( $variation_id );
WC_Product_Variable::sync( $parent_id );

// Re-assert the parent status: sync() recomputes it from the parent's own
// quantity because the parent manages stock, which would flip it to outofstock.
$parent = wc_get_product( $parent_id );
if ( 'instock' !== $parent->get_stock_status() ) {
	$parent->set_stock_status( 'instock' );
	$parent->save();
}

$order->add_order_note(
	sprintf(
		'Stock corrected: this line was recorded against variable parent #%d with no variation '
		. '(WooCommerce resolves line items by SKU ahead of variation_id, and the cart carried the '
		. 'parent SKU). Stock has been returned to the parent and deducted from variation #%d '
		. '("%s"), the variant recorded in the order\'s fulfilment allocation. Customer not notified.',
		$parent_id,
		$variation_id,
		$variation->get_name()
	)
);
$order->save();

WP_CLI::success( 'Applied.' );

WP_CLI::line( '' );
WP_CLI::line( '--- Mail blocked ---' );
WP_CLI::line( empty( $GLOBALS['maleq_blocked_mail'] ) ? 'No email was even attempted.' : implode( "\n", $GLOBALS['maleq_blocked_mail'] ) );

WP_CLI::line( '' );
WP_CLI::line( '--- Rollback ---' );
WP_CLI::line( sprintf( 'wp eval \'$p = wc_get_product(%d); $p->set_stock_quantity(%d); $p->set_stock_status("instock"); $p->save();\'', $parent_id, $parent_qty ) );
WP_CLI::line( sprintf( 'wp eval \'wc_update_product_stock(wc_get_product(%d), %d, "set");\'', $variation_id, $var_qty ) );
WP_CLI::line( sprintf( 'wp eval \'$o = wc_get_order(%d); $i = $o->get_item(%d); $i->set_variation_id(0); $i->set_name("%s"); $i->save();\'', $order_id, $target_item->get_id(), esc_js( $parent->get_name() ) ) );
