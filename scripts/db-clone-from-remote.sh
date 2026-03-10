#!/bin/bash

# Database Clone Script - Download from Remote
# Syncs the local WordPress database (Local by Flywheel) with production.
#
# Prerequisites:
#   - Local by Flywheel site must be running (MySQL via socket)
#   - SSH key auth to production server (ssh hetzner)
#
# Usage:
#   bash scripts/db-clone-from-remote.sh

set -e

echo "╔════════════════════════════════════════╗"
echo "║   Clone Database from Remote Server   ║"
echo "╚════════════════════════════════════════╝"
echo ""

detect_local_socket() {
  local run_root="$HOME/Library/Application Support/Local/run"
  if [ ! -d "$run_root" ]; then
    return
  fi

  find "$run_root" -mindepth 3 -maxdepth 3 -type s -path "*/mysql/mysqld.sock" -print 2>/dev/null \
    | while IFS= read -r sock; do
        printf '%s\t%s\n' "$(stat -f '%m' "$sock" 2>/dev/null || echo 0)" "$sock"
      done \
    | sort -nr \
    | head -n 1 \
    | cut -f2-
}

# Configuration - Production server (wp.maleq.com)
REMOTE_HOST="159.69.220.162"
REMOTE_USER="root"
REMOTE_DB_NAME="maleq-wp"
REMOTE_DB_USER="maleq-wp"
REMOTE_DB_PASS="S9meeDoehU8VPiHd1ByJ"

# Local by Flywheel database
LOCAL_SOCKET="${MYSQL_SOCKET:-$(detect_local_socket)}"
LOCAL_DB_NAME="local"
LOCAL_DB_USER="root"
LOCAL_DB_PASS="root"

BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/remote-backup-${TIMESTAMP}.sql"

MYSQL_CMD="mysql --socket=\"${LOCAL_SOCKET}\" -u ${LOCAL_DB_USER} -p${LOCAL_DB_PASS}"

# Verify local MySQL is reachable
if ! eval "$MYSQL_CMD -e 'SELECT 1'" &>/dev/null; then
  echo "✗ Cannot connect to local MySQL. Is Local by Flywheel running?"
  echo "  Socket: ${LOCAL_SOCKET}"
  exit 1
fi

# Verify SSH is reachable
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "${REMOTE_USER}@${REMOTE_HOST}" "echo ok" &>/dev/null; then
  echo "✗ Cannot SSH to ${REMOTE_HOST}. Check your connection."
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "Step 1: Exporting remote database..."
echo "  Remote: ${REMOTE_DB_NAME} @ ${REMOTE_HOST}"
echo "  Saving to: ${BACKUP_FILE}"
echo ""

ssh "${REMOTE_USER}@${REMOTE_HOST}" \
  "mysqldump --ssl-mode=REQUIRED --no-tablespaces -u ${REMOTE_DB_USER} -p'${REMOTE_DB_PASS}' -h 127.0.0.1 ${REMOTE_DB_NAME} \
  --single-transaction \
  --quick \
  --lock-tables=false 2>/dev/null" > "${BACKUP_FILE}"

echo "✓ Remote database exported successfully"
FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "  Backup file size: ${FILE_SIZE}"
echo ""

echo "Step 2: Dropping and recreating local database..."
eval "$MYSQL_CMD -e 'DROP DATABASE IF EXISTS \`${LOCAL_DB_NAME}\`; CREATE DATABASE \`${LOCAL_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'" 2>/dev/null
echo "✓ Local database recreated: ${LOCAL_DB_NAME}"
echo ""

echo "Step 3: Importing to local database..."
eval "$MYSQL_CMD ${LOCAL_DB_NAME}" < "${BACKUP_FILE}" 2>/dev/null

echo "✓ Database imported successfully"
echo ""

echo "Step 4: Updating WordPress URLs for local development..."
eval "$MYSQL_CMD ${LOCAL_DB_NAME}" 2>/dev/null <<'EOF'
UPDATE wp_options SET option_value = 'http://maleq-local.local' WHERE option_name = 'siteurl';
UPDATE wp_options SET option_value = 'http://maleq-local.local' WHERE option_name = 'home';
EOF
echo "✓ URLs updated to http://maleq-local.local"
echo ""

echo "Step 5: Verifying database..."
PRODUCT_COUNT=$(eval "$MYSQL_CMD ${LOCAL_DB_NAME} -N -e \"SELECT COUNT(*) FROM wp_posts WHERE post_type='product' AND post_status='publish';\"" 2>/dev/null)
CATEGORY_COUNT=$(eval "$MYSQL_CMD ${LOCAL_DB_NAME} -N -e \"SELECT COUNT(*) FROM wp_term_taxonomy WHERE taxonomy='product_cat';\"" 2>/dev/null)
TERM_COUNT=$(eval "$MYSQL_CMD ${LOCAL_DB_NAME} -N -e \"SELECT COUNT(*) FROM wp_terms;\"" 2>/dev/null)

echo "  Products:   ${PRODUCT_COUNT}"
echo "  Categories: ${CATEGORY_COUNT}"
echo "  Terms:      ${TERM_COUNT}"
echo ""

echo "════════════════════════════════════════"
echo "✓ Local database synced with production!"
echo "════════════════════════════════════════"
