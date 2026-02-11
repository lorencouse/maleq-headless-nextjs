<?php
/**
 * Plugin Name: MaleQ GraphQL Product Source
 * Description: Exposes the _product_source meta field as productSource in WPGraphQL for all product types.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('graphql_register_types', function () {
    $product_types = ['SimpleProduct', 'VariableProduct', 'ExternalProduct', 'GroupProduct'];

    foreach ($product_types as $type) {
        register_graphql_field($type, 'productSource', [
            'type'        => 'String',
            'description' => 'Product import source (e.g. williams_trading, stc, MUFFS)',
            'resolve'     => function ($product) {
                $id = $product->databaseId ?? ($product->ID ?? null);
                if (!$id) {
                    return null;
                }
                $source = get_post_meta($id, '_product_source', true);
                return $source ?: null;
            },
        ]);
    }
});
