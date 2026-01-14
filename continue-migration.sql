-- Continue Migration - Term Relationships and Verification
-- This picks up where the previous migration stopped

SET collation_connection = 'utf8mb4_general_ci';
SET SESSION sql_mode = '';

SELECT '=== CONTINUING MIGRATION ===' as '';

-- ============================================================================
-- STEP 9: MIGRATE TERM RELATIONSHIPS FOR BLOG POSTS
-- ============================================================================

SELECT '--- STEP 9: Migrating Category/Tag Relationships ---' as '';

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
INNER JOIN wp_term_taxonomy tt_new ON t_new.term_id = tt_new.term_id
    AND CONVERT(tt_old.taxonomy USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(tt_new.taxonomy USING utf8mb4) COLLATE utf8mb4_general_ci
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

DROP TEMPORARY TABLE IF EXISTS post_id_map;
DROP TEMPORARY TABLE IF EXISTS term_id_map;

SELECT '============================================' as '';
SELECT '=== MIGRATION COMPLETE! ===' as '';
SELECT '============================================' as '';
