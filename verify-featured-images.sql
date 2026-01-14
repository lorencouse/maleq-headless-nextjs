-- Verify Featured Images Migration
-- Quick script to check if featured images are properly set
--
-- USAGE:
-- mysql -u maleq-staging -p maleq-staging < verify-featured-images.sql

SELECT '=== FEATURED IMAGES VERIFICATION ===' as '';

-- Count posts with featured images
SELECT
    'Total Published Posts' as Metric,
    COUNT(*) as Count
FROM wp_posts
WHERE post_type = 'post' AND post_status = 'publish';

SELECT
    'Posts WITH Featured Images' as Metric,
    COUNT(DISTINCT p.ID) as Count
FROM wp_posts p
INNER JOIN wp_postmeta pm ON p.ID = pm.post_id
WHERE p.post_type = 'post'
AND p.post_status = 'publish'
AND pm.meta_key = '_thumbnail_id';

SELECT
    'Posts WITHOUT Featured Images' as Metric,
    COUNT(*) as Count
FROM wp_posts p
WHERE p.post_type = 'post'
AND p.post_status = 'publish'
AND NOT EXISTS (
    SELECT 1 FROM wp_postmeta pm
    WHERE pm.post_id = p.ID AND pm.meta_key = '_thumbnail_id'
);

-- Show details of first 10 posts with featured images
SELECT '=== Posts with Featured Images (Sample) ===' as '';
SELECT
    p.ID as post_id,
    p.post_title,
    p.post_name as slug,
    pm.meta_value as thumbnail_attachment_id,
    att.guid as image_url,
    att.post_mime_type as mime_type
FROM wp_posts p
INNER JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key = '_thumbnail_id'
INNER JOIN wp_posts att ON pm.meta_value = att.ID
WHERE p.post_type = 'post'
AND p.post_status = 'publish'
AND att.post_type = 'attachment'
ORDER BY p.post_date DESC
LIMIT 10;

-- Show posts without featured images (if any)
SELECT '=== Posts WITHOUT Featured Images (Sample) ===' as '';
SELECT
    p.ID as post_id,
    p.post_title,
    p.post_name as slug
FROM wp_posts p
WHERE p.post_type = 'post'
AND p.post_status = 'publish'
AND NOT EXISTS (
    SELECT 1 FROM wp_postmeta pm
    WHERE pm.post_id = p.ID AND pm.meta_key = '_thumbnail_id'
)
ORDER BY p.post_date DESC
LIMIT 10;
