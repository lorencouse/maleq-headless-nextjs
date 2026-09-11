#!/usr/bin/env bash
# Stripe appeal (2026-09-11): "Please remove any product containing CBD."
#
# Unpublishes (sets to draft) every published product that is, or is described
# as, a CBD / cannabinoid product, plus the one vape SKU, on the PRODUCTION
# WordPress host. Runs ON the WP server:
#
#   ssh root@159.69.220.162 'bash -s' < scripts/ops/hide-cbd-products-2026-09-11.sh
#
# Reversible: every hidden product gets postmeta
#   _maleq_hidden_reason      = stripe-cbd-2026-09-11
#   _maleq_hidden_prev_status = publish
# Restore later with:
#   wp post update <ids> --post_status=publish
#
# Uses wp-cli for the status change so save_post_product fires and the
# maleq-cache-revalidation mu-plugin tells Next.js to drop each /product/<slug>
# page, /shop, and the in-memory product index.
#
# Take a fresh prod backup first (see CLAUDE.md "Database Backup Policy").
set -u

# 12 with "CBD" in the title, 24 whose description says they contain CBD
# (or belong to the "Assorted CBD Vendors" brand), + Kush Queen Bath Bomb
# (CBD brand, description silent) + Mochi Magic Mushroom Vape (vape SKU).
IDS="201126 198955 198957 200439 189442 200438 200437 200440 200436 197080 200441 200445 \
481756 547511 201127 201128 198965 198963 198967 198969 187851 198990 198991 198988 198989 \
200309 200305 545806 547524 200448 189455 547526 189448 189527 189536 189533 \
197038 200301"
IDS_CSV=$(echo $IDS | tr ' ' ',')

SITE=/home/maleq-wp/htdocs/wp.maleq.com
CFG=$SITE/wp-config.php
DB=$(grep -oP "DB_NAME',\s*'\K[^']+" "$CFG")
U=$(grep -oP "DB_USER',\s*'\K[^']+" "$CFG")
P=$(grep -oP "DB_PASSWORD',\s*'\K[^']+" "$CFG")
M="mysql --ssl-mode=REQUIRED -h 127.0.0.1 -u $U -p$P $DB -N"
wpcli() { su - maleq-wp -s /bin/bash -c "cd $SITE && wp $*"; }

echo "--- pre-check: targets currently published (expect 38)"
$M -e "SELECT COUNT(*) FROM wp_posts WHERE ID IN ($IDS_CSV) AND post_status='publish';" 2>/dev/null

echo "--- tag each product with reason + previous status (restorable)"
for id in $IDS; do
  $M -e "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES
    ($id,'_maleq_hidden_reason','stripe-cbd-2026-09-11'),
    ($id,'_maleq_hidden_prev_status','publish');" 2>/dev/null
done

echo "--- unpublish via wp-cli (fires save_post -> Next.js revalidation)"
wpcli "post update $IDS --post_status=draft 2>&1 | grep -c Success"

echo "--- Awaken Arousal Oil (482610) is CBD-free: keep it, drop the 'CBD-free' wording"
$M -e "INSERT INTO wp_postmeta (post_id, meta_key, meta_value)
        SELECT ID,'_maleq_cbd_original_content',post_content FROM wp_posts WHERE ID=482610;
      INSERT INTO wp_postmeta (post_id, meta_key, meta_value)
        SELECT ID,'_maleq_cbd_original_excerpt',post_excerpt FROM wp_posts WHERE ID=482610;" 2>/dev/null
$M -e "UPDATE wp_posts SET
        post_content = REPLACE(REPLACE(post_content,'CBD-free','plant-based'),'CBD free','plant-based'),
        post_excerpt = REPLACE(REPLACE(post_excerpt,'CBD-free','plant-based'),'CBD free','plant-based')
      WHERE ID=482610;" 2>/dev/null
echo "remaining 'CBD' occurrences in Awaken content / excerpt (expect 0 0):"
$M -e "SELECT (LENGTH(post_content)-LENGTH(REPLACE(post_content,'CBD','')))/3,
              (LENGTH(post_excerpt)-LENGTH(REPLACE(post_excerpt,'CBD','')))/3
       FROM wp_posts WHERE ID=482610;" 2>/dev/null
wpcli "post update 482610 --post_status=publish 2>&1 | tail -1"   # touch -> revalidate

echo "--- post-check: published products still mentioning CBD (expect 0)"
$M -e "SELECT COUNT(*) FROM wp_posts WHERE post_type='product' AND post_status='publish'
       AND (post_title LIKE '%cbd%' OR post_name LIKE '%cbd%'
            OR post_content LIKE '%cbd%' OR post_excerpt LIKE '%cbd%');" 2>/dev/null
echo "--- 'Assorted CBD Vendors' brand product count (expect 0)"
$M -e "SELECT tt.count FROM wp_terms t JOIN wp_term_taxonomy tt ON tt.term_id=t.term_id
       WHERE tt.taxonomy='product_brand' AND t.slug='assorted-cbd-vendors';" 2>/dev/null
echo "--- statuses of targets now (expect draft 38)"
$M -e "SELECT post_status, COUNT(*) FROM wp_posts WHERE ID IN ($IDS_CSV) GROUP BY post_status;" 2>/dev/null
