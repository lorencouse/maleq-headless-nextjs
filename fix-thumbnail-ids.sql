-- Fix Featured Image IDs
-- Updates _thumbnail_id to point to the correct attachment IDs in staging

SET collation_connection = 'utf8mb4_general_ci';

SELECT '=== FIXING THUMBNAIL IDS ===' as '';

-- Create mapping of old attachment IDs to new ones based on GUID
DROP TEMPORARY TABLE IF EXISTS attachment_mapping;
CREATE TEMPORARY TABLE attachment_mapping (
    old_id BIGINT(20) UNSIGNED,
    new_id BIGINT(20) UNSIGNED,
    PRIMARY KEY (old_id),
    KEY idx_new_id (new_id)
);

-- Build the mapping
INSERT INTO attachment_mapping (old_id, new_id)
SELECT p_old.ID as old_id, p_new.ID as new_id
FROM maleqdb.p1bJcx_posts p_old
INNER JOIN wp_posts p_new ON CONVERT(p_old.guid USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(p_new.guid USING utf8mb4) COLLATE utf8mb4_general_ci
WHERE p_old.post_type = 'attachment'
AND p_new.post_type = 'attachment';

SELECT 'Attachment mappings created' as Metric, COUNT(*) as Count FROM attachment_mapping;

-- Show sample of what will be updated
SELECT '--- Sample of thumbnail IDs to be fixed ---' as '';
SELECT
    p.ID as post_id,
    p.post_title,
    pm.meta_value as old_thumbnail_id,
    am.new_id as new_thumbnail_id
FROM wp_posts p
INNER JOIN wp_postmeta pm ON p.ID = pm.post_id
LEFT JOIN attachment_mapping am ON pm.meta_value = am.old_id
WHERE p.post_type = 'post'
AND pm.meta_key = '_thumbnail_id'
AND am.new_id IS NOT NULL
LIMIT 10;

-- Update the _thumbnail_id values
UPDATE wp_postmeta pm
INNER JOIN attachment_mapping am ON pm.meta_value = am.old_id
SET pm.meta_value = am.new_id
WHERE pm.meta_key = '_thumbnail_id';

SELECT 'Thumbnail IDs updated' as Metric, ROW_COUNT() as Count;

-- Verify the fix
SELECT '--- Verification: Posts with valid thumbnail IDs ---' as '';
SELECT
    p.ID as post_id,
    p.post_title,
    pm.meta_value as thumbnail_id,
    (SELECT guid FROM wp_posts WHERE ID = pm.meta_value) as image_url
FROM wp_posts p
INNER JOIN wp_postmeta pm ON p.ID = pm.post_id
WHERE p.post_type = 'post'
AND pm.meta_key = '_thumbnail_id'
LIMIT 10;

DROP TEMPORARY TABLE attachment_mapping;

SELECT '=== FIX COMPLETE ===' as '';
