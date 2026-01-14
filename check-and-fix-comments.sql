-- Check and Fix Comments Migration
-- Only migrates APPROVED comments (not junk, spam, or deleted)
--
-- USAGE:
-- mysql -u maleq-staging -p maleq-staging < check-and-fix-comments.sql

-- ============================================================================
-- STEP 1: CHECK CURRENT STATUS
-- ============================================================================

SELECT '=== MIGRATION STATUS REPORT ===' as '';

SELECT 'Production Comments (Approved)' as Metric,
       COUNT(*) as Count
FROM maleqdb.p1bJcx_comments
WHERE comment_approved = '1';

SELECT 'Production Comments (Other statuses)' as Metric,
       COUNT(*) as Count,
       GROUP_CONCAT(DISTINCT comment_approved) as Statuses
FROM maleqdb.p1bJcx_comments
WHERE comment_approved != '1';

SELECT 'Staging Comments (Approved)' as Metric,
       COUNT(*) as Count
FROM wp_comments
WHERE comment_approved = '1';

SELECT 'Comments per Status in Production' as '';
SELECT comment_approved as Status,
       COUNT(*) as Count,
       CASE comment_approved
           WHEN '1' THEN 'Approved (WILL MIGRATE)'
           WHEN '0' THEN 'Pending (SKIP)'
           WHEN 'spam' THEN 'Spam (SKIP)'
           WHEN 'trash' THEN 'Trash (SKIP)'
           ELSE 'Other (SKIP)'
       END as Description
FROM maleqdb.p1bJcx_comments
GROUP BY comment_approved;

-- ============================================================================
-- STEP 2: CREATE TEMPORARY TABLES FOR ID MAPPING
-- ============================================================================

DROP TEMPORARY TABLE IF EXISTS user_id_map;
DROP TEMPORARY TABLE IF EXISTS post_id_map;
DROP TEMPORARY TABLE IF EXISTS comment_id_map;

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
-- STEP 3: REBUILD ID MAPPINGS
-- ============================================================================

-- Set collation for this session to avoid collation conflicts
SET collation_connection = 'utf8mb4_general_ci';

