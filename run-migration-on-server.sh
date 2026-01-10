#!/bin/bash

# =============================================================================
# WordPress Content Migration Script - Run on Server
# =============================================================================
# This script should be run directly on your Hetzner server
#
# TO USE:
# 1. SSH into your server: ssh root@staging.maleq.com
# 2. Copy this entire script and save it to a file: nano /tmp/run-migration.sh
# 3. Make it executable: chmod +x /tmp/run-migration.sh
# 4. Run it: /tmp/run-migration.sh
# =============================================================================

set -e  # Exit on error

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "=============================================="
echo "WordPress Content Migration"
echo "Production (maleqdb) → Staging (maleq-staging)"
echo "=============================================="
echo ""

# Database credentials
STAGING_USER="maleq-staging"
STAGING_PASS="rpN5cAEDRS782RiGbURs"
STAGING_DB="maleq-staging"

PROD_USER="maleqcom"
PROD_PASS="Snowdogs2@@"
PROD_DB="maleqdb"

# =============================================================================
# STEP 1: Test Connections
# =============================================================================

echo -e "${BLUE}Step 1: Testing database connections...${NC}"

if ! mysql -u "$STAGING_USER" -p"$STAGING_PASS" "$STAGING_DB" -e "SELECT 1;" &>/dev/null; then
    echo -e "${RED}✗ Cannot connect to staging database${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Staging database connected${NC}"

if ! mysql -u "$PROD_USER" -p"$PROD_PASS" "$PROD_DB" -e "SELECT 1;" &>/dev/null; then
    echo -e "${RED}✗ Cannot connect to production database${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Production database connected${NC}"
echo ""

# =============================================================================
# STEP 2: Show what will be migrated
# =============================================================================

echo -e "${BLUE}Step 2: Checking content to migrate...${NC}"
mysql -u "$PROD_USER" -p"$PROD_PASS" "$PROD_DB" -e "
SELECT 'Published Posts' as Type, COUNT(*) as Count
FROM p1bJcx_posts
WHERE post_type = 'post' AND post_status = 'publish'
UNION ALL
SELECT 'Approved Comments', COUNT(*)
FROM p1bJcx_comments
WHERE comment_approved = '1'
UNION ALL
SELECT 'Orders', COUNT(*)
FROM p1bJcx_posts
WHERE post_type = 'shop_order';
"
echo ""

# =============================================================================
# STEP 3: Backup staging database
# =============================================================================

echo -e "${BLUE}Step 3: Creating backup of staging database...${NC}"
BACKUP_FILE="/tmp/staging-backup-$(date +%Y%m%d-%H%M%S).sql"
mysqldump -u "$STAGING_USER" -p"$STAGING_PASS" "$STAGING_DB" > "$BACKUP_FILE"
echo -e "${GREEN}✓ Backup created: $BACKUP_FILE${NC}"
echo ""

# =============================================================================
# STEP 4: Create migration SQL file
# =============================================================================

echo -e "${BLUE}Step 4: Creating migration SQL script...${NC}"

cat > /tmp/migrate-content.sql << 'EOFMIGRATION'
-- WordPress Content Migration Script
-- Production (maleqdb) → Staging (maleq-staging)

-- Create temporary tables for ID mapping
CREATE TEMPORARY TABLE IF NOT EXISTS user_id_map (
    old_id BIGINT(20) UNSIGNED,
    new_id BIGINT(20) UNSIGNED,
    PRIMARY KEY (old_id)
);

CREATE TEMPORARY TABLE IF NOT EXISTS post_id_map (
    old_id BIGINT(20) UNSIGNED,
    new_id BIGINT(20) UNSIGNED,
    PRIMARY KEY (old_id)
);

CREATE TEMPORARY TABLE IF NOT EXISTS comment_id_map (
    old_id BIGINT(20) UNSIGNED,
    new_id BIGINT(20) UNSIGNED,
    PRIMARY KEY (old_id)
);

-- Migrate users who wrote posts, commented, or made purchases
INSERT INTO wp_users (
    user_login, user_pass, user_nicename, user_email, user_url,
    user_registered, user_activation_key, user_status, display_name
)
SELECT DISTINCT
    u.user_login, u.user_pass, u.user_nicename, u.user_email, u.user_url,
    u.user_registered, u.user_activation_key, u.user_status, u.display_name
