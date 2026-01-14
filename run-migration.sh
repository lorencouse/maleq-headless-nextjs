#!/bin/bash

# WordPress Migration Runner Script
# Makes it easy to run migration scripts in the correct order

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DB_USER="maleq-staging"
DB_NAME="maleq-staging"

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}=== WordPress Data Migration Runner ===${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# Function to run SQL file
run_sql() {
    local file=$1
    local description=$2

    echo -e "${YELLOW}Running: $description${NC}"
    echo -e "File: $file"
    echo ""

    if [ ! -f "$file" ]; then
        echo -e "${RED}Error: File not found: $file${NC}"
        exit 1
    fi

    mysql -u "$DB_USER" -p "$DB_NAME" < "$file"

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Success${NC}"
    else
        echo -e "${RED}✗ Failed${NC}"
        exit 1
    fi
    echo ""
}

# Main menu
echo "Select an option:"
echo "1) Check migration status (preview)"
echo "2) Run complete migration"
echo "3) Verify featured images after migration"
echo "4) Run all (check, migrate, verify)"
echo "5) Rollback migration (preview only)"
echo ""
read -p "Enter choice [1-5]: " choice

case $choice in
    1)
        run_sql "check-migration-status.sql" "Checking migration status"
        ;;
    2)
        echo -e "${YELLOW}⚠️  This will migrate data from production to staging${NC}"
        read -p "Continue? (yes/no): " confirm
        if [ "$confirm" = "yes" ]; then
            run_sql "migrate-all-post-data.sql" "Running complete migration"
        else
            echo "Migration cancelled"
            exit 0
        fi
        ;;
    3)
        run_sql "verify-featured-images.sql" "Verifying featured images"
        ;;
    4)
        echo -e "${YELLOW}Running full migration sequence...${NC}"
        echo ""
        run_sql "check-migration-status.sql" "Step 1: Checking current status"

        echo -e "${YELLOW}⚠️  Ready to migrate data from production to staging${NC}"
        read -p "Continue with migration? (yes/no): " confirm
        if [ "$confirm" != "yes" ]; then
            echo "Migration cancelled"
            exit 0
        fi

        run_sql "migrate-all-post-data.sql" "Step 2: Running migration"
        run_sql "verify-featured-images.sql" "Step 3: Verifying results"

        echo -e "${GREEN}============================================${NC}"
        echo -e "${GREEN}Migration complete!${NC}"
        echo -e "${GREEN}============================================${NC}"
        echo ""
        echo -e "${YELLOW}Next steps:${NC}"
        echo "1. Sync image files from production to staging:"
        echo "   rsync -avz production:/path/to/wp-content/uploads/ /path/to/staging/wp-content/uploads/"
        echo ""
        echo "2. Test GraphQL API:"
        echo '   curl -X POST "https://staging.maleq.com/graphql" \'
        echo '     -H "Content-Type: application/json" \'
        echo '     -d '\''{"query":"query{posts(first:5){nodes{title featuredImage{node{sourceUrl}}}}}"}'\'' \'
        echo '     | jq'
        echo ""
        echo "3. Restart your Next.js dev server"
        ;;
    5)
        run_sql "rollback-migration.sql" "Rollback preview"
        echo -e "${YELLOW}To actually rollback, edit rollback-migration.sql and uncomment the DELETE statements${NC}"
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Done!${NC}"
echo -e "${BLUE}============================================${NC}"
