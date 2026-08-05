<?php
/**
 * Backfill: a variable parent with in-stock children must itself be in stock.
 *
 * Run with wp-cli on the WordPress server:
 *   wp eval-file scripts/fix-variable-parent-stock-status.php          # dry run
 *   wp eval-file scripts/fix-variable-parent-stock-status.php apply    # write
 *
 * Problem
 * -------
 * 502 published variable products read `outofstock` while their variations are
 * stocked, hiding sellable inventory. Every one of them has `_manage_stock=yes`
 * on the parent AND every variation managing its own stock — so the parent's
 * own quantity is redundant, yet it is what decides the parent's status:
 *
 *   WC_Product::validate_props() forces `outofstock` whenever a product manages
 *   stock, disallows backorders, and sits at or below the no-stock threshold.
 *
 * That is why simply writing `_stock_status = instock` does not hold: the next
 * proper WooCommerce save flips it straight back. maleq-stock-sync.php only
 * appears to work because it writes post meta directly, bypassing validation —
 * which is exactly how the catalogue ended up with 788 products inconsistently
 * marked `instock` at a quantity <= 0.
 *
 * Fix
 * ---
 * Turn OFF parent-level stock management on these products. This is the correct
 * WooCommerce configuration for a variable product whose variations manage their
 * own stock, and it makes the desired rule native: with `manage_stock` off,
 * validate_props() stops forcing the status and WC_Product_Variable::sync()
 * derives the parent's status from its children — in stock if any child is.
 *
 * Only products where EVERY variation manages its own stock are touched; if any
 * variation relied on the parent for stock, turning it off would make that
 * variation permanently available, so those are skipped.
 */

if ( ! defined( 'ABSPATH' ) ) {
	WP_CLI::error( 'Must be run through wp-cli.' );
}

global $wpdb;

$apply = in_array( 'apply', $args, true );

WP_CLI::line( $apply ? '=== APPLYING ===' : '=== DRY RUN (pass "apply" to write) ===' );
WP_CLI::line( '' );

// Silence: this touches products, not orders, but nothing may escape regardless.
$GLOBALS['maleq_blocked_mail'] = array();
add_filter(
	'pre_wp_mail',
	function ( $sc, $atts ) {
		$GLOBALS['maleq_blocked_mail'][] = isset( $atts['subject'] ) ? $atts['subject'] : '(no subject)';
		return true;
	},
	PHP_INT_MAX,
	2
);

// ---------------------------------------------------------------------------
// Select: published variable parents marked outofstock that have an instock
// child, where every published variation manages its own stock.
// ---------------------------------------------------------------------------

$rows = $wpdb->get_results(
	"SELECT p.ID
	   FROM {$wpdb->posts} p
	   JOIN {$wpdb->prefix}wc_product_meta_lookup pl ON pl.product_id = p.ID
	   JOIN (
	         SELECT v.post_parent pid,
	                COUNT(*) total,
	                SUM(CASE WHEN vm.meta_value = 'yes' THEN 1 ELSE 0 END) managed,
	                SUM(CASE WHEN vl.stock_status = 'instock' THEN 1 ELSE 0 END) instock
	           FROM {$wpdb->posts} v
	           LEFT JOIN {$wpdb->postmeta} vm ON vm.post_id = v.ID AND vm.meta_key = '_manage_stock'
	           LEFT JOIN {$wpdb->prefix}wc_product_meta_lookup vl ON vl.product_id = v.ID
	          WHERE v.post_type = 'product_variation' AND v.post_status = 'publish'
	          GROUP BY v.post_parent
	        ) c ON c.pid = p.ID
	  WHERE p.post_type = 'product'
	    AND p.post_status = 'publish'
	    AND pl.stock_status = 'outofstock'
	    AND c.instock > 0
	    AND c.total = c.managed
	  ORDER BY p.ID",
	ARRAY_A
);

WP_CLI::line( sprintf( 'Matched %d parent products.', count( $rows ) ) );
WP_CLI::line( '' );

if ( ! $rows ) {
	WP_CLI::success( 'Nothing to do.' );
	return;
}

// ---------------------------------------------------------------------------
// Apply.
// ---------------------------------------------------------------------------

$rollback  = array();
$changed   = 0;
$unchanged = 0;
$shown     = 0;

foreach ( $rows as $row ) {
	$parent_id = (int) $row['ID'];
	$product   = wc_get_product( $parent_id );
	if ( ! $product ) {
		continue;
	}

	$before_manage = $product->get_manage_stock() ? 'yes' : 'no';
	$before_status = $product->get_stock_status();
	$before_qty    = $product->get_stock_quantity();

	$rollback[] = sprintf( '%d,%s,%s,%s', $parent_id, $before_manage, $before_status, null === $before_qty ? '' : $before_qty );

	if ( $shown < 15 ) {
		WP_CLI::line( sprintf(
			'  %-8d %-46s manage=%s status=%s qty=%s -> manage=no status=instock',
			$parent_id,
			mb_substr( $product->get_name(), 0, 46 ),
			$before_manage,
			$before_status,
			null === $before_qty ? 'NULL' : $before_qty
		) );
		$shown++;
		if ( 15 === $shown ) {
			WP_CLI::line( sprintf( '  ... and %d more', count( $rows ) - 15 ) );
		}
	}

	if ( ! $apply ) {
		continue;
	}

	// Stop the parent quantity from governing availability. Its variations,
	// which all manage their own stock, become the single source of truth.
	$product->set_manage_stock( false );
	$product->save();

	// Derive the parent's status from its children.
	WC_Product_Variable::sync( $parent_id );
	wc_delete_product_transients( $parent_id );

	$after = wc_get_product( $parent_id );
	if ( 'instock' === $after->get_stock_status() ) {
		$changed++;
	} else {
		$unchanged++;
		WP_CLI::warning( sprintf( 'Parent %d still %s after sync.', $parent_id, $after->get_stock_status() ) );
	}
}

if ( ! $apply ) {
	WP_CLI::line( '' );
	WP_CLI::line( '(dry run — nothing written)' );
	return;
}

// ---------------------------------------------------------------------------
// Report + rollback data.
// ---------------------------------------------------------------------------

$rollback_file = WP_CONTENT_DIR . '/uploads/parent-stock-status-rollback-' . gmdate( 'Ymd_His' ) . '.csv';
file_put_contents( $rollback_file, "product_id,manage_stock,stock_status,stock_qty\n" . implode( "\n", $rollback ) . "\n" );

WP_CLI::line( '' );
WP_CLI::line( sprintf( 'Now instock: %d', $changed ) );
WP_CLI::line( sprintf( 'Still not:   %d', $unchanged ) );
WP_CLI::line( 'Mail blocked: ' . ( empty( $GLOBALS['maleq_blocked_mail'] ) ? 'none attempted' : count( $GLOBALS['maleq_blocked_mail'] ) ) );
WP_CLI::line( 'Rollback CSV: ' . $rollback_file );
WP_CLI::success( 'Applied.' );
