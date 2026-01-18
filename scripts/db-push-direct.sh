#!/bin/bash

# Direct Database Push Script - No SSH Required
# ⚠️  WARNING: This will OVERWRITE the remote database!

set -e

echo "╔════════════════════════════════════════╗"
echo "║   Push Database (Direct Connection)   ║"
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
LOCAL_EXPORT="${BACKUP_DIR}/local-export-${TIMESTAMP}.sql"
REMOTE_BACKUP="${BACKUP_DIR}/remote-backup-before-upload-${TIMESTAMP}.sql"

mkdir -p "$BACKUP_DIR"

echo "⚠️  WARNING: This will OVERWRITE your remote database!"
echo "   Remote database: ${REMOTE_DB_NAME} at ${REMOTE_HOST}"
echo ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Upload cancelled."
  exit 0
fi

echo ""
echo "Step 1: Backing up remote database first..."

mysqldump -h "${REMOTE_HOST}" \
  -P "${REMOTE_PORT}" \
  -u "${REMOTE_DB_USER}" \
  -p"${REMOTE_DB_PASS}" \
  "${REMOTE_DB_NAME}" \
  --single-transaction \
  --quick \
  --lock-tables=false \
  --no-tablespaces > "${REMOTE_BACKUP}"

if [ $? -eq 0 ]; then
  FILE_SIZE=$(du -h "$REMOTE_BACKUP" | cut -f1)
  echo "✓ Remote database backed up (${FILE_SIZE})"
  echo ""
else
  echo "✗ Failed to backup remote database. Aborting upload."
  exit 1
fi

echo "Step 2: Exporting local database..."

mysqldump -u "${LOCAL_DB_USER}" ${LOCAL_DB_PASS:+-p"${LOCAL_DB_PASS}"} "${LOCAL_DB_NAME}" \
  --single-transaction \
  --quick \
  --lock-tables=false > "${LOCAL_EXPORT}"

if [ $? -eq 0 ]; then
  FILE_SIZE=$(du -h "$LOCAL_EXPORT" | cut -f1)
  echo "✓ Local database exported (${FILE_SIZE})"
  echo ""
else
  echo "✗ Failed to export local database"
  exit 1
fi

echo "Step 3: Updating WordPress URLs for production..."

sed -i.bak "s|http://localhost:3000|https://staging.maleq.com|g" "${LOCAL_EXPORT}"
echo "✓ URLs updated to https://staging.maleq.com"
echo ""

echo "Step 4: Uploading to remote server..."
echo "  (This may take a few minutes...)"
echo ""

mysql -h "${REMOTE_HOST}" \
  -P "${REMOTE_PORT}" \
  -u "${REMOTE_DB_USER}" \
  -p"${REMOTE_DB_PASS}" \
  "${REMOTE_DB_NAME}" < "${LOCAL_EXPORT}"

if [ $? -eq 0 ]; then
  echo "✓ Database uploaded successfully"
  echo ""
else
  echo "✗ Failed to upload database"
  echo "  Your remote backup is safe at: ${REMOTE_BACKUP}"
  exit 1
fi

echo "════════════════════════════════════════"
echo "✓ Database pushed to remote successfully!"
echo ""
echo "Backup files created:"
echo "  Remote backup: ${REMOTE_BACKUP}"
echo "  Local export:  ${LOCAL_EXPORT}"
echo ""
echo "If you need to restore the remote backup:"
echo "  mysql -h ${REMOTE_HOST} -u ${REMOTE_DB_USER} -p ${REMOTE_DB_NAME} < ${REMOTE_BACKUP}"
echo "════════════════════════════════════════"
