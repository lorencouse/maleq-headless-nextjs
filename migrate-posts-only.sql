-- Migrate ONLY Blog Posts and Their Featured Images
-- This script ONLY handles blog posts (post_type = 'post'), NOT products
--
-- USAGE:
-- mysql -u maleq-staging -p maleq-staging < migrate-posts-only.sql

SET collation_connection = 'utf8mb4_general_ci';
SET SESSION sql_mode = '';

SELECT '============================================' as '';
SELECT '=== BLOG POST FEATURED IMAGES MIGRATION ===' as '';
SELECT '============================================' as '';

-- ============================================================================
-- STEP 1: MIGRATE POST CATEGORIES
-- ============================================================================

SELECT '--- STEP 1: Migrating Post Categories ---' as '';

INSERT IGNORE INTO wp_terms (name, slug)
SELECT
    t.name,
    t.slug
FROM maleqdb.p1bJcx_terms t
INNER JOIN maleqdb.p1bJcx_term_taxonomy tt ON t.term_id = tt.term_id
WHERE tt.taxonomy = 'category'
AND NOT EXISTS (
    SELECT 1 FROM wp_terms wt
    WHERE CONVERT(wt.slug USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(t.slug USING utf8mb4) COLLATE utf8mb4_general_ci
);

SELECT 'Categories inserted' as Metric, ROW_COUNT() as Count;

INSERT IGNORE INTO wp_term_taxonomy (term_id, taxonomy, description, parent)
SELECT
    (SELECT wt.term_id FROM wp_terms wt
     WHERE CONVERT(wt.slug USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(t.slug USING utf8mb4) COLLATE utf8mb4_general_ci
     LIMIT 1),
    tt.taxonomy,
    tt.description,
    0
FROM maleqdb.p1bJcx_terms t
INNER JOIN maleqdb.p1bJcx_term_taxonomy tt ON t.term_id = tt.term_id
WHERE tt.taxonomy = 'category'
AND NOT EXISTS (
    SELECT 1 FROM wp_term_taxonomy wtt
    INNER JOIN wp_terms wt ON wtt.term_id = wt.term_id
    WHERE wtt.taxonomy = 'category'
    AND CONVERT(wt.slug USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(t.slug USING utf8mb4) COLLATE utf8mb4_general_ci
);

SELECT 'Category taxonomies created' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- STEP 2: MIGRATE POST TAGS
-- ============================================================================

SELECT '--- STEP 2: Migrating Post Tags ---' as '';

INSERT IGNORE INTO wp_terms (name, slug)
SELECT
    t.name,
    t.slug
FROM maleqdb.p1bJcx_terms t
INNER JOIN maleqdb.p1bJcx_term_taxonomy tt ON t.term_id = tt.term_id
WHERE tt.taxonomy = 'post_tag'
AND NOT EXISTS (
    SELECT 1 FROM wp_terms wt
    WHERE CONVERT(wt.slug USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(t.slug USING utf8mb4) COLLATE utf8mb4_general_ci
);

SELECT 'Tags inserted' as Metric, ROW_COUNT() as Count;

INSERT IGNORE INTO wp_term_taxonomy (term_id, taxonomy, description)
SELECT
    (SELECT wt.term_id FROM wp_terms wt
     WHERE CONVERT(wt.slug USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(t.slug USING utf8mb4) COLLATE utf8mb4_general_ci
     LIMIT 1),
    tt.taxonomy,
    tt.description
FROM maleqdb.p1bJcx_terms t
INNER JOIN maleqdb.p1bJcx_term_taxonomy tt ON t.term_id = tt.term_id
WHERE tt.taxonomy = 'post_tag'
AND NOT EXISTS (
    SELECT 1 FROM wp_term_taxonomy wtt
    INNER JOIN wp_terms wt ON wtt.term_id = wt.term_id
    WHERE wtt.taxonomy = 'post_tag'
    AND CONVERT(wt.slug USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(t.slug USING utf8mb4) COLLATE utf8mb4_general_ci
);

SELECT 'Tag taxonomies created' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- STEP 3: IDENTIFY POST FEATURED IMAGES ONLY
-- ============================================================================

SELECT '--- STEP 3: Identifying Featured Images for Blog Posts ---' as '';

-- Create temporary table to track which attachments are used by blog posts
DROP TEMPORARY TABLE IF EXISTS post_featured_images;
CREATE TEMPORARY TABLE post_featured_images (
    attachment_id BIGINT(20) UNSIGNED,
    PRIMARY KEY (attachment_id)
);

-- Find all attachments that are featured images for blog posts
INSERT INTO post_featured_images (attachment_id)
SELECT DISTINCT CAST(pm.meta_value AS UNSIGNED)
FROM maleqdb.p1bJcx_postmeta pm
INNER JOIN maleqdb.p1bJcx_posts p ON pm.post_id = p.ID
WHERE pm.meta_key = '_thumbnail_id'
AND p.post_type = 'post'  -- ONLY blog posts
AND p.post_status = 'publish';

SELECT 'Featured images for blog posts identified' as Metric, COUNT(*) as Count FROM post_featured_images;

-- ============================================================================
-- STEP 4: MIGRATE ONLY ATTACHMENTS USED BY BLOG POSTS
-- ============================================================================

SELECT '--- STEP 4: Migrating Blog Post Featured Images ---' as '';

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
    post_name,
    post_modified,
    post_modified_gmt,
    post_parent,
    guid,
    menu_order,
    post_type,
    post_mime_type,
    comment_count
)
SELECT
    COALESCE(
        (SELECT wu.ID FROM maleqdb.p1bJcx_users pu
         INNER JOIN wp_users wu ON CONVERT(pu.user_login USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(wu.user_login USING utf8mb4) COLLATE utf8mb4_general_ci
         WHERE pu.ID = p.post_author LIMIT 1),
        p.post_author
    ),
    p.post_date,
    p.post_date_gmt,
    p.post_content,
    p.post_title,
    p.post_excerpt,
    p.post_status,
    p.comment_status,
    p.ping_status,
    p.post_name,
    p.post_modified,
    p.post_modified_gmt,
    0,
    p.guid,
    p.menu_order,
    p.post_type,
    p.post_mime_type,
    p.comment_count
FROM maleqdb.p1bJcx_posts p
INNER JOIN post_featured_images pfi ON p.ID = pfi.attachment_id
WHERE p.post_type = 'attachment'
AND NOT EXISTS (
    SELECT 1 FROM wp_posts wp
    WHERE CONVERT(wp.guid USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(p.guid USING utf8mb4) COLLATE utf8mb4_general_ci
);

SELECT 'Blog post attachments inserted' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- STEP 5: MIGRATE ATTACHMENT METADATA FOR BLOG POST IMAGES
-- ============================================================================

SELECT '--- STEP 5: Migrating Attachment Metadata ---' as '';

INSERT IGNORE INTO wp_postmeta (post_id, meta_key, meta_value)
SELECT
    (SELECT wp.ID FROM wp_posts wp
     INNER JOIN maleqdb.p1bJcx_posts pp ON CONVERT(pp.guid USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(wp.guid USING utf8mb4) COLLATE utf8mb4_general_ci
     WHERE pp.ID = pm.post_id AND pp.post_type = 'attachment' AND wp.post_type = 'attachment'
     LIMIT 1),
    pm.meta_key,
    pm.meta_value
FROM maleqdb.p1bJcx_postmeta pm
INNER JOIN post_featured_images pfi ON pm.post_id = pfi.attachment_id
INNER JOIN maleqdb.p1bJcx_posts p ON pm.post_id = p.ID
WHERE p.post_type = 'attachment'
AND EXISTS (
    SELECT 1 FROM wp_posts wp
    INNER JOIN maleqdb.p1bJcx_posts pp ON CONVERT(pp.guid USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(wp.guid USING utf8mb4) COLLATE utf8mb4_general_ci
    WHERE pp.ID = pm.post_id AND pp.post_type = 'attachment' AND wp.post_type = 'attachment'
);

SELECT 'Attachment metadata records inserted' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- STEP 6: CREATE POST ID MAPPING
-- ============================================================================

SELECT '--- STEP 6: Creating Post ID Mappings ---' as '';

DROP TEMPORARY TABLE IF EXISTS post_id_map;
CREATE TEMPORARY TABLE post_id_map (
    old_id BIGINT(20) UNSIGNED,
    new_id BIGINT(20) UNSIGNED,
    PRIMARY KEY (old_id)
);

INSERT INTO post_id_map (old_id, new_id)
SELECT p_old.ID, p_new.ID
FROM maleqdb.p1bJcx_posts p_old
INNER JOIN wp_posts p_new ON CONVERT(p_old.post_name USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(p_new.post_name USING utf8mb4) COLLATE utf8mb4_general_ci
WHERE p_old.post_type = 'post' AND p_new.post_type = 'post';

SELECT 'Post ID mappings created' as Metric, COUNT(*) as Count FROM post_id_map;

-- ============================================================================
-- STEP 7: CREATE ATTACHMENT ID MAPPING
-- ============================================================================

SELECT '--- STEP 7: Creating Attachment ID Mappings ---' as '';

DROP TEMPORARY TABLE IF EXISTS attachment_id_map;
CREATE TEMPORARY TABLE attachment_id_map (
    old_id BIGINT(20) UNSIGNED,
    new_id BIGINT(20) UNSIGNED,
    PRIMARY KEY (old_id)
);

INSERT INTO attachment_id_map (old_id, new_id)
SELECT p_old.ID, p_new.ID
FROM maleqdb.p1bJcx_posts p_old
INNER JOIN wp_posts p_new ON CONVERT(p_old.guid USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(p_new.guid USING utf8mb4) COLLATE utf8mb4_general_ci
WHERE p_old.post_type = 'attachment' AND p_new.post_type = 'attachment';

SELECT 'Attachment ID mappings created' as Metric, COUNT(*) as Count FROM attachment_id_map;

-- ============================================================================
-- STEP 8: MIGRATE POST METADATA (FEATURED IMAGES ONLY)
-- ============================================================================

SELECT '--- STEP 8: Migrating Post Featured Image Assignments ---' as '';

-- Only migrate _thumbnail_id (featured image) metadata for blog posts
INSERT IGNORE INTO wp_postmeta (post_id, meta_key, meta_value)
SELECT
    pm_map.new_id,
    pm.meta_key,
    COALESCE(am.new_id, pm.meta_value)
FROM maleqdb.p1bJcx_postmeta pm
INNER JOIN post_id_map pm_map ON pm.post_id = pm_map.old_id
LEFT JOIN attachment_id_map am ON pm.meta_key = '_thumbnail_id' AND pm.meta_value = am.old_id
WHERE pm.meta_key = '_thumbnail_id';  -- ONLY featured images

SELECT 'Featured image assignments inserted' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- STEP 9: MIGRATE TERM RELATIONSHIPS FOR BLOG POSTS
-- ============================================================================

SELECT '--- STEP 9: Migrating Category/Tag Relationships ---' as '';

DROP TEMPORARY TABLE IF EXISTS term_id_map;
CREATE TEMPORARY TABLE term_id_map (
    old_term_taxonomy_id BIGINT(20) UNSIGNED,
    new_term_taxonomy_id BIGINT(20) UNSIGNED,
    PRIMARY KEY (old_term_taxonomy_id)
);

INSERT INTO term_id_map (old_term_taxonomy_id, new_term_taxonomy_id)
SELECT tt_old.term_taxonomy_id, tt_new.term_taxonomy_id
FROM maleqdb.p1bJcx_term_taxonomy tt_old
INNER JOIN maleqdb.p1bJcx_terms t_old ON tt_old.term_id = t_old.term_id
INNER JOIN wp_terms t_new ON CONVERT(t_old.slug USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(t_new.slug USING utf8mb4) COLLATE utf8mb4_general_ci
INNER JOIN wp_term_taxonomy tt_new ON t_new.term_id = tt_new.term_id AND CONVERT(tt_old.taxonomy USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(tt_new.taxonomy USING utf8mb4) COLLATE utf8mb4_general_ci
WHERE tt_old.taxonomy IN ('category', 'post_tag');

SELECT 'Term taxonomy ID mappings created' as Metric, COUNT(*) as Count FROM term_id_map;

INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
SELECT
    pm.new_id,
    tm.new_term_taxonomy_id,
    tr.term_order
FROM maleqdb.p1bJcx_term_relationships tr
INNER JOIN post_id_map pm ON tr.object_id = pm.old_id
INNER JOIN term_id_map tm ON tr.term_taxonomy_id = tm.old_term_taxonomy_id;

SELECT 'Term relationships inserted' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- STEP 10: UPDATE TERM COUNTS
-- ============================================================================

SELECT '--- STEP 10: Updating Term Counts ---' as '';

UPDATE wp_term_taxonomy tt
SET count = (
    SELECT COUNT(*)
    FROM wp_term_relationships tr
    INNER JOIN wp_posts p ON tr.object_id = p.ID
    WHERE tr.term_taxonomy_id = tt.term_taxonomy_id
    AND p.post_status = 'publish'
    AND p.post_type = 'post'
)
WHERE tt.taxonomy IN ('category', 'post_tag');

SELECT 'Term counts updated' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- STEP 11: VERIFY RESULTS
-- ============================================================================

SELECT '--- STEP 11: Verification ---' as '';

SELECT 'Blog Posts with Featured Images' as Metric, COUNT(DISTINCT p.ID) as Count
FROM wp_posts p
INNER JOIN wp_postmeta pm ON p.ID = pm.post_id
WHERE p.post_type = 'post'
AND p.post_status = 'publish'
AND pm.meta_key = '_thumbnail_id';

SELECT '--- Sample Blog Posts with Featured Images ---' as '';
SELECT
    p.ID,
    p.post_title,
    pm.meta_value as thumbnail_id,
    (SELECT guid FROM wp_posts WHERE ID = pm.meta_value) as image_url
FROM wp_posts p
INNER JOIN wp_postmeta pm ON p.ID = pm.post_id
WHERE p.post_type = 'post'
AND p.post_status = 'publish'
AND pm.meta_key = '_thumbnail_id'
LIMIT 10;

-- ============================================================================
-- CLEANUP
-- ============================================================================

DROP TEMPORARY TABLE IF EXISTS post_featured_images;
DROP TEMPORARY TABLE IF EXISTS post_id_map;
DROP TEMPORARY TABLE IF EXISTS attachment_id_map;
DROP TEMPORARY TABLE IF EXISTS term_id_map;

SELECT '============================================' as '';
SELECT '=== BLOG POST MIGRATION COMPLETE! ===' as '';
SELECT '============================================' as '';