FROM maleqdb.p1bJcx_users u
WHERE u.ID IN (
    SELECT DISTINCT post_author FROM maleqdb.p1bJcx_posts WHERE post_type = 'post' AND post_status = 'publish'
    UNION
    SELECT DISTINCT user_id FROM maleqdb.p1bJcx_comments WHERE user_id > 0 AND comment_approved = '1'
    UNION
    SELECT DISTINCT pm.meta_value
    FROM maleqdb.p1bJcx_postmeta pm
    INNER JOIN maleqdb.p1bJcx_posts p ON pm.post_id = p.ID
    WHERE p.post_type = 'shop_order' AND pm.meta_key = '_customer_user' AND pm.meta_value > 0
)
AND u.user_login NOT IN (SELECT user_login FROM wp_users)
ORDER BY u.ID;

-- Map old user IDs to new
INSERT INTO user_id_map (old_id, new_id)
SELECT u_old.ID, u_new.ID
FROM maleqdb.p1bJcx_users u_old
INNER JOIN wp_users u_new ON u_old.user_login = u_new.user_login;

-- Migrate user metadata
INSERT INTO wp_usermeta (user_id, meta_key, meta_value)
SELECT COALESCE(m.new_id, um.user_id), um.meta_key, um.meta_value
FROM maleqdb.p1bJcx_usermeta um
LEFT JOIN user_id_map m ON um.user_id = m.old_id
WHERE m.new_id IS NOT NULL
AND CONCAT(COALESCE(m.new_id, um.user_id), '-', um.meta_key) NOT IN (
    SELECT CONCAT(user_id, '-', meta_key) FROM wp_usermeta
);

-- Migrate posts
INSERT INTO wp_posts (
    post_author, post_date, post_date_gmt, post_content, post_title,
    post_excerpt, post_status, comment_status, ping_status, post_password,
    post_name, to_ping, pinged, post_modified, post_modified_gmt,
    post_content_filtered, post_parent, guid, menu_order, post_type,
    post_mime_type, comment_count
)
SELECT
    COALESCE(m.new_id, p.post_author), p.post_date, p.post_date_gmt,
    p.post_content, p.post_title, p.post_excerpt, p.post_status,
    p.comment_status, p.ping_status, p.post_password, p.post_name,
    p.to_ping, p.pinged, p.post_modified, p.post_modified_gmt,
    p.post_content_filtered, p.post_parent, p.guid, p.menu_order,
    p.post_type, p.post_mime_type, p.comment_count
FROM maleqdb.p1bJcx_posts p
LEFT JOIN user_id_map m ON p.post_author = m.old_id
WHERE p.post_type = 'post' AND p.post_status = 'publish'
AND p.post_name NOT IN (SELECT post_name FROM p1bJcx_posts WHERE post_type = 'post')
ORDER BY p.ID;

-- Map old post IDs to new
INSERT INTO post_id_map (old_id, new_id)
SELECT p_old.ID, p_new.ID
FROM maleqdb.p1bJcx_posts p_old
INNER JOIN wp_posts p_new ON p_old.post_name = p_new.post_name
WHERE p_old.post_type = 'post';

-- Migrate post metadata
INSERT INTO wp_postmeta (post_id, meta_key, meta_value)
SELECT COALESCE(m.new_id, pm.post_id), pm.meta_key, pm.meta_value
FROM maleqdb.p1bJcx_postmeta pm
INNER JOIN post_id_map m ON pm.post_id = m.old_id
WHERE CONCAT(COALESCE(m.new_id, pm.post_id), '-', pm.meta_key) NOT IN (
    SELECT CONCAT(post_id, '-', meta_key) FROM wp_postmeta
);

-- Migrate taxonomy relationships
INSERT INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
SELECT DISTINCT COALESCE(pm.new_id, tr.object_id), tr.term_taxonomy_id, tr.term_order
FROM maleqdb.p1bJcx_term_relationships tr
INNER JOIN post_id_map pm ON tr.object_id = pm.old_id
WHERE CONCAT(COALESCE(pm.new_id, tr.object_id), '-', tr.term_taxonomy_id) NOT IN (
    SELECT CONCAT(object_id, '-', term_taxonomy_id) FROM wp_term_relationships
);