-- Map old user IDs to new user IDs
INSERT INTO user_id_map (old_id, new_id)
SELECT u_old.ID, u_new.ID
FROM maleqdb.p1bJcx_users u_old
INNER JOIN wp_users u_new ON CONVERT(u_old.user_login USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(u_new.user_login USING utf8mb4) COLLATE utf8mb4_general_ci;

-- Map old post IDs to new post IDs
INSERT INTO post_id_map (old_id, new_id)
SELECT p_old.ID, p_new.ID
FROM maleqdb.p1bJcx_posts p_old
INNER JOIN wp_posts p_new ON CONVERT(p_old.post_name USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(p_new.post_name USING utf8mb4) COLLATE utf8mb4_general_ci
WHERE p_old.post_type = 'post';

-- ============================================================================
-- STEP 4: MIGRATE ANY MISSING APPROVED COMMENTS
-- ============================================================================

-- This will only insert comments that don't already exist
-- We identify duplicates by matching: post_id, author_email, date, and content
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
    0 as comment_parent, -- We'll fix parent IDs in the next step
    COALESCE(um.new_id, c.user_id) as user_id
FROM maleqdb.p1bJcx_comments c
LEFT JOIN post_id_map pm ON c.comment_post_ID = pm.old_id
LEFT JOIN user_id_map um ON c.user_id = um.old_id
WHERE c.comment_approved = '1'  -- ONLY APPROVED COMMENTS
AND pm.new_id IS NOT NULL       -- Post must exist in staging
AND NOT EXISTS (
    -- Check if comment already exists in staging
    SELECT 1 FROM wp_comments existing
    WHERE CONVERT(existing.comment_author_email USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(c.comment_author_email USING utf8mb4) COLLATE utf8mb4_general_ci
    AND existing.comment_date = c.comment_date
    AND CONVERT(existing.comment_content USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(c.comment_content USING utf8mb4) COLLATE utf8mb4_general_ci
    AND existing.comment_post_ID = COALESCE(pm.new_id, c.comment_post_ID)
);

SELECT 'Comments inserted in this run' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- STEP 5: BUILD COMPLETE COMMENT ID MAPPING
-- ============================================================================

-- Map old comment IDs to new comment IDs for ALL comments (not just newly inserted)
INSERT IGNORE INTO comment_id_map (old_id, new_id)
SELECT c_old.comment_ID, c_new.comment_ID
FROM maleqdb.p1bJcx_comments c_old
INNER JOIN post_id_map pm ON c_old.comment_post_ID = pm.old_id
INNER JOIN wp_comments c_new ON
    c_new.comment_post_ID = pm.new_id
    AND CONVERT(c_old.comment_author_email USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(c_new.comment_author_email USING utf8mb4) COLLATE utf8mb4_general_ci
    AND c_old.comment_date = c_new.comment_date
    AND CONVERT(c_old.comment_content USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(c_new.comment_content USING utf8mb4) COLLATE utf8mb4_general_ci
WHERE c_old.comment_approved = '1';

-- ============================================================================
-- STEP 6: FIX COMMENT PARENT RELATIONSHIPS FOR THREADED COMMENTS
-- ============================================================================

-- Update comment parent IDs using the mapping table
UPDATE wp_comments wc
INNER JOIN comment_id_map cim ON wc.comment_ID = cim.new_id
INNER JOIN maleqdb.p1bJcx_comments c_old ON c_old.comment_ID = cim.old_id
LEFT JOIN comment_id_map parent_map ON c_old.comment_parent = parent_map.old_id
SET wc.comment_parent = COALESCE(parent_map.new_id, 0)
WHERE c_old.comment_parent > 0;

SELECT 'Comment parent relationships fixed' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- STEP 7: MIGRATE COMMENT METADATA
-- ============================================================================

INSERT IGNORE INTO wp_commentmeta (comment_id, meta_key, meta_value)
SELECT
    COALESCE(m.new_id, cm.comment_id) as comment_id,
    cm.meta_key,
    cm.meta_value
FROM maleqdb.p1bJcx_commentmeta cm
INNER JOIN comment_id_map m ON cm.comment_id = m.old_id;

SELECT 'Comment metadata records inserted' as Metric, ROW_COUNT() as Count;

-- ============================================================================
-- STEP 8: UPDATE COMMENT COUNTS ON POSTS
-- ============================================================================

UPDATE wp_posts p
SET p.comment_count = (
    SELECT COUNT(*)
    FROM wp_comments c
    WHERE c.comment_post_ID = p.ID
    AND c.comment_approved = '1'
)
WHERE p.post_type = 'post';

-- ============================================================================
-- CLEANUP
-- ============================================================================

DROP TEMPORARY TABLE IF EXISTS user_id_map;
DROP TEMPORARY TABLE IF EXISTS post_id_map;
DROP TEMPORARY TABLE IF EXISTS comment_id_map;

-- ============================================================================
-- FINAL VERIFICATION
-- ============================================================================

SELECT '=== FINAL STATUS ===' as '';

SELECT 'Production Comments (Approved)' as Metric,
       COUNT(*) as Count
FROM maleqdb.p1bJcx_comments
WHERE comment_approved = '1';

SELECT 'Staging Comments (Approved)' as Metric,
       COUNT(*) as Count
FROM wp_comments
WHERE comment_approved = '1';

SELECT 'Comments with Parents (Threaded)' as Metric,
       COUNT(*) as Count
FROM wp_comments
WHERE comment_parent > 0;

-- Show any comments that might have failed to migrate
SELECT '=== POTENTIAL ISSUES ===' as '';

SELECT COUNT(*) as 'Comments in prod with missing posts in staging'
FROM maleqdb.p1bJcx_comments c
LEFT JOIN maleqdb.p1bJcx_posts p_old ON c.comment_post_ID = p_old.ID
LEFT JOIN wp_posts p_new ON CONVERT(p_old.post_name USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(p_new.post_name USING utf8mb4) COLLATE utf8mb4_general_ci
WHERE c.comment_approved = '1'
AND p_new.ID IS NULL;

SELECT 'Migration Complete!' as '';
