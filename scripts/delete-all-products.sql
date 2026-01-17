-- Delete all WooCommerce products and related data
-- This script removes products, variations, meta data, and term relationships
-- WARNING: This is destructive and cannot be undone!

-- Start transaction for safety
START TRANSACTION;

-- Get the post IDs of all products and variations
SET @product_ids = (
    SELECT GROUP_CONCAT(ID)
    FROM wp_posts
    WHERE post_type IN ('product', 'product_variation')
);

-- Delete product meta data
DELETE FROM wp_postmeta
WHERE post_id IN (
    SELECT ID FROM wp_posts
    WHERE post_type IN ('product', 'product_variation')
);

-- Delete product term relationships (categories, tags, etc.)
DELETE FROM wp_term_relationships
WHERE object_id IN (
    SELECT ID FROM wp_posts
    WHERE post_type IN ('product', 'product_variation')
);

-- Delete product posts (products and variations)
DELETE FROM wp_posts
WHERE post_type IN ('product', 'product_variation');

-- Clean up orphaned term relationships
DELETE tr FROM wp_term_relationships tr
LEFT JOIN wp_posts p ON tr.object_id = p.ID
WHERE p.ID IS NULL;

-- Update term counts (optional but recommended)
-- This will be recalculated by WordPress when you view categories

-- Commit the transaction
COMMIT;

-- Show results
SELECT
    'Products deleted' as status,
    (SELECT COUNT(*) FROM wp_posts WHERE post_type IN ('product', 'product_variation')) as remaining_products,
    (SELECT COUNT(*) FROM wp_postmeta WHERE post_id NOT IN (SELECT ID FROM wp_posts)) as orphaned_meta,
    (SELECT COUNT(*) FROM wp_term_relationships WHERE object_id NOT IN (SELECT ID FROM wp_posts)) as orphaned_relationships;