-- Migrate comments
INSERT INTO wp_comments (
    comment_post_ID, comment_author, comment_author_email, comment_author_url,
    comment_author_IP, comment_date, comment_date_gmt, comment_content,
    comment_karma, comment_approved, comment_agent, comment_type,
    comment_parent, user_id
)
SELECT
    COALESCE(pm.new_id, c.comment_post_ID), c.comment_author,
    c.comment_author_email, c.comment_author_url, c.comment_author_IP,
    c.comment_date, c.comment_date_gmt, c.comment_content, c.comment_karma,
    c.comment_approved, c.comment_agent, c.comment_type, c.comment_parent,
    COALESCE(um.new_id, c.user_id)
FROM maleqdb.p1bJcx_comments c
LEFT JOIN post_id_map pm ON c.comment_post_ID = pm.old_id
LEFT JOIN user_id_map um ON c.user_id = um.old_id
WHERE c.comment_approved = '1' AND pm.new_id IS NOT NULL
ORDER BY c.comment_ID;

-- Map comment IDs
INSERT INTO comment_id_map (old_id, new_id)
SELECT c_old.comment_ID, c_new.comment_ID
FROM maleqdb.p1bJcx_comments c_old
INNER JOIN wp_comments c_new ON
    c_old.comment_author_email = c_new.comment_author_email
    AND c_old.comment_date = c_new.comment_date
    AND c_old.comment_content = c_new.comment_content;

-- Update comment parent IDs
UPDATE wp_comments c
INNER JOIN comment_id_map cm ON c.comment_ID = cm.new_id
INNER JOIN comment_id_map pm ON c.comment_parent = pm.old_id
SET c.comment_parent = pm.new_id
WHERE c.comment_parent > 0;

-- Migrate comment metadata
INSERT INTO wp_commentmeta (comment_id, meta_key, meta_value)
SELECT COALESCE(m.new_id, cm.comment_id), cm.meta_key, cm.meta_value
FROM maleqdb.p1bJcx_commentmeta cm
INNER JOIN comment_id_map m ON cm.comment_id = m.old_id
WHERE CONCAT(COALESCE(m.new_id, cm.comment_id), '-', cm.meta_key) NOT IN (
    SELECT CONCAT(comment_id, '-', meta_key) FROM wp_commentmeta
);

-- Migrate WooCommerce orders
INSERT INTO wp_posts (
    post_author, post_date, post_date_gmt, post_content, post_title,
    post_excerpt, post_status, comment_status, ping_status, post_password,
    post_name, to_ping, pinged, post_modified, post_modified_gmt,
    post_content_filtered, post_parent, guid, menu_order, post_type,
    post_mime_type, comment_count
)
SELECT
    COALESCE(m.new_id, p.post_author), p.post_date, p.post_date_gmt,
    p.post_content, p.post_title, p.post_excerpt, p.post_status,
    p.comment_status, p.ping_status, p.post_password, p.post_name,
    p.to_ping, p.pinged, p.post_modified, p.post_modified_gmt,
    p.post_content_filtered, p.post_parent, p.guid, p.menu_order,
    p.post_type, p.post_mime_type, p.comment_count
FROM maleqdb.p1bJcx_posts p
LEFT JOIN user_id_map m ON p.post_author = m.old_id
WHERE p.post_type = 'shop_order'
AND p.post_name NOT IN (SELECT post_name FROM p1bJcx_posts WHERE post_type = 'shop_order')
ORDER BY p.ID;

-- Update post_id_map with order IDs
INSERT INTO post_id_map (old_id, new_id)
SELECT p_old.ID, p_new.ID
FROM maleqdb.p1bJcx_posts p_old
INNER JOIN wp_posts p_new ON p_old.post_name = p_new.post_name
WHERE p_old.post_type = 'shop_order'
ON DUPLICATE KEY UPDATE new_id = VALUES(new_id);

-- Migrate order metadata
INSERT INTO wp_postmeta (post_id, meta_key, meta_value)
SELECT
    COALESCE(pm_map.new_id, pm.post_id),
    pm.meta_key,
    CASE
        WHEN pm.meta_key = '_customer_user' THEN COALESCE(um.new_id, pm.meta_value)
        ELSE pm.meta_value
    END
