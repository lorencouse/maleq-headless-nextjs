#!/bin/bash

# Database Connection Test Script
# Tests connectivity to both production and staging databases

echo "=================================="
echo "Database Connection Test"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test staging database
echo "Testing STAGING database connection..."
echo "Host: localhost (on server)"
echo "Database: maleq-staging"
echo "User: maleq-staging"
echo ""

if mysql -u maleq-staging -prpN5cAEDRS782RiGbURs maleq-staging -e "SELECT 'Connection successful!' as Status;" 2>/dev/null; then
    echo -e "${GREEN}✓ Staging database connection successful${NC}"

    # Count WordPress tables
    TABLE_COUNT=$(mysql -u maleq-staging -prpN5cAEDRS782RiGbURs maleq-staging -se "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'maleq-staging' AND table_name LIKE 'wp_%';")
    echo "  WordPress tables found: $TABLE_COUNT"

    # Check current data
    echo ""
    echo "Current staging database content:"
    mysql -u maleq-staging -prpN5cAEDRS782RiGbURs maleq-staging -e "
    SELECT 'Users' as Type, COUNT(*) as Count FROM wp_users
    UNION ALL
    SELECT 'Posts', COUNT(*) FROM p1bJcx_posts WHERE post_type = 'post'
    UNION ALL
    SELECT 'Comments', COUNT(*) FROM p1bJcx_comments
    UNION ALL
    SELECT 'Orders', COUNT(*) FROM p1bJcx_posts WHERE post_type = 'shop_order';
    " 2>/dev/null
else
    echo -e "${RED}✗ Staging database connection failed${NC}"
    echo "  Please check credentials and database status"
fi

echo ""
echo "=================================="
echo ""

# Test production database
echo "Testing PRODUCTION database connection..."
echo "Host: localhost (on server)"
echo "Database: maleqdb"
echo "User: maleqcom"
echo ""

if mysql -u maleqcom -p'Snowdogs2@@' maleqdb -e "SELECT 'Connection successful!' as Status;" 2>/dev/null; then
    echo -e "${GREEN}✓ Production database connection successful${NC}"

    # Count content to migrate
    echo ""
    echo "Production database content (to be migrated):"
    mysql -u maleqcom -p'Snowdogs2@@' maleqdb -e "
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
    WHERE post_type = 'shop_order'
    UNION ALL
    SELECT 'Unique Users', COUNT(DISTINCT u.ID)
    FROM p1bJcx_users u
    WHERE u.ID IN (
        SELECT DISTINCT post_author FROM p1bJcx_posts WHERE post_type = 'post' AND post_status = 'publish'
        UNION
        SELECT DISTINCT user_id FROM p1bJcx_comments WHERE user_id > 0 AND comment_approved = '1'
        UNION
        SELECT DISTINCT pm.meta_value
        FROM p1bJcx_postmeta pm
        INNER JOIN p1bJcx_posts p ON pm.post_id = p.ID
        WHERE p.post_type = 'shop_order'
        AND pm.meta_key = '_customer_user'
        AND pm.meta_value > 0
    );
    " 2>/dev/null
else
    echo -e "${RED}✗ Production database connection failed${NC}"
    echo "  Please check credentials and database status"
fi

echo ""
echo "=================================="
echo "Test complete!"
echo "=================================="
