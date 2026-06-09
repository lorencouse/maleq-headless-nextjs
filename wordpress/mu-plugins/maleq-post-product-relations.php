<?php
/**
 * Plugin Name: Male Q Post ⇄ Product Relations
 * Description: Adds an editor meta box to relate blog posts to specific products and
 *              product categories (one-to-many). Stored as ordered CSV in post meta so
 *              the Next.js frontend can read it via direct SQL and the order doubles as a
 *              ranking (used by the future "top 10" post generator).
 *
 *              Meta keys (protected, underscore-prefixed so they stay out of the default
 *              Custom Fields box):
 *                _maleq_related_products      → CSV of product post IDs, in display order
 *                _maleq_related_product_cats  → CSV of product_cat term IDs
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

const MALEQ_PPR_PRODUCTS_META = '_maleq_related_products';
const MALEQ_PPR_CATS_META     = '_maleq_related_product_cats';
// Roundup ("Best [X]") flag — when 'roundup', the Next.js frontend renders the
// programmatic buyer's-guide layout (comparison table, ranked cards, FAQ,
// ItemList/FAQPage schema) driven by these relations plus an editorial overlay
// in _maleq_guide_entries. See docs/BUYERS_GUIDE_SYSTEM.md.
const MALEQ_PPR_TYPE_META = '_maleq_guide_type';
// Editorial overlay (per-product copy), FAQ, and guide-level meta. Mirror of the
// keys gen-guide.ts writes and lib/db/post-relations.ts → loadGuide() reads.
const MALEQ_PPR_ENTRIES_META = '_maleq_guide_entries';
const MALEQ_PPR_FAQ_META     = '_maleq_guide_faq';
const MALEQ_PPR_GMETA_META   = '_maleq_guide_meta';

/**
 * Register the meta box on the standard "post" editor screen.
 */
add_action('add_meta_boxes', function () {
    add_meta_box(
        'maleq_post_product_relations',
        __('Related Products & Categories', 'maleq'),
        'maleq_render_post_product_relations_box',
        'post',
        'normal',
        'high'
    );
});

/**
 * Enqueue WooCommerce's enhanced-select (select2 + AJAX product search) on the
 * post editor only. WC localizes the search nonce onto this handle, which the
 * `.wc-product-search` field below relies on.
 */
add_action('admin_enqueue_scripts', function ($hook) {
    if ($hook !== 'post.php' && $hook !== 'post-new.php') {
        return;
    }
    $screen = get_current_screen();
    if (!$screen || $screen->post_type !== 'post') {
        return;
    }
    if (function_exists('WC')) {
        wp_enqueue_script('wc-enhanced-select');
        wp_enqueue_style('woocommerce_admin_styles');
        wp_enqueue_style('select2');
    }
});

/**
 * Render the meta box UI.
 */
