-- Simplified Comment Migration Script
-- Migrates ONLY approved comments (skips spam, trash, pending, junk)
--
-- USAGE:
-- mysql -u maleq-staging -p maleq-staging < migrate-comments-simple.sql

SET collation_connection = 'utf8mb4_general_ci';
SET SESSION sql_mode = '';

-- ============================================================================
-- STATUS CHECK
-- ============================================================================

SELECT '=== BEFORE MIGRATION ===' as '';

SELECT 'Production Comments (Approved)' as Metric,
       COUNT(*) as Count
FROM maleqdb.p1bJcx_comments
WHERE comment_approved = '1';

SELECT 'Staging Comments (Approved)' as Metric,
       COUNT(*) as Count
FROM wp_comments
WHERE comment_approved = '1';

-- ============================================================================
-- MIGRATE COMMENTS (Batch approach for large dataset)
-- ============================================================================

-- First, let's insert comments in batches
-- We'll use a simple approach that doesn't require complex temporary table self-joins

INSERT IGNORE INTO wp_comments (
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
    -- Map post IDs
    COALESCE(
        (SELECT p_new.ID
         FROM maleqdb.p1bJcx_posts p_old
         INNER JOIN wp_posts p_new ON CONVERT(p_old.post_name USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(p_new.post_name USING utf8mb4) COLLATE utf8mb4_general_ci
         WHERE p_old.ID = c.comment_post_ID
         AND p_old.post_type = 'post'
         LIMIT 1),
        c.comment_post_ID
    ) as comment_post_ID,
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
    0 as comment_parent, -- We'll fix parent relationships in a second pass
    -- Map user IDs
    COALESCE(
        (SELECT u_new.ID
         FROM maleqdb.p1bJcx_users u_old
         INNER JOIN wp_users u_new ON CONVERT(u_old.user_login USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(u_new.user_login USING utf8mb4) COLLATE utf8mb4_general_ci
         WHERE u_old.ID = c.user_id
         LIMIT 1),
        c.user_id
    ) as user_id
FROM maleqdb.p1bJcx_comments c
WHERE c.comment_approved = '1'  -- ONLY APPROVED COMMENTS (NOT spam, trash, pending, junk)
-- Check that the post exists in staging
AND EXISTS (
    SELECT 1
    FROM maleqdb.p1bJcx_posts p_old
    INNER JOIN wp_posts p_new ON CONVERT(p_old.post_name USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(p_new.post_name USING utf8mb4) COLLATE utf8mb4_general_ci
    WHERE p_old.ID = c.comment_post_ID
    AND p_old.post_type = 'post'
)
-- Check that comment doesn't already exist
AND NOT EXISTS (
    SELECT 1 FROM wp_comments existing
    WHERE CONVERT(existing.comment_author_email USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(c.comment_author_email USING utf8mb4) COLLATE utf8mb4_general_ci
    AND existing.comment_date = c.comment_date
    AND CONVERT(existing.comment_content USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(c.comment_content USING utf8mb4) COLLATE utf8mb4_general_ci
);

SELECT 'Comments inserted' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- FIX PARENT COMMENT RELATIONSHIPS (for threaded comments)
-- ============================================================================

-- Create a permanent table for the mapping (we'll drop it at the end)
DROP TABLE IF EXISTS temp_comment_id_map;

CREATE TABLE temp_comment_id_map (
    old_id BIGINT(20) UNSIGNED,
    new_id BIGINT(20) UNSIGNED,
    old_parent_id BIGINT(20) UNSIGNED,
    PRIMARY KEY (old_id),
    KEY idx_parent (old_parent_id)
) ENGINE=InnoDB;

-- Build the mapping (use INSERT IGNORE to skip duplicates)
INSERT IGNORE INTO temp_comment_id_map (old_id, new_id, old_parent_id)
SELECT
    c_old.comment_ID as old_id,
    MIN(c_new.comment_ID) as new_id,  -- Take the first match if multiple
    c_old.comment_parent as old_parent_id
FROM maleqdb.p1bJcx_comments c_old
INNER JOIN maleqdb.p1bJcx_posts p_old ON c_old.comment_post_ID = p_old.ID
INNER JOIN wp_posts p_new ON CONVERT(p_old.post_name USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(p_new.post_name USING utf8mb4) COLLATE utf8mb4_general_ci
INNER JOIN wp_comments c_new ON
    c_new.comment_post_ID = p_new.ID
    AND CONVERT(c_old.comment_author_email USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(c_new.comment_author_email USING utf8mb4) COLLATE utf8mb4_general_ci
    AND c_old.comment_date = c_new.comment_date
    AND CONVERT(c_old.comment_content USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(c_new.comment_content USING utf8mb4) COLLATE utf8mb4_general_ci
WHERE c_old.comment_approved = '1'
AND p_old.post_type = 'post'
GROUP BY c_old.comment_ID, c_old.comment_parent;

SELECT 'Comment mappings created' as Metric, COUNT(*) as Count FROM temp_comment_id_map;

-- Now update parent IDs
UPDATE wp_comments c
INNER JOIN temp_comment_id_map map ON c.comment_ID = map.new_id
LEFT JOIN temp_comment_id_map parent_map ON map.old_parent_id = parent_map.old_id
SET c.comment_parent = COALESCE(parent_map.new_id, 0)
WHERE map.old_parent_id > 0;

SELECT 'Parent relationships fixed' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- MIGRATE COMMENT METADATA
-- ============================================================================

INSERT IGNORE INTO wp_commentmeta (comment_id, meta_key, meta_value)
SELECT
    map.new_id,
    cm.meta_key,
    cm.meta_value
FROM maleqdb.p1bJcx_commentmeta cm
INNER JOIN temp_comment_id_map map ON cm.comment_id = map.old_id;

SELECT 'Comment metadata inserted' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- UPDATE COMMENT COUNTS ON POSTS
-- ============================================================================

UPDATE wp_posts p
SET p.comment_count = (
    SELECT COUNT(*)
    FROM wp_comments c
    WHERE c.comment_post_ID = p.ID
    AND c.comment_approved = '1'
)
WHERE p.post_type = 'post';

SELECT 'Post comment counts updated' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- CLEANUP
-- ============================================================================

DROP TABLE IF EXISTS temp_comment_id_map;

-- ============================================================================
-- FINAL STATUS
-- ============================================================================

SELECT '=== AFTER MIGRATION ===' as '';

SELECT 'Production Comments (Approved)' as Metric,
       COUNT(*) as Count
FROM maleqdb.p1bJcx_comments
WHERE comment_approved = '1';

SELECT 'Staging Comments (Approved)' as Metric,
       COUNT(*) as Count
FROM wp_comments
WHERE comment_approved = '1';

SELECT 'Threaded Comments (with parents)' as Metric,
       COUNT(*) as Count
FROM wp_comments
WHERE comment_parent > 0;

-- Check for potential issues
SELECT '=== VERIFICATION ===' as '';

SELECT COUNT(*) as 'Approved comments in prod with posts NOT in staging'
FROM maleqdb.p1bJcx_comments c
LEFT JOIN maleqdb.p1bJcx_posts p_old ON c.comment_post_ID = p_old.ID
LEFT JOIN wp_posts p_new ON CONVERT(p_old.post_name USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(p_new.post_name USING utf8mb4) COLLATE utf8mb4_general_ci
WHERE c.comment_approved = '1'
AND p_new.ID IS NULL;

SELECT 'Migration Complete!' as '';
