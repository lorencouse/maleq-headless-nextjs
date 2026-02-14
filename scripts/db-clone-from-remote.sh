#!/bin/bash

# Database Clone Script - Download from Remote
# This script downloads your remote WordPress database to work with locally

set -e

echo "╔════════════════════════════════════════╗"
echo "║   Clone Database from Remote Server   ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Configuration - Production server (wp.maleq.com)
REMOTE_HOST="159.69.220.162"
REMOTE_USER="root"
# SSH uses key-based auth (no password needed)
REMOTE_DB_NAME="maleq-wp"
REMOTE_DB_USER="maleq-wp"
REMOTE_DB_PASS="S9meeDoehU8VPiHd1ByJ"

LOCAL_DB_NAME="maleq_local"
LOCAL_DB_USER="root"
LOCAL_DB_PASS=""

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/remote-backup-${TIMESTAMP}.sql"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "Step 1: Exporting remote database..."
echo "  Remote: ${REMOTE_DB_NAME}"
echo "  Saving to: ${BACKUP_FILE}"
echo ""

# Export database from remote server
ssh -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" \
  "mysqldump -u ${REMOTE_DB_USER} -p'${REMOTE_DB_PASS}' -h 127.0.0.1 ${REMOTE_DB_NAME} \
  --single-transaction \
  --quick \
  --lock-tables=false" > "${BACKUP_FILE}"

if [ $? -eq 0 ]; then
  echo "✓ Remote database exported successfully"
  echo ""
else
  echo "✗ Failed to export remote database"
  exit 1
fi

# Check file size
FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "  Backup file size: ${FILE_SIZE}"
echo ""

echo "Step 2: Creating local database..."

# Drop and recreate local database
mysql -u "${LOCAL_DB_USER}" ${LOCAL_DB_PASS:+-p"${LOCAL_DB_PASS}"} -e "DROP DATABASE IF EXISTS ${LOCAL_DB_NAME};"
mysql -u "${LOCAL_DB_USER}" ${LOCAL_DB_PASS:+-p"${LOCAL_DB_PASS}"} -e "CREATE DATABASE ${LOCAL_DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "✓ Local database created: ${LOCAL_DB_NAME}"
echo ""

echo "Step 3: Importing to local database..."
mysql -u "${LOCAL_DB_USER}" ${LOCAL_DB_PASS:+-p"${LOCAL_DB_PASS}"} "${LOCAL_DB_NAME}" < "${BACKUP_FILE}"

if [ $? -eq 0 ]; then
  echo "✓ Database imported successfully"
  echo ""
else
  echo "✗ Failed to import database"
  exit 1
fi

echo "Step 4: Updating WordPress URLs for local development..."

# Update site URLs to localhost
mysql -u "${LOCAL_DB_USER}" ${LOCAL_DB_PASS:+-p"${LOCAL_DB_PASS}"} "${LOCAL_DB_NAME}" <<EOF
UPDATE wp_options SET option_value = 'http://localhost:3000' WHERE option_name = 'siteurl';
UPDATE wp_options SET option_value = 'http://localhost:3000' WHERE option_name = 'home';
EOF

echo "✓ URLs updated to http://localhost:3000"
echo ""

echo "Step 5: Verifying database..."
PRODUCT_COUNT=$(mysql -u "${LOCAL_DB_USER}" ${LOCAL_DB_PASS:+-p"${LOCAL_DB_PASS}"} "${LOCAL_DB_NAME}" -N -e "SELECT COUNT(*) FROM wp_posts WHERE post_type='product';")
CATEGORY_COUNT=$(mysql -u "${LOCAL_DB_USER}" ${LOCAL_DB_PASS:+-p"${LOCAL_DB_PASS}"} "${LOCAL_DB_NAME}" -N -e "SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='product_cat';")

echo "  Products: ${PRODUCT_COUNT}"
echo "  Categories: ${CATEGORY_COUNT}"
echo ""

echo "════════════════════════════════════════"
echo "✓ Database cloned successfully!"
echo ""
echo "Next steps:"
echo "  1. Update your .env file with local database credentials:"
echo "     DATABASE_HOST=localhost"
echo "     DATABASE_NAME=${LOCAL_DB_NAME}"
echo "     DATABASE_USER=${LOCAL_DB_USER}"
echo "     DATABASE_PASSWORD=${LOCAL_DB_PASS}"
echo ""
echo "  2. Run your import scripts"
echo ""
echo "  3. Upload changes with: ./scripts/db-push-to-remote.sh"
echo "════════════════════════════════════════"
