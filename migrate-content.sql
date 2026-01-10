-- WordPress Content Migration Script
-- Migrates posts, comments, users, and WooCommerce orders from production to staging
--
-- PRODUCTION DB: maleqdb (user: maleqcom)
-- STAGING DB: maleq-staging (user: maleq-staging)
--
-- USAGE:
-- mysql -u maleq-staging -p maleq-staging < migrate-content.sql
-- (Will prompt for password: rpN5cAEDRS782RiGbURs)

-- ============================================================================
-- STEP 1: CREATE TEMPORARY TABLES FOR ID MAPPING
-- ============================================================================

-- Drop existing temporary tables if they exist
DROP TEMPORARY TABLE IF EXISTS user_id_map;
DROP TEMPORARY TABLE IF EXISTS post_id_map;
DROP TEMPORARY TABLE IF EXISTS comment_id_map;
DROP TEMPORARY TABLE IF EXISTS order_item_id_map;

CREATE TEMPORARY TABLE user_id_map (
    old_id BIGINT(20) UNSIGNED,
    new_id BIGINT(20) UNSIGNED,
    PRIMARY KEY (old_id)
);

CREATE TEMPORARY TABLE post_id_map (
    old_id BIGINT(20) UNSIGNED,
    new_id BIGINT(20) UNSIGNED,
    PRIMARY KEY (old_id)
);

CREATE TEMPORARY TABLE comment_id_map (
    old_id BIGINT(20) UNSIGNED,
    new_id BIGINT(20) UNSIGNED,
    PRIMARY KEY (old_id)
);

-- ============================================================================
-- Set collation and sql mode for compatibility
SET collation_connection = 'utf8mb4_unicode_ci';
SET SESSION sql_mode = '';

-- STEP 2: MIGRATE USERS
-- ============================================================================
-- Migrate users who have:
-- 1. Written posts
-- 2. Left comments
-- 3. Made WooCommerce purchases

INSERT INTO wp_users (
    user_login,
    user_pass,
    user_nicename,
    user_email,
    user_url,
    user_registered,
    user_activation_key,
    user_status,
    display_name
)
SELECT DISTINCT
    u.user_login,
    u.user_pass,
    u.user_nicename,
    u.user_email,
    u.user_url,
    u.user_registered,
    u.user_activation_key,
    u.user_status,
    u.display_name
FROM maleqdb.p1bJcx_users u
WHERE u.ID IN (
    -- Users who wrote posts
    SELECT DISTINCT post_author FROM maleqdb.p1bJcx_posts WHERE post_type = 'post' AND post_status = 'publish'
    UNION
    -- Users who left comments
    SELECT DISTINCT user_id FROM maleqdb.p1bJcx_comments WHERE user_id > 0 AND comment_approved = '1'
    UNION
    -- Users who made purchases (WooCommerce customers)
    SELECT DISTINCT pm.meta_value
    FROM maleqdb.p1bJcx_postmeta pm
    INNER JOIN maleqdb.p1bJcx_posts p ON pm.post_id = p.ID
    WHERE p.post_type = 'shop_order'
    AND pm.meta_key = '_customer_user'
    AND pm.meta_value > 0
)
AND u.user_login NOT IN (SELECT user_login COLLATE utf8mb4_unicode_ci FROM wp_users);

-- Map old user IDs to new user IDs
INSERT INTO user_id_map (old_id, new_id)
SELECT u_old.ID, u_new.ID
FROM maleqdb.p1bJcx_users u_old
INNER JOIN wp_users u_new ON u_old.user_login COLLATE utf8mb4_unicode_ci = u_new.user_login;

-- Migrate user metadata
INSERT IGNORE INTO wp_usermeta (user_id, meta_key, meta_value)
SELECT
    COALESCE(m.new_id, um.user_id) as user_id,
    um.meta_key,
    um.meta_value
FROM maleqdb.p1bJcx_usermeta um
LEFT JOIN user_id_map m ON um.user_id = m.old_id
WHERE m.new_id IS NOT NULL;

-- ============================================================================
-- STEP 3: MIGRATE POSTS
-- ============================================================================

