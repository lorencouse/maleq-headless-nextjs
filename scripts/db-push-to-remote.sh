#!/bin/bash

# Database Push Script - Upload to Remote
# This script uploads your local database back to the remote server
# ⚠️  WARNING: This will OVERWRITE the remote database!

set -e

echo "╔════════════════════════════════════════╗"
echo "║   Push Database to Remote Server      ║"
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
LOCAL_EXPORT="${BACKUP_DIR}/local-export-${TIMESTAMP}.sql"
REMOTE_BACKUP="${BACKUP_DIR}/remote-backup-before-upload-${TIMESTAMP}.sql"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "⚠️  WARNING: This will OVERWRITE your remote database!"
echo "   Remote database: ${REMOTE_DB_NAME} on ${REMOTE_HOST}"
echo ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Upload cancelled."
  exit 0
fi

echo ""
echo "Step 1: Backing up remote database first..."

# Backup remote database before overwriting
ssh -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" \
  "mysqldump -u ${REMOTE_DB_USER} -p'${REMOTE_DB_PASS}' ${REMOTE_DB_NAME} \
  --single-transaction \
  --quick \
  --lock-tables=false" > "${REMOTE_BACKUP}"

if [ $? -eq 0 ]; then
  echo "✓ Remote database backed up to: ${REMOTE_BACKUP}"
  echo ""
else
  echo "✗ Failed to backup remote database. Aborting upload."
  exit 1
fi

echo "Step 2: Exporting local database..."

# Export local database
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

# Update URLs back to production in the export file
sed -i.bak "s|http://localhost:3000|https://wp.maleq.com|g" "${LOCAL_EXPORT}"
echo "✓ URLs updated to https://wp.maleq.com"
echo ""

echo "Step 4: Uploading to remote server..."

# Upload and import to remote server
cat "${LOCAL_EXPORT}" | ssh -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" \
  "mysql -u ${REMOTE_DB_USER} -p'${REMOTE_DB_PASS}' -h 127.0.0.1 ${REMOTE_DB_NAME}"

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
echo "  ssh ${REMOTE_USER}@${REMOTE_HOST}"
echo "  mysql -u ${REMOTE_DB_USER} -p ${REMOTE_DB_NAME} < [upload backup file]"
echo "════════════════════════════════════════"
