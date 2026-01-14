-- Check Migration Status
-- This script checks what data exists in production vs staging
--
-- USAGE:
-- mysql -u maleq-staging -p maleq-staging < check-migration-status.sql

SET collation_connection = 'utf8mb4_general_ci';

SELECT '============================================' as '';
SELECT '=== MIGRATION STATUS CHECK ===' as '';
SELECT '============================================' as '';

-- Posts
SELECT '--- POSTS ---' as '';
SELECT 'Production Posts' as Metric, COUNT(*) as Count, post_type
FROM maleqdb.p1bJcx_posts
WHERE post_status = 'publish' AND post_type IN ('post', 'page', 'product')
GROUP BY post_type;

SELECT 'Staging Posts' as Metric, COUNT(*) as Count, post_type
FROM wp_posts
WHERE post_status = 'publish' AND post_type IN ('post', 'page', 'product')
GROUP BY post_type;

-- Post Meta (including featured images)
SELECT '--- POST METADATA ---' as '';
SELECT 'Production Post Meta Records' as Metric, COUNT(*) as Count
FROM maleqdb.p1bJcx_postmeta;

SELECT 'Staging Post Meta Records' as Metric, COUNT(*) as Count
FROM wp_postmeta;

SELECT 'Production Featured Image Assignments' as Metric, COUNT(*) as Count
FROM maleqdb.p1bJcx_postmeta
WHERE meta_key = '_thumbnail_id';

SELECT 'Staging Featured Image Assignments' as Metric, COUNT(*) as Count
FROM wp_postmeta
WHERE meta_key = '_thumbnail_id';

-- Attachments (images)
SELECT '--- MEDIA/ATTACHMENTS ---' as '';
SELECT 'Production Attachments' as Metric, COUNT(*) as Count
FROM maleqdb.p1bJcx_posts
WHERE post_type = 'attachment';

SELECT 'Staging Attachments' as Metric, COUNT(*) as Count
FROM wp_posts
WHERE post_type = 'attachment';

-- Taxonomies
SELECT '--- CATEGORIES ---' as '';
SELECT 'Production Categories' as Metric, COUNT(*) as Count
FROM maleqdb.p1bJcx_terms t
INNER JOIN maleqdb.p1bJcx_term_taxonomy tt ON t.term_id = tt.term_id
WHERE tt.taxonomy = 'category';

SELECT 'Staging Categories' as Metric, COUNT(*) as Count
FROM wp_terms t
INNER JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
WHERE tt.taxonomy = 'category';

SELECT '--- TAGS ---' as '';
SELECT 'Production Tags' as Metric, COUNT(*) as Count
FROM maleqdb.p1bJcx_terms t
INNER JOIN maleqdb.p1bJcx_term_taxonomy tt ON t.term_id = tt.term_id
WHERE tt.taxonomy = 'post_tag';

SELECT 'Staging Tags' as Metric, COUNT(*) as Count
FROM wp_terms t
INNER JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
WHERE tt.taxonomy = 'post_tag';

-- Term Relationships (post-category/tag connections)
SELECT '--- TERM RELATIONSHIPS ---' as '';
SELECT 'Production Post-Term Relationships' as Metric, COUNT(*) as Count
FROM maleqdb.p1bJcx_term_relationships;

SELECT 'Staging Post-Term Relationships' as Metric, COUNT(*) as Count
FROM wp_term_relationships;

-- Sample: Show some posts with their featured images in production
SELECT '--- SAMPLE: Production Posts with Featured Images ---' as '';
SELECT
    p.ID,
    p.post_title,
    pm.meta_value as thumbnail_id,
    (SELECT guid FROM maleqdb.p1bJcx_posts WHERE ID = pm.meta_value) as image_url
FROM maleqdb.p1bJcx_posts p
INNER JOIN maleqdb.p1bJcx_postmeta pm ON p.ID = pm.post_id
WHERE p.post_type = 'post'
AND p.post_status = 'publish'
AND pm.meta_key = '_thumbnail_id'
LIMIT 10;

SELECT '============================================' as '';
SELECT 'Check complete!' as '';
SELECT '============================================' as '';
