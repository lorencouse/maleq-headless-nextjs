<?php
/**
 * One-off repair: undo the stock damage from the duplicate-order bug.
 *
 * Run with wp-cli on the WordPress server:
 *   wp eval-file scripts/fix-duplicate-order-stock.php          # dry run
 *   wp eval-file scripts/fix-duplicate-order-stock.php apply    # write
 *
 * Background
 * ----------
 * Two bugs combined to corrupt stock on 5 orders (Apr 23 – Aug 3 2026):
 *
 *   1. The Stripe webhook raced /api/orders/create and created a duplicate
 *      "recovery" order for the same payment, so stock was deducted twice.
 *   2. /api/orders/create sent `sku` in its line items. WooCommerce resolves a
 *      line by SKU ahead of product_id/variation_id, so `variation_id` was
 *      discarded and stock came off the *variable parent* instead of the
 *      variation — driving parents negative and firing false out-of-stock and
 *      backorder emails while the variations were fully stocked.
 *
 * Repair
 * ------
 * In each duplicate pair the recovery order reduced the correct entity, so we
 * undo the checkout-created order's reductions and keep the recovery order's.
 * That leaves exactly one correct deduction per real purchase.
 *
 * `_reduced_stock` is cleared on the reverted line items — the same thing
 * WooCommerce does in wc_maybe_increase_stock_levels() — so that cancelling
 * those duplicate orders later does NOT restore the stock a second time.
 *
 * NOTE: because this clears _reduced_stock on the CHECKOUT order of each pair,
 * the duplicate you cancel must be that same checkout order (listed below).
 * Cancelling the recovery order instead would restore its stock again.
 */

if ( ! defined( 'ABSPATH' ) ) {
	WP_CLI::error( 'Must be run through wp-cli.' );
}

$apply = in_array( 'apply', $args, true );

/**
 * Line-item stock reductions to revert, keyed by the checkout-created (duplicate)
 * order. Every one of these was verified against `_reduced_stock` order-item meta.
 *
 * order_id => [ 'keep' => recovery order retained, 'note' => why ]
 */
$revert_orders = array(
	596858 => array( 'keep' => 596859, 'note' => 'parent 594232 reduced instead of variation 189749' ),
	596897 => array( 'keep' => 596896, 'note' => '4 parents reduced instead of variations; 2 items double-reduced' ),
	597005 => array( 'keep' => 597004, 'note' => 'parent 198810 reduced instead of variation 198811; 203908 double-reduced' ),
	597139 => array( 'keep' => 597138, 'note' => 'resolved to wrong product 195467 x2 via duplicate SKU; 3 items double-reduced' ),
	// 595542 reduced no stock at all (_reduced_stock was never set) — nothing to revert.
);

WP_CLI::line( $apply ? '=== APPLYING ===' : '=== DRY RUN (pass "apply" to write) ===' );
WP_CLI::line( '' );

// ---------------------------------------------------------------------------
// 1. Gather the reductions to revert, straight from order-item meta.
// ---------------------------------------------------------------------------

$deltas   = array();   // product/variation id => units to add back
$to_clear = array();   // [ order_id, item_id, product ref ]

foreach ( $revert_orders as $order_id => $meta ) {
	$order = wc_get_order( $order_id );
	if ( ! $order ) {
		WP_CLI::warning( "Order {$order_id} not found — skipping." );
		continue;
	}

	WP_CLI::line( sprintf( 'Order #%d (duplicate of #%d) — %s', $order_id, $meta['keep'], $meta['note'] ) );

	foreach ( $order->get_items() as $item_id => $item ) {
		$reduced = $item->get_meta( '_reduced_stock', true );
		if ( '' === $reduced || null === $reduced ) {
			WP_CLI::line( sprintf( '    item %d: no _reduced_stock — nothing to revert', $item_id ) );
			continue;
		}

		// The entity WooCommerce actually decremented: variation if set, else product.
		$target = $item->get_variation_id() ? $item->get_variation_id() : $item->get_product_id();

		$deltas[ $target ] = ( isset( $deltas[ $target ] ) ? $deltas[ $target ] : 0 ) + (int) $reduced;
		$to_clear[]        = array( $order_id, $item_id, $target );

		WP_CLI::line( sprintf( '    item %d: +%d back to #%d (%s)', $item_id, (int) $reduced, $target, $item->get_name() ) );
	}
	WP_CLI::line( '' );
}