function maleq_render_post_product_relations_box($post) {
    wp_nonce_field('maleq_ppr_save', 'maleq_ppr_nonce');

    if (!function_exists('WC')) {
        echo '<p>' . esc_html__('WooCommerce is not active — product relations are unavailable.', 'maleq') . '</p>';
        return;
    }

    $product_ids = maleq_ppr_read_csv_ids(get_post_meta($post->ID, MALEQ_PPR_PRODUCTS_META, true));
    $cat_ids     = maleq_ppr_read_csv_ids(get_post_meta($post->ID, MALEQ_PPR_CATS_META, true));
    $is_roundup  = get_post_meta($post->ID, MALEQ_PPR_TYPE_META, true) === 'roundup';

    // ── Roundup toggle ──
    echo '<p style="margin:0 0 1em;padding:0.75em;background:#f6f7f7;border-left:4px solid #2271b1;">';
    echo '<label><input type="checkbox" name="maleq_guide_type" value="roundup"' . checked($is_roundup, true, false) . ' /> ';
    echo '<strong>' . esc_html__('Render as a "Best of" roundup', 'maleq') . '</strong></label><br/>';
    echo '<span class="description">' . esc_html__('Shows the comparison table, ranked product cards, FAQ and rich schema, built from the related products below + an editorial overlay. Place a [buyers_guide] marker in the post body to control where the list appears (defaults to after the intro).', 'maleq') . '</span>';
    echo '</p>';

    // ── Related products (AJAX search over the whole catalog) ──
    echo '<p><label for="maleq_related_products"><strong>' . esc_html__('Related products', 'maleq') . '</strong></label><br/>';
    echo '<span class="description">' . esc_html__('Search and add products. Selection order is preserved (top = first).', 'maleq') . '</span></p>';
    echo '<select class="wc-product-search" multiple="multiple" style="width:100%;" id="maleq_related_products" name="maleq_related_products[]" data-placeholder="' . esc_attr__('Search for a product…', 'maleq') . '" data-action="woocommerce_json_search_products" data-allow_clear="true">';
    foreach ($product_ids as $pid) {
        $product = wc_get_product($pid);
        if ($product) {
            printf(
                '<option value="%d" selected="selected">%s</option>',
                (int) $pid,
                esc_html(wp_strip_all_tags($product->get_formatted_name()))
            );
        }
    }
    echo '</select>';

    // ── Related product categories ──
    echo '<p style="margin-top:1.25em;"><label for="maleq_related_product_cats"><strong>' . esc_html__('Related product categories', 'maleq') . '</strong></label><br/>';
    echo '<span class="description">' . esc_html__('Categories to recommend alongside this post (and to surface this post on category products).', 'maleq') . '</span></p>';

    $terms = get_terms([
        'taxonomy'   => 'product_cat',
        'hide_empty' => false,
        'orderby'    => 'name',
    ]);
    echo '<select class="wc-enhanced-select" multiple="multiple" style="width:100%;" id="maleq_related_product_cats" name="maleq_related_product_cats[]" data-placeholder="' . esc_attr__('Select product categories…', 'maleq') . '">';
    if (!is_wp_error($terms)) {
        foreach ($terms as $term) {
            printf(
                '<option value="%d"%s>%s</option>',
                (int) $term->term_id,
                in_array((int) $term->term_id, $cat_ids, true) ? ' selected="selected"' : '',
                esc_html($term->name)
            );
        }
    }
    echo '</select>';

    // ── Roundup editorial overlay (used when "Best of" is checked) ──
    $entries = json_decode((string) get_post_meta($post->ID, MALEQ_PPR_ENTRIES_META, true), true);
    if (!is_array($entries)) { $entries = []; }
    $faq = json_decode((string) get_post_meta($post->ID, MALEQ_PPR_FAQ_META, true), true);
    if (!is_array($faq)) { $faq = []; }
    $gmeta = json_decode((string) get_post_meta($post->ID, MALEQ_PPR_GMETA_META, true), true);
    if (!is_array($gmeta)) { $gmeta = []; }

    echo '<hr style="margin:1.5em 0;" />';
    echo '<p style="margin:0 0 0.5em;"><strong>' . esc_html__('Roundup editorial', 'maleq') . '</strong> ';
    echo '<span class="description">' . esc_html__('Used when "Best of" is on. gen-guide.ts can pre-fill all of this from product data; refine it here.', 'maleq') . '</span></p>';

    // Per-product editorial, keyed to the saved product list above.
    if (empty($product_ids)) {
        echo '<p class="description">' . esc_html__('Add products above and Update the post to edit their per-product copy here.', 'maleq') . '</p>';
    } else {
        foreach ($product_ids as $pid) {
            $product = wc_get_product($pid);
            $pname = $product ? wp_strip_all_tags($product->get_formatted_name()) : ('#' . $pid);
            $e = (isset($entries[(string) $pid]) && is_array($entries[(string) $pid])) ? $entries[(string) $pid] : [];
            $award   = isset($e['award']) ? (string) $e['award'] : '';
            $bestfor = isset($e['bestFor']) ? (string) $e['bestFor'] : '';
            $verdict = isset($e['verdict']) ? (string) $e['verdict'] : '';
            $pros    = (isset($e['pros']) && is_array($e['pros'])) ? implode("\n", $e['pros']) : '';
            $cons    = (isset($e['cons']) && is_array($e['cons'])) ? implode("\n", $e['cons']) : '';
            echo '<fieldset style="border:1px solid #dcdcde;border-radius:4px;padding:0.6em 0.75em;margin:0 0 0.6em;">';
            echo '<legend style="font-weight:600;padding:0 0.4em;">' . esc_html($pname) . '</legend>';
            printf(
                '<p style="margin:0 0 0.5em;display:flex;gap:0.5em;"><input type="text" style="flex:1;" name="maleq_guide_entries[%1$d][award]" value="%2$s" placeholder="%3$s" /><input type="text" style="flex:1;" name="maleq_guide_entries[%1$d][bestFor]" value="%4$s" placeholder="%5$s" /></p>',
                (int) $pid,
                esc_attr($award),
                esc_attr__('Award (e.g. Best Overall)', 'maleq'),
                esc_attr($bestfor),
                esc_attr__('Best for…', 'maleq')
            );
            printf(
                '<p style="margin:0 0 0.5em;"><textarea style="width:100%%;" rows="2" name="maleq_guide_entries[%1$d][verdict]" placeholder="%2$s">%3$s</textarea></p>',
                (int) $pid,
                esc_attr__('One–two sentence verdict…', 'maleq'),
                esc_textarea($verdict)
            );
            printf(
                '<p style="margin:0;display:flex;gap:0.5em;"><label style="flex:1;font-size:11px;color:#646970;">%1$s<textarea style="width:100%%;" rows="3" name="maleq_guide_entries[%2$d][pros]" placeholder="%3$s">%4$s</textarea></label><label style="flex:1;font-size:11px;color:#646970;">%5$s<textarea style="width:100%%;" rows="3" name="maleq_guide_entries[%2$d][cons]" placeholder="%3$s">%6$s</textarea></label></p>',
                esc_html__('Pros (one per line)', 'maleq'),
                (int) $pid,
                esc_attr__('One per line', 'maleq'),
                esc_textarea($pros),
                esc_html__('Cons (one per line)', 'maleq'),
                esc_textarea($cons)
            );
            echo '</fieldset>';
        }
    }

    // FAQ repeater.
    echo '<p style="margin:1em 0 0.4em;"><strong>' . esc_html__('FAQ', 'maleq') . '</strong> <span class="description">' . esc_html__('Feeds the FAQ section + FAQPage schema.', 'maleq') . '</span></p>';
    echo '<div id="maleq-faq-rows">';
    $faq_rows = !empty($faq) ? $faq : [['q' => '', 'a' => '']];
    foreach ($faq_rows as $row) {
        $q = isset($row['q']) ? (string) $row['q'] : '';
        $a = isset($row['a']) ? (string) $row['a'] : '';
        echo '<div class="maleq-faq-row" style="margin:0 0 0.5em;">';
        printf('<input type="text" style="width:100%%;margin-bottom:0.25em;" name="maleq_guide_faq_q[]" value="%s" placeholder="%s" />', esc_attr($q), esc_attr__('Question', 'maleq'));
        printf('<textarea style="width:100%%;" rows="2" name="maleq_guide_faq_a[]" placeholder="%s">%s</textarea>', esc_attr__('Answer', 'maleq'), esc_textarea($a));
        echo '</div>';
    }
    echo '</div>';
    echo '<button type="button" class="button" id="maleq-faq-add">' . esc_html__('+ Add FAQ', 'maleq') . '</button>';

    // Methodology.
    $methodology = isset($gmeta['methodology']) ? (string) $gmeta['methodology'] : '';
    printf(
        '<p style="margin:1em 0 0;"><label><strong>%s</strong><br/><textarea style="width:100%%;" rows="3" name="maleq_guide_methodology" placeholder="%s">%s</textarea></label></p>',
        esc_html__('Methodology', 'maleq'),
        esc_attr__('How we picked / tested these…', 'maleq'),
        esc_textarea($methodology)
    );
    ?>
    <script>
    (function () {
      var add = document.getElementById('maleq-faq-add');
      if (!add) { return; }
      add.addEventListener('click', function () {
        var wrap = document.getElementById('maleq-faq-rows');
        var row = document.createElement('div');
        row.className = 'maleq-faq-row';
        row.style.margin = '0 0 0.5em';
        row.innerHTML =
          '<input type="text" style="width:100%;margin-bottom:0.25em;" name="maleq_guide_faq_q[]" placeholder="<?php echo esc_js(__('Question', 'maleq')); ?>" />' +
          '<textarea style="width:100%;" rows="2" name="maleq_guide_faq_a[]" placeholder="<?php echo esc_js(__('Answer', 'maleq')); ?>"></textarea>';
        wrap.appendChild(row);
      });
    })();
    </script>
    <?php
}