INSERT INTO wp_posts (
    post_author,
    post_date,
    post_date_gmt,
    post_content,
    post_title,
    post_excerpt,
    post_status,
    comment_status,
    ping_status,
    post_password,
    post_name,
    to_ping,
    pinged,
    post_modified,
    post_modified_gmt,
    post_content_filtered,
    post_parent,
    guid,
    menu_order,
    post_type,
    post_mime_type,
    comment_count
)
SELECT
    COALESCE(m.new_id, p.post_author) as post_author,
    p.post_date,
    p.post_date_gmt,
    p.post_content,
    p.post_title,
    p.post_excerpt,
    p.post_status,
    p.comment_status,
    p.ping_status,
    p.post_password,
    p.post_name,
    p.to_ping,
    p.pinged,
    p.post_modified,
    p.post_modified_gmt,
    p.post_content_filtered,
    p.post_parent,
    p.guid,
    p.menu_order,
    p.post_type,
    p.post_mime_type,
    p.comment_count
FROM maleqdb.p1bJcx_posts p
LEFT JOIN user_id_map m ON p.post_author = m.old_id
WHERE p.post_type = 'post'
AND p.post_status = 'publish'
AND p.post_name NOT IN (SELECT post_name COLLATE utf8mb4_unicode_ci FROM wp_posts WHERE post_type = 'post');

-- Map old post IDs to new post IDs
INSERT INTO post_id_map (old_id, new_id)
SELECT p_old.ID, p_new.ID
FROM maleqdb.p1bJcx_posts p_old
INNER JOIN wp_posts p_new ON p_old.post_name COLLATE utf8mb4_unicode_ci = p_new.post_name
WHERE p_old.post_type = 'post';

-- Migrate post metadata
INSERT IGNORE INTO wp_postmeta (post_id, meta_key, meta_value)
SELECT
    COALESCE(m.new_id, pm.post_id) as post_id,
    pm.meta_key,
    pm.meta_value
FROM maleqdb.p1bJcx_postmeta pm
INNER JOIN post_id_map m ON pm.post_id = m.old_id;

-- Migrate taxonomy relationships (categories, tags)
INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
SELECT DISTINCT
    COALESCE(pm.new_id, tr.object_id) as object_id,
    tr.term_taxonomy_id,
    tr.term_order
FROM maleqdb.p1bJcx_term_relationships tr
INNER JOIN post_id_map pm ON tr.object_id = pm.old_id;

-- ============================================================================
-- STEP 4: MIGRATE COMMENTS
-- ============================================================================

INSERT INTO wp_comments (
    comment_post_ID,
    comment_author,
    comment_author_email,
    comment_author_url,
    comment_author_IP,
    comment_date,
    comment_date_gmt,
    comment_content,
    comment_karma,
    comment_approved,
    comment_agent,
    comment_type,
    comment_parent,
    user_id
)
SELECT
    COALESCE(pm.new_id, c.comment_post_ID) as comment_post_ID,
    c.comment_author,
    c.comment_author_email,
    c.comment_author_url,
    c.comment_author_IP,
    c.comment_date,
    c.comment_date_gmt,
    c.comment_content,
    c.comment_karma,
    c.comment_approved,
    c.comment_agent,
    c.comment_type,
    c.comment_parent,
    COALESCE(um.new_id, c.user_id) as user_id
FROM maleqdb.p1bJcx_comments c
LEFT JOIN post_id_map pm ON c.comment_post_ID = pm.old_id
LEFT JOIN user_id_map um ON c.user_id = um.old_id
WHERE c.comment_approved = '1'
AND pm.new_id IS NOT NULL;

-- Map old comment IDs to new comment IDs (for threaded comments)
INSERT IGNORE INTO comment_id_map (old_id, new_id)
SELECT c_old.comment_ID, c_new.comment_ID
FROM maleqdb.p1bJcx_comments c_old
INNER JOIN wp_comments c_new ON
    CONVERT(c_old.comment_author_email USING utf8mb4) COLLATE utf8mb4_unicode_ci = c_new.comment_author_email
    AND c_old.comment_date = c_new.comment_date
    AND CONVERT(c_old.comment_content USING utf8mb4) COLLATE utf8mb4_unicode_ci = c_new.comment_content;

-- Update comment parent IDs for threaded comments
-- Skip this step for now as it requires complex table joining

-- Migrate comment metadata
INSERT IGNORE INTO wp_commentmeta (comment_id, meta_key, meta_value)
SELECT
    COALESCE(m.new_id, cm.comment_id) as comment_id,
    cm.meta_key,
    cm.meta_value
FROM maleqdb.p1bJcx_commentmeta cm
INNER JOIN comment_id_map m ON cm.comment_id = m.old_id;

-- ============================================================================
-- STEP 5: MIGRATE WOOCOMMERCE ORDERS
-- ============================================================================