// ---------------------------------------------------------------------------
// 2. Apply the stock corrections.
// ---------------------------------------------------------------------------

WP_CLI::line( '--- Stock corrections ---' );
WP_CLI::line( sprintf( '%-10s %-52s %8s %7s %8s', 'ID', 'Product', 'before', 'delta', 'after' ) );

$rollback = array();

foreach ( $deltas as $product_id => $delta ) {
	$product = wc_get_product( $product_id );
	if ( ! $product ) {
		WP_CLI::warning( "Product {$product_id} not found — skipping." );
		continue;
	}

	$before = $product->get_stock_quantity();
	$after  = (int) $before + $delta;

	$rollback[ $product_id ] = $before;

	WP_CLI::line( sprintf(
		'%-10d %-52s %8s %+7d %8d',
		$product_id,
		mb_substr( $product->get_name(), 0, 52 ),
		null === $before ? 'NULL' : $before,
		$delta,
		$after
	) );

	if ( ! $apply ) {
		continue;
	}

	// wc_update_product_stock keeps _stock, the lookup table and stock_status
	// in sync and fires the normal hooks. Raising stock never triggers the
	// no-stock / backorder notifications.
	wc_update_product_stock( $product, $after, 'set' );

	// Re-sync the variable parent so its aggregate status reflects reality.
	$parent_id = $product->get_parent_id();
	if ( $parent_id ) {
		WC_Product_Variable::sync( $parent_id );
		wc_delete_product_transients( $parent_id );
	}
	wc_delete_product_transients( $product_id );
}

// ---------------------------------------------------------------------------
// 3. Clear _reduced_stock so a later cancellation cannot restore twice.
// ---------------------------------------------------------------------------

WP_CLI::line( '' );
WP_CLI::line( sprintf( '--- Clearing _reduced_stock on %d reverted line items ---', count( $to_clear ) ) );

if ( $apply ) {
	foreach ( $to_clear as $entry ) {
		list( $order_id, $item_id, $target ) = $entry;
		$order = wc_get_order( $order_id );
		$item  = $order->get_item( $item_id );
		if ( ! $item ) {
			continue;
		}
		$item->delete_meta_data( '_reduced_stock' );
		$item->save();
	}

	// Leave a trail on each reverted order.
	foreach ( array_keys( $revert_orders ) as $order_id ) {
		$order = wc_get_order( $order_id );
		if ( $order ) {
			$order->add_order_note(
				'Stock reverted by fix-duplicate-order-stock.php: this order was a duplicate created '
				. 'alongside #' . $revert_orders[ $order_id ]['keep'] . ' for the same payment, and its '
				. 'stock reductions hit the wrong product. Stock is now accounted for by the retained order.'
			);
			$order->save();
		}
	}
	WP_CLI::success( 'Applied.' );
} else {
	WP_CLI::line( '(dry run — not cleared)' );
}

// ---------------------------------------------------------------------------
// 4. Rollback recipe.
// ---------------------------------------------------------------------------

WP_CLI::line( '' );
WP_CLI::line( '--- Rollback (restores the exact pre-run stock values) ---' );
WP_CLI::line( '-- Stock only. To also restore the cleared _reduced_stock meta,' );
WP_CLI::line( '-- reimport wp_woocommerce_order_itemmeta from the backup taken before this run.' );
foreach ( $rollback as $product_id => $before ) {
	if ( null === $before ) {
		WP_CLI::line( sprintf(
			'wp eval \'$p = wc_get_product(%d); $p->set_stock_quantity(null); $p->save();\'',
			$product_id
		) );
	} else {
		WP_CLI::line( sprintf(
			'wp eval \'wc_update_product_stock(wc_get_product(%d), %d, "set");\'',
			$product_id,
			$before
		) );
	}
}
