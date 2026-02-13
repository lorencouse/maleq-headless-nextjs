<?php
/**
 * Plugin Name: Male Q - Auto-Delete Product Images
 * Description: Automatically deletes product images (featured, gallery, variation) when a product is permanently deleted.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Delete all images associated with a product before it is permanently deleted.
 *
 * Handles:
 * - Featured image (post thumbnail)
 * - Gallery images (_product_image_gallery meta)
 * - Variation images (for variable products)
 *
 * Only deletes images that are not attached to other posts.
 */
add_action('before_delete_post', function ($post_id) {
    $post = get_post($post_id);

    if (!$post || !in_array($post->post_type, ['product', 'product_variation'], true)) {
        return;
    }

    $image_ids = [];

    // Featured image
    $thumbnail_id = get_post_thumbnail_id($post_id);
    if ($thumbnail_id) {
        $image_ids[] = (int) $thumbnail_id;
    }

    // Gallery images
    $gallery = get_post_meta($post_id, '_product_image_gallery', true);
    if ($gallery) {
        $gallery_ids = array_filter(array_map('intval', explode(',', $gallery)));
        $image_ids = array_merge($image_ids, $gallery_ids);
    }

    // For variable products, collect variation images
    if ($post->post_type === 'product') {
        $variations = get_posts([
            'post_type'      => 'product_variation',
            'post_parent'    => $post_id,
            'posts_per_page' => -1,
            'fields'         => 'ids',
        ]);

        foreach ($variations as $variation_id) {
            $var_thumbnail = get_post_thumbnail_id($variation_id);
            if ($var_thumbnail) {
                $image_ids[] = (int) $var_thumbnail;
            }
        }
    }

    // Deduplicate
    $image_ids = array_unique($image_ids);

    foreach ($image_ids as $attachment_id) {
        // Only delete if the image is not attached to another post
        $attachment = get_post($attachment_id);
        if (!$attachment || $attachment->post_type !== 'attachment') {
            continue;
        }

        // Check if this attachment is used by any other product
        $parent_id = (int) $attachment->post_parent;
        $is_orphaned = ($parent_id === 0 || $parent_id === $post_id);

        if ($is_orphaned) {
            wp_delete_attachment($attachment_id, true);
        }
    }
}, 10, 1);
