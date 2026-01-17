-- Simple product deletion script
-- Run this on your production database

-- Delete product meta
DELETE FROM wp_postmeta WHERE post_id IN (SELECT ID FROM wp_posts WHERE post_type IN ('product', 'product_variation'));

-- Delete term relationships
DELETE FROM wp_term_relationships WHERE object_id IN (SELECT ID FROM wp_posts WHERE post_type IN ('product', 'product_variation'));

-- Delete products
DELETE FROM wp_posts WHERE post_type IN ('product', 'product_variation');

-- Show count
SELECT COUNT(*) as remaining_products FROM wp_posts WHERE post_type IN ('product', 'product_variation');