/**
 * Persist the relations on save and notify the Next.js frontend to revalidate.
 * The dynamic `save_post_post` hook fires only for the "post" post type.
 */
add_action('save_post_post', 'maleq_save_post_product_relations');
function maleq_save_post_product_relations($post_id) {
    if (!isset($_POST['maleq_ppr_nonce']) || !wp_verify_nonce($_POST['maleq_ppr_nonce'], 'maleq_ppr_save')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (wp_is_post_revision($post_id) || !current_user_can('edit_post', $post_id)) {
        return;
    }

    // Preserve user-selected order; de-dupe while keeping the first occurrence.
    $products = isset($_POST['maleq_related_products'])
        ? maleq_ppr_unique_ints(array_map('absint', (array) $_POST['maleq_related_products']))
        : [];
    $cats = isset($_POST['maleq_related_product_cats'])
        ? maleq_ppr_unique_ints(array_map('absint', (array) $_POST['maleq_related_product_cats']))
        : [];

    if ($products) {
        update_post_meta($post_id, MALEQ_PPR_PRODUCTS_META, implode(',', $products));
    } else {
        delete_post_meta($post_id, MALEQ_PPR_PRODUCTS_META);
    }

    if ($cats) {
        update_post_meta($post_id, MALEQ_PPR_CATS_META, implode(',', $cats));
    } else {
        delete_post_meta($post_id, MALEQ_PPR_CATS_META);
    }

    // Roundup flag.
    $is_roundup = isset($_POST['maleq_guide_type']) && $_POST['maleq_guide_type'] === 'roundup';
    if ($is_roundup) {
        update_post_meta($post_id, MALEQ_PPR_TYPE_META, 'roundup');
    } else {
        delete_post_meta($post_id, MALEQ_PPR_TYPE_META);
    }

    // Per-product editorial overlay — only kept for products in the saved list.
    $entries_out = [];
    if (isset($_POST['maleq_guide_entries']) && is_array($_POST['maleq_guide_entries'])) {
        $allowed = array_map('strval', $products);
        foreach ($_POST['maleq_guide_entries'] as $pid => $fields) {
            $pid = (string) absint($pid);
            if ($pid === '0' || !in_array($pid, $allowed, true) || !is_array($fields)) {
                continue;
            }
            $entry = [];
            $award   = isset($fields['award']) ? sanitize_text_field(wp_unslash($fields['award'])) : '';
            $bestfor = isset($fields['bestFor']) ? sanitize_text_field(wp_unslash($fields['bestFor'])) : '';
            $verdict = isset($fields['verdict']) ? sanitize_textarea_field(wp_unslash($fields['verdict'])) : '';
            $pros = maleq_ppr_lines_to_array($fields['pros'] ?? '');
            $cons = maleq_ppr_lines_to_array($fields['cons'] ?? '');
            if ($award !== '')   { $entry['award'] = $award; }
            if ($bestfor !== '') { $entry['bestFor'] = $bestfor; }
            if ($verdict !== '') { $entry['verdict'] = $verdict; }
            if ($pros)           { $entry['pros'] = $pros; }
            if ($cons)           { $entry['cons'] = $cons; }
            if ($entry)          { $entries_out[$pid] = $entry; }
        }
    }
    if ($entries_out) {
        update_post_meta($post_id, MALEQ_PPR_ENTRIES_META, wp_json_encode($entries_out));
    } else {
        delete_post_meta($post_id, MALEQ_PPR_ENTRIES_META);
    }

    // FAQ — zip the parallel question/answer arrays, keep complete pairs.
    $faq_out = [];
    if (isset($_POST['maleq_guide_faq_q']) && is_array($_POST['maleq_guide_faq_q'])) {
        $qs = (array) $_POST['maleq_guide_faq_q'];
        $as = isset($_POST['maleq_guide_faq_a']) ? (array) $_POST['maleq_guide_faq_a'] : [];
        foreach ($qs as $i => $q) {
            $q = sanitize_text_field(wp_unslash($q));
            $a = isset($as[$i]) ? sanitize_textarea_field(wp_unslash($as[$i])) : '';
            if ($q !== '' && $a !== '') {
                $faq_out[] = ['q' => $q, 'a' => $a];
            }
        }
    }
    if ($faq_out) {
        update_post_meta($post_id, MALEQ_PPR_FAQ_META, wp_json_encode($faq_out));
    } else {
        delete_post_meta($post_id, MALEQ_PPR_FAQ_META);
    }

    // Guide meta: methodology + a freshness date (stamped today on any roundup save).
    $methodology = isset($_POST['maleq_guide_methodology'])
        ? sanitize_textarea_field(wp_unslash($_POST['maleq_guide_methodology']))
        : '';
    $existing_gmeta = json_decode((string) get_post_meta($post_id, MALEQ_PPR_GMETA_META, true), true);
    if (!is_array($existing_gmeta)) { $existing_gmeta = []; }
    $gmeta_out = [];
    if ($methodology !== '') {
        $gmeta_out['methodology'] = $methodology;
    }
    if ($is_roundup) {
        $gmeta_out['lastReviewed'] = current_time('Y-m-d');
    } elseif (!empty($existing_gmeta['lastReviewed'])) {
        $gmeta_out['lastReviewed'] = (string) $existing_gmeta['lastReviewed'];
    }
    if ($gmeta_out) {
        update_post_meta($post_id, MALEQ_PPR_GMETA_META, wp_json_encode($gmeta_out));
    } else {
        delete_post_meta($post_id, MALEQ_PPR_GMETA_META);
    }

    // Revalidate this guide page plus any referenced product pages so their
    // "Related Guides" lists update. Helper lives in maleq-cache-revalidation.php.
    if (function_exists('maleq_revalidate_frontend_cache')) {
        maleq_revalidate_frontend_cache($post_id, 'post');
        foreach ($products as $pid) {
            maleq_revalidate_frontend_cache($pid, 'product');
        }
    }
}

/**
 * Split a textarea value into a clean list of non-empty, sanitized lines.
 * Used for the pros / cons fields in the roundup editorial overlay.
 */
function maleq_ppr_lines_to_array($value) {
    if (!is_string($value)) {
        return [];
    }
    $out = [];
    foreach (preg_split('/\r\n|\r|\n/', wp_unslash($value)) as $line) {
        $line = sanitize_text_field($line);
        if ($line !== '') {
            $out[] = $line;
        }
    }
    return $out;
}

/**
 * Parse a stored CSV meta value into a clean list of positive ints (order kept).
 */
function maleq_ppr_read_csv_ids($value) {
    if (empty($value) || !is_string($value)) {
        return [];
    }
    return maleq_ppr_unique_ints(array_map('absint', explode(',', $value)));
}

/**
 * De-duplicate a list of ints, dropping zeros, preserving first-seen order.
 */
function maleq_ppr_unique_ints($ids) {
    $out = [];
    foreach ($ids as $id) {
        $id = (int) $id;
        if ($id > 0 && !in_array($id, $out, true)) {
            $out[] = $id;
        }
    }
    return $out;
}
