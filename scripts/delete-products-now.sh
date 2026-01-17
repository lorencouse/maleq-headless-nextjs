#!/bin/bash
# Delete all WooCommerce products from staging database
# Database: maleq-staging @ 159.69.220.162

echo "=== Deleting all WooCommerce products ==="
echo "Database: maleq-staging"
echo "Host: 159.69.220.162"
echo ""

mysql -h 159.69.220.162 -u maleq-staging -prpN5cAEDRS782RiGbURs maleq-staging <<'EOF'
-- Delete product meta
DELETE FROM wp_postmeta WHERE post_id IN (SELECT ID FROM wp_posts WHERE post_type IN ('product', 'product_variation'));

-- Delete term relationships
DELETE FROM wp_term_relationships WHERE object_id IN (SELECT ID FROM wp_posts WHERE post_type IN ('product', 'product_variation'));

-- Delete products
DELETE FROM wp_posts WHERE post_type IN ('product', 'product_variation');

-- Show count
SELECT COUNT(*) as remaining_products FROM wp_posts WHERE post_type IN ('product', 'product_variation');
EOF

echo ""
echo "=== Product deletion complete ==="