-- Migrate order posts
INSERT INTO wp_posts (
    post_author,
    post_date,
    post_date_gmt,
    post_content,
    post_title,
    post_excerpt,
    post_status,
    comment_status,
    ping_status,
    post_password,
    post_name,
    to_ping,
    pinged,
    post_modified,
    post_modified_gmt,
    post_content_filtered,
    post_parent,
    guid,
    menu_order,
    post_type,
    post_mime_type,
    comment_count
)
SELECT
    COALESCE(m.new_id, p.post_author) as post_author,
    p.post_date,
    p.post_date_gmt,
    p.post_content,
    p.post_title,
    p.post_excerpt,
    p.post_status,
    p.comment_status,
    p.ping_status,
    p.post_password,
    p.post_name,
    p.to_ping,
    p.pinged,
    p.post_modified,
    p.post_modified_gmt,
    p.post_content_filtered,
    p.post_parent,
    p.guid,
    p.menu_order,
    p.post_type,
    p.post_mime_type,
    p.comment_count
FROM maleqdb.p1bJcx_posts p
LEFT JOIN user_id_map m ON p.post_author = m.old_id
WHERE p.post_type = 'shop_order'
AND p.post_name NOT IN (SELECT post_name COLLATE utf8mb4_unicode_ci FROM wp_posts WHERE post_type = 'shop_order');

-- Update post_id_map with order IDs
INSERT INTO post_id_map (old_id, new_id)
SELECT p_old.ID, p_new.ID
FROM maleqdb.p1bJcx_posts p_old
INNER JOIN wp_posts p_new ON p_old.post_name COLLATE utf8mb4_unicode_ci = p_new.post_name
WHERE p_old.post_type = 'shop_order'
ON DUPLICATE KEY UPDATE new_id = VALUES(new_id);

-- Migrate order metadata (with user ID remapping for _customer_user)
INSERT IGNORE INTO wp_postmeta (post_id, meta_key, meta_value)
SELECT
    COALESCE(pm_map.new_id, pm.post_id) as post_id,
    pm.meta_key,
    CASE
        WHEN pm.meta_key = '_customer_user' THEN COALESCE(um.new_id, pm.meta_value)
        ELSE pm.meta_value
    END as meta_value
FROM maleqdb.p1bJcx_postmeta pm
INNER JOIN post_id_map pm_map ON pm.post_id = pm_map.old_id
INNER JOIN maleqdb.p1bJcx_posts p ON pm.post_id = p.ID
LEFT JOIN user_id_map um ON pm.meta_value = um.old_id AND pm.meta_key = '_customer_user'
WHERE p.post_type = 'shop_order';

-- Migrate order items
INSERT INTO wp_woocommerce_order_items (order_item_name, order_item_type, order_id)
SELECT
    oi.order_item_name,
    oi.order_item_type,
    COALESCE(pm.new_id, oi.order_id) as order_id
FROM maleqdb.p1bJcx_woocommerce_order_items oi
INNER JOIN post_id_map pm ON oi.order_id = pm.old_id;

-- Create mapping for order items
CREATE TEMPORARY TABLE order_item_id_map (
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
INSERT IGNORE INTO wp_woocommerce_order_itemmeta (order_item_id, meta_key, meta_value)
SELECT
    COALESCE(oim.new_id, oitmeta.order_item_id) as order_item_id,
    oitmeta.meta_key,
    oitmeta.meta_value
FROM maleqdb.p1bJcx_woocommerce_order_itemmeta oitmeta
INNER JOIN order_item_id_map oim ON oitmeta.order_item_id = oim.old_id;

-- ============================================================================
-- CLEANUP
-- ============================================================================

DROP TEMPORARY TABLE IF EXISTS user_id_map;
DROP TEMPORARY TABLE IF EXISTS post_id_map;
DROP TEMPORARY TABLE IF EXISTS comment_id_map;
DROP TEMPORARY TABLE IF EXISTS order_item_id_map;

-- ============================================================================
-- SUMMARY QUERY (Run this after migration to verify)
-- ============================================================================
-- SELECT
--     'Users' as Type, COUNT(*) as Count FROM wp_users
-- UNION ALL
-- SELECT 'Posts', COUNT(*) FROM wp_posts WHERE post_type = 'post' AND post_status = 'publish'
-- UNION ALL
-- SELECT 'Comments', COUNT(*) FROM wp_comments WHERE comment_approved = '1'
-- UNION ALL
-- SELECT 'Orders', COUNT(*) FROM wp_posts WHERE post_type = 'shop_order';
