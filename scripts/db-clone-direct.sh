#!/bin/bash

# Direct Database Clone Script - No SSH Required
# This script connects directly to the remote MySQL server

set -e

echo "╔════════════════════════════════════════╗"
echo "║   Clone Database (Direct Connection)  ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Configuration
REMOTE_HOST="159.69.220.162"
REMOTE_PORT="3306"
REMOTE_DB_NAME="maleq-staging"
REMOTE_DB_USER="maleq-staging"
REMOTE_DB_PASS="rpN5cAEDRS782RiGbURs"

LOCAL_DB_NAME="maleq_local"
LOCAL_DB_USER="root"
LOCAL_DB_PASS=""

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/remote-backup-${TIMESTAMP}.sql"

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "Step 1: Testing remote database connection..."
if mysql -h "${REMOTE_HOST}" -P "${REMOTE_PORT}" -u "${REMOTE_DB_USER}" -p"${REMOTE_DB_PASS}" -e "SELECT 1;" "${REMOTE_DB_NAME}" > /dev/null 2>&1; then
  echo "✓ Successfully connected to remote database"
  echo ""
else
  echo "✗ Failed to connect to remote database"
  echo "  Please check your database credentials and firewall settings"
  exit 1
fi

echo "Step 2: Exporting remote database..."
echo "  Remote: ${REMOTE_DB_NAME} at ${REMOTE_HOST}"
echo "  Saving to: ${BACKUP_FILE}"
echo "  (This may take a few minutes...)"
echo ""

# Export database from remote server
mysqldump -h "${REMOTE_HOST}" \
  -P "${REMOTE_PORT}" \
  -u "${REMOTE_DB_USER}" \
  -p"${REMOTE_DB_PASS}" \
  "${REMOTE_DB_NAME}" \
  --single-transaction \
  --quick \
  --lock-tables=false \
  --no-tablespaces > "${BACKUP_FILE}"

if [ $? -eq 0 ]; then
  FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "✓ Remote database exported successfully (${FILE_SIZE})"
  echo ""
else
  echo "✗ Failed to export remote database"
  exit 1
fi

echo "Step 3: Dropping and recreating local database..."

mysql -u "${LOCAL_DB_USER}" ${LOCAL_DB_PASS:+-p"${LOCAL_DB_PASS}"} -e "DROP DATABASE IF EXISTS ${LOCAL_DB_NAME};"
mysql -u "${LOCAL_DB_USER}" ${LOCAL_DB_PASS:+-p"${LOCAL_DB_PASS}"} -e "CREATE DATABASE ${LOCAL_DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "✓ Local database recreated: ${LOCAL_DB_NAME}"
echo ""

echo "Step 4: Importing to local database..."
echo "  (This may take a few minutes...)"
echo ""

mysql -u "${LOCAL_DB_USER}" ${LOCAL_DB_PASS:+-p"${LOCAL_DB_PASS}"} "${LOCAL_DB_NAME}" < "${BACKUP_FILE}"

if [ $? -eq 0 ]; then
  echo "✓ Database imported successfully"
  echo ""
else
  echo "✗ Failed to import database"
  exit 1
fi

echo "Step 5: Updating WordPress URLs for local development..."

mysql -u "${LOCAL_DB_USER}" ${LOCAL_DB_PASS:+-p"${LOCAL_DB_PASS}"} "${LOCAL_DB_NAME}" <<EOF
UPDATE wp_options SET option_value = 'http://localhost:3000' WHERE option_name = 'siteurl';
UPDATE wp_options SET option_value = 'http://localhost:3000' WHERE option_name = 'home';
EOF

echo "✓ URLs updated to http://localhost:3000"
echo ""

echo "Step 6: Verifying database..."

PRODUCT_COUNT=$(mysql -u "${LOCAL_DB_USER}" ${LOCAL_DB_PASS:+-p"${LOCAL_DB_PASS}"} "${LOCAL_DB_NAME}" -N -e "SELECT COUNT(*) FROM wp_posts WHERE post_type='product';")
CATEGORY_COUNT=$(mysql -u "${LOCAL_DB_USER}" ${LOCAL_DB_PASS:+-p"${LOCAL_DB_PASS}"} "${LOCAL_DB_NAME}" -N -e "SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='product_cat';")

echo "  Products: ${PRODUCT_COUNT}"
echo "  Categories: ${CATEGORY_COUNT}"
echo ""

echo "════════════════════════════════════════"
echo "✓ Database cloned successfully!"
echo ""
echo "Next steps:"
echo "  1. Your local database is ready: ${LOCAL_DB_NAME}"
echo "  2. Run your import scripts against the local database"
echo "  3. Upload changes with: ./scripts/db-push-direct.sh"
echo ""
echo "Backup saved at: ${BACKUP_FILE}"
echo "════════════════════════════════════════"
