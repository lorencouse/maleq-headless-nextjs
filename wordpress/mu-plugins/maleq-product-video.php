<?php
/**
 * Plugin Name: Male Q Product Video
 * Description: Adds an MP4 video field to WooCommerce products. Stores a media library attachment ID as _product_video_id post meta.
 * Version: 1.0
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Add the Product Video meta box to the product editor
 */
add_action('add_meta_boxes', function () {
    add_meta_box(
        'maleq_product_video',
        'Product Video (MP4)',
        'maleq_product_video_meta_box',
        'product',
        'side',
        'default'
    );
});

/**
 * Render the meta box UI
 */
function maleq_product_video_meta_box($post) {
    wp_nonce_field('maleq_product_video_nonce', 'maleq_product_video_nonce');
    $video_id = get_post_meta($post->ID, '_product_video_id', true);
    $video_url = $video_id ? wp_get_attachment_url($video_id) : '';
    ?>
    <div id="maleq-product-video-wrap">
        <input type="hidden" name="maleq_product_video_id" id="maleq_product_video_id" value="<?php echo esc_attr($video_id); ?>" />

        <?php if ($video_url): ?>
            <div id="maleq-video-preview" style="margin-bottom:10px;">
                <video src="<?php echo esc_url($video_url); ?>" style="width:100%;max-height:200px;" controls muted></video>
            </div>
        <?php else: ?>
            <div id="maleq-video-preview" style="margin-bottom:10px;display:none;">
                <video src="" style="width:100%;max-height:200px;" controls muted></video>
            </div>
        <?php endif; ?>

        <p id="maleq-video-filename" style="margin:5px 0;font-style:italic;<?php echo $video_url ? '' : 'display:none;'; ?>">
            <?php echo $video_url ? basename($video_url) : ''; ?>
        </p>

        <button type="button" class="button" id="maleq-select-video">
            <?php echo $video_id ? 'Change Video' : 'Select Video'; ?>
        </button>
        <button type="button" class="button" id="maleq-remove-video" style="color:#a00;<?php echo $video_id ? '' : 'display:none;'; ?>">
            Remove
        </button>
    </div>

    <script>
    jQuery(function($) {
        var frame;
        $('#maleq-select-video').on('click', function(e) {
            e.preventDefault();
            if (frame) { frame.open(); return; }
            frame = wp.media({
                title: 'Select Product Video',
                library: { type: 'video' },
                multiple: false,
                button: { text: 'Use this video' }
            });
            frame.on('select', function() {
                var attachment = frame.state().get('selection').first().toJSON();
                $('#maleq_product_video_id').val(attachment.id);
                $('#maleq-video-preview').show().find('video').attr('src', attachment.url);
                $('#maleq-video-filename').show().text(attachment.filename);
                $('#maleq-select-video').text('Change Video');
                $('#maleq-remove-video').show();
            });
            frame.open();
        });

        $('#maleq-remove-video').on('click', function(e) {
            e.preventDefault();
            $('#maleq_product_video_id').val('');
            $('#maleq-video-preview').hide().find('video').attr('src', '');
            $('#maleq-video-filename').hide().text('');
            $('#maleq-select-video').text('Select Video');
            $(this).hide();
        });
    });
    </script>
    <?php
}

/**
 * Save the video attachment ID on product save
 */
add_action('save_post_product', function ($post_id) {
    if (!isset($_POST['maleq_product_video_nonce']) ||
        !wp_verify_nonce($_POST['maleq_product_video_nonce'], 'maleq_product_video_nonce')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if (!current_user_can('edit_post', $post_id)) return;

    $video_id = isset($_POST['maleq_product_video_id']) ? absint($_POST['maleq_product_video_id']) : 0;
    if ($video_id) {
        update_post_meta($post_id, '_product_video_id', $video_id);
    } else {
        delete_post_meta($post_id, '_product_video_id');
    }
});
