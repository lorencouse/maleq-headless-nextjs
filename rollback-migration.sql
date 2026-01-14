-- Rollback Migration Script
-- Use this ONLY if you need to undo the migration and start fresh
-- WARNING: This will delete migrated data from staging!
--
-- USAGE:
-- mysql -u maleq-staging -p maleq-staging < rollback-migration.sql

SELECT '============================================' as '';
SELECT '=== MIGRATION ROLLBACK ===' as '';
SELECT 'WARNING: This will delete migrated data!' as '';
SELECT '============================================' as '';

-- Show what will be deleted
SELECT 'Categories to be removed' as Metric, COUNT(*) as Count
FROM wp_term_taxonomy
WHERE taxonomy = 'category' AND term_taxonomy_id > 1;

SELECT 'Tags to be removed' as Metric, COUNT(*) as Count
FROM wp_term_taxonomy
WHERE taxonomy = 'post_tag';

SELECT 'Attachments to be removed' as Metric, COUNT(*) as Count
FROM wp_posts
WHERE post_type = 'attachment';

SELECT 'Post metadata records to be removed' as Metric, COUNT(*) as Count
FROM wp_postmeta;

-- Uncomment the lines below to actually perform the rollback
-- CAUTION: This is destructive!

-- DELETE FROM wp_term_relationships;
-- DELETE FROM wp_term_taxonomy WHERE taxonomy IN ('category', 'post_tag') AND term_taxonomy_id > 1;
-- DELETE FROM wp_terms WHERE term_id > 1;
-- DELETE FROM wp_postmeta;
-- DELETE FROM wp_posts WHERE post_type = 'attachment';

SELECT '============================================' as '';
SELECT 'Rollback script complete (preview mode)' as '';
SELECT 'Uncomment DELETE statements to actually rollback' as '';
SELECT '============================================' as '';