FROM maleqdb.p1bJcx_postmeta pm
INNER JOIN post_id_map pm_map ON pm.post_id = pm_map.old_id
INNER JOIN maleqdb.p1bJcx_posts p ON pm.post_id = p.ID
LEFT JOIN user_id_map um ON pm.meta_value = um.old_id AND pm.meta_key = '_customer_user'
WHERE p.post_type = 'shop_order'
AND CONCAT(COALESCE(pm_map.new_id, pm.post_id), '-', pm.meta_key) NOT IN (
    SELECT CONCAT(post_id, '-', meta_key) FROM wp_postmeta
);

-- Migrate order items
INSERT INTO wp_woocommerce_order_items (order_item_name, order_item_type, order_id)
SELECT oi.order_item_name, oi.order_item_type, COALESCE(pm.new_id, oi.order_id)
FROM maleqdb.p1bJcx_woocommerce_order_items oi
INNER JOIN post_id_map pm ON oi.order_id = pm.old_id
ORDER BY oi.order_item_id;

-- Create order item mapping
CREATE TEMPORARY TABLE IF NOT EXISTS order_item_id_map (
    old_id BIGINT(20) UNSIGNED,
    new_id BIGINT(20) UNSIGNED,
    PRIMARY KEY (old_id)
);

INSERT INTO order_item_id_map (old_id, new_id)
SELECT oi_old.order_item_id, oi_new.order_item_id
FROM maleqdb.p1bJcx_woocommerce_order_items oi_old
INNER JOIN post_id_map pm ON oi_old.order_id = pm.old_id
INNER JOIN wp_woocommerce_order_items oi_new ON
    oi_new.order_id = pm.new_id
    AND oi_old.order_item_name = oi_new.order_item_name
    AND oi_old.order_item_type = oi_new.order_item_type;

-- Migrate order item metadata
INSERT INTO wp_woocommerce_order_itemmeta (order_item_id, meta_key, meta_value)
SELECT COALESCE(oim.new_id, oitmeta.order_item_id), oitmeta.meta_key, oitmeta.meta_value
FROM maleqdb.p1bJcx_woocommerce_order_itemmeta oitmeta
INNER JOIN order_item_id_map oim ON oitmeta.order_item_id = oim.old_id
WHERE CONCAT(COALESCE(oim.new_id, oitmeta.order_item_id), '-', oitmeta.meta_key) NOT IN (
    SELECT CONCAT(order_item_id, '-', meta_key) FROM wp_woocommerce_order_itemmeta
);

-- Cleanup
DROP TEMPORARY TABLE IF EXISTS user_id_map;
DROP TEMPORARY TABLE IF EXISTS post_id_map;
DROP TEMPORARY TABLE IF EXISTS comment_id_map;
DROP TEMPORARY TABLE IF EXISTS order_item_id_map;
EOFMIGRATION

echo -e "${GREEN}✓ Migration SQL created${NC}"
echo ""

# =============================================================================
# STEP 5: Run migration
# =============================================================================

echo -e "${YELLOW}Step 5: Running migration...${NC}"
echo -e "${YELLOW}This may take a few minutes depending on content volume.${NC}"
echo ""

mysql -u "$STAGING_USER" -p"$STAGING_PASS" "$STAGING_DB" < /tmp/migrate-content.sql

echo -e "${GREEN}✓ Migration completed!${NC}"
echo ""

# =============================================================================
# STEP 6: Verify results
# =============================================================================

echo -e "${BLUE}Step 6: Verifying migration results...${NC}"
mysql -u "$STAGING_USER" -p"$STAGING_PASS" "$STAGING_DB" -e "
SELECT 'Users' as Type, COUNT(*) as Count FROM wp_users
UNION ALL
SELECT 'Posts', COUNT(*) FROM p1bJcx_posts WHERE post_type = 'post' AND post_status = 'publish'
UNION ALL
SELECT 'Comments', COUNT(*) FROM p1bJcx_comments WHERE comment_approved = '1'
UNION ALL
SELECT 'Orders', COUNT(*) FROM p1bJcx_posts WHERE post_type = 'shop_order';
"
echo ""

echo "=============================================="
echo -e "${GREEN}Migration Complete!${NC}"
echo "=============================================="
echo ""
echo "Backup saved at: $BACKUP_FILE"
echo ""
echo "Next steps:"
echo "  1. Check your WordPress admin to verify content"
echo "  2. Clear WordPress caches"
echo "  3. Test WooCommerce orders"
echo ""
echo "If you need to rollback:"
echo "  mysql -u $STAGING_USER -p $STAGING_DB < $BACKUP_FILE"
echo ""
