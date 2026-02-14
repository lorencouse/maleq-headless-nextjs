#!/usr/bin/env bash
# ============================================================
# wp_postmeta cleanup & OPTIMIZE for production DB (maleq-wp)
#
# What it does (in order):
#   1. Snapshots current table sizes
#   2. Backs up wp_postmeta + wp_posts + wp_options to a .sql.gz
#   3. Deletes stale import sync meta  (_stc_*, _wt_*)    ~322 K rows
#   4. Deletes dead plugin meta (litespeed*, _fl_builder*) ~1.8 K rows
#   5. Deletes truly orphan attachments + their meta       ~44 K rows
#   6. Cleans expired transients from wp_options
#   7. Runs OPTIMIZE TABLE on wp_postmeta + wp_options
#   8. Reports before / after sizes
#
# Requirements:
#   - SSH key access to root@159.69.220.162
#   - No SSH tunnel needed (runs commands directly on server)
#
# Usage:
#   bash scripts/db-cleanup-postmeta.sh
# ============================================================

set -euo pipefail

REMOTE_HOST="159.69.220.162"
REMOTE_USER="root"
DB_NAME="maleq-wp"
DB_USER="maleq-wp"
DB_PASS="S9meeDoehU8VPiHd1ByJ"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/root/backups"
BACKUP_FILE="${BACKUP_DIR}/postmeta_cleanup_backup_${TIMESTAMP}.sql.gz"

MYSQL_CMD="mysql -u ${DB_USER} -p'${DB_PASS}' -h 127.0.0.1 ${DB_NAME}"
MYSQLDUMP_CMD="mysqldump -u ${DB_USER} -p'${DB_PASS}' -h 127.0.0.1 ${DB_NAME}"

echo ""
echo "╔════════════════════════════════════════╗"
echo "║   wp_postmeta Cleanup — Production     ║"
echo "╚════════════════════════════════════════╝"
echo ""

# ------------------------------------------------------------------
# Step 0: Pre-flight — show what we're about to do
# ------------------------------------------------------------------
echo "Step 0: Pre-flight check..."
echo ""

ssh -o ConnectTimeout=10 "${REMOTE_USER}@${REMOTE_HOST}" "${MYSQL_CMD} -e \"
SELECT 'wp_postmeta' AS tbl,
  TABLE_ROWS AS rows_est,
  ROUND(DATA_LENGTH/1024/1024, 2) AS data_mb,
  ROUND(INDEX_LENGTH/1024/1024, 2) AS index_mb,
  ROUND((DATA_LENGTH + INDEX_LENGTH)/1024/1024, 2) AS total_mb
FROM information_schema.tables
WHERE table_schema='${DB_NAME}' AND table_name='wp_postmeta'
UNION ALL
SELECT 'wp_posts',
  TABLE_ROWS,
  ROUND(DATA_LENGTH/1024/1024, 2),
  ROUND(INDEX_LENGTH/1024/1024, 2),
  ROUND((DATA_LENGTH + INDEX_LENGTH)/1024/1024, 2)
FROM information_schema.tables
WHERE table_schema='${DB_NAME}' AND table_name='wp_posts'
UNION ALL
SELECT 'wp_options',
  TABLE_ROWS,
  ROUND(DATA_LENGTH/1024/1024, 2),
  ROUND(INDEX_LENGTH/1024/1024, 2),
  ROUND((DATA_LENGTH + INDEX_LENGTH)/1024/1024, 2)
FROM information_schema.tables
WHERE table_schema='${DB_NAME}' AND table_name='wp_options';
\""

echo ""
echo "Planned deletions:"
echo "  1. Stale sync meta (_stc_*, _wt_*)       ~322,000 rows"
echo "  2. Dead plugin meta (litespeed, fl_builder)  ~1,800 rows"
echo "  3. Truly orphan attachments + meta          ~44,000 rows"
echo "  4. Expired transients                       ~11 rows"
echo ""

if [[ "${1:-}" != "--yes" ]]; then
  read -p "Continue with backup + cleanup? [y/N] " confirm
  if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# ------------------------------------------------------------------
# Step 1: Backup
# ------------------------------------------------------------------
echo ""
echo "Step 1: Backing up wp_postmeta, wp_posts, wp_options..."
echo "  → ${BACKUP_FILE}"

ssh "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p ${BACKUP_DIR} && \
  ${MYSQLDUMP_CMD} wp_postmeta wp_posts wp_options --single-transaction --quick | gzip > ${BACKUP_FILE}"

BACKUP_SIZE=$(ssh "${REMOTE_USER}@${REMOTE_HOST}" "du -h ${BACKUP_FILE} | cut -f1")
echo "  ✓ Backup complete (${BACKUP_SIZE})"

# ------------------------------------------------------------------
# Step 2: Delete stale import sync meta
# ------------------------------------------------------------------
echo ""
echo "Step 2: Deleting stale sync meta (_stc_*, _wt_*)..."

DELETED=$(ssh "${REMOTE_USER}@${REMOTE_HOST}" "${MYSQL_CMD} -N -e \"
  SELECT COUNT(*) FROM wp_postmeta
  WHERE meta_key LIKE '_stc_%' OR meta_key LIKE '_wt_%';
\"")
echo "  Found: ${DELETED} rows"

ssh "${REMOTE_USER}@${REMOTE_HOST}" "${MYSQL_CMD} -e \"
  DELETE FROM wp_postmeta
  WHERE meta_key LIKE '_stc_%' OR meta_key LIKE '_wt_%';
\""
echo "  ✓ Deleted"

# ------------------------------------------------------------------
# Step 3: Delete dead plugin meta
# ------------------------------------------------------------------
echo ""
echo "Step 3: Deleting dead plugin meta (litespeed*, _fl_builder*)..."

DELETED=$(ssh "${REMOTE_USER}@${REMOTE_HOST}" "${MYSQL_CMD} -N -e \"
  SELECT COUNT(*) FROM wp_postmeta
  WHERE meta_key LIKE 'litespeed%' OR meta_key LIKE '_fl_builder%';
\"")
echo "  Found: ${DELETED} rows"

ssh "${REMOTE_USER}@${REMOTE_HOST}" "${MYSQL_CMD} -e \"
  DELETE FROM wp_postmeta
  WHERE meta_key LIKE 'litespeed%' OR meta_key LIKE '_fl_builder%';
\""
echo "  ✓ Deleted"

# ------------------------------------------------------------------
# Step 4: Delete truly orphan attachments + their meta
#
# "Truly orphan" = attachment whose parent post is gone
#                  AND not used as any product's _thumbnail_id
#                  AND not referenced in any _product_image_gallery
# ------------------------------------------------------------------
echo ""
echo "Step 4: Deleting truly orphan attachments..."

# Build a temp table of IDs to delete (avoids running the heavy
# subquery twice and keeps the DELETE simple).
ssh "${REMOTE_USER}@${REMOTE_HOST}" "${MYSQL_CMD} -e \"
  -- Temp table of attachment IDs that are safe to delete
  DROP TABLE IF EXISTS _tmp_orphan_ids;

  CREATE TEMPORARY TABLE _tmp_orphan_ids (id BIGINT PRIMARY KEY)
  SELECT a.ID AS id
  FROM wp_posts a
  WHERE a.post_type = 'attachment'
    AND a.post_parent NOT IN (
      SELECT ID FROM wp_posts WHERE post_status IN ('publish','draft','private')
    )
    AND a.ID NOT IN (
      SELECT CAST(meta_value AS UNSIGNED)
      FROM wp_postmeta WHERE meta_key = '_thumbnail_id' AND meta_value != ''
    )
    AND a.ID NOT IN (
      SELECT DISTINCT CAST(
        SUBSTRING_INDEX(SUBSTRING_INDEX(pm.meta_value, ',', n.n), ',', -1)
        AS UNSIGNED)
      FROM wp_postmeta pm
      CROSS JOIN (
        SELECT 1 n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5
        UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10
      ) n
      WHERE pm.meta_key = '_product_image_gallery' AND pm.meta_value != ''
    );

  SELECT COUNT(*) AS orphan_attachments FROM _tmp_orphan_ids;
\""

# Delete their postmeta first, then the posts themselves
ORPHAN_META=$(ssh "${REMOTE_USER}@${REMOTE_HOST}" "${MYSQL_CMD} -N -e \"
  SELECT COUNT(*) FROM wp_postmeta
  WHERE post_id IN (SELECT id FROM _tmp_orphan_ids);
\"")
echo "  Orphan attachment meta rows: ${ORPHAN_META}"

ssh "${REMOTE_USER}@${REMOTE_HOST}" "${MYSQL_CMD} -e \"
  DELETE pm FROM wp_postmeta pm
  INNER JOIN _tmp_orphan_ids t ON pm.post_id = t.id;

  DELETE p FROM wp_posts p
  INNER JOIN _tmp_orphan_ids t ON p.ID = t.id;

  DROP TABLE IF EXISTS _tmp_orphan_ids;
\""
echo "  ✓ Deleted orphan attachments + meta"

# ------------------------------------------------------------------
# Step 5: Clean expired transients
# ------------------------------------------------------------------
echo ""
echo "Step 5: Cleaning expired transients from wp_options..."

ssh "${REMOTE_USER}@${REMOTE_HOST}" "${MYSQL_CMD} -e \"
  DELETE a, b FROM wp_options a
  INNER JOIN wp_options b
    ON b.option_name = REPLACE(a.option_name, '_transient_timeout_', '_transient_')
  WHERE a.option_name LIKE '_transient_timeout_%'
    AND CAST(a.option_value AS UNSIGNED) < UNIX_TIMESTAMP();

  DELETE a, b FROM wp_options a
  INNER JOIN wp_options b
    ON b.option_name = REPLACE(a.option_name, '_site_transient_timeout_', '_site_transient_')
  WHERE a.option_name LIKE '_site_transient_timeout_%'
    AND CAST(a.option_value AS UNSIGNED) < UNIX_TIMESTAMP();
\""
echo "  ✓ Expired transients cleaned"

# ------------------------------------------------------------------
# Step 6: OPTIMIZE tables to reclaim disk space and rebuild indexes
# ------------------------------------------------------------------
echo ""
echo "Step 6: Running OPTIMIZE TABLE (this may take a few minutes)..."

ssh "${REMOTE_USER}@${REMOTE_HOST}" "${MYSQL_CMD} -e \"
  OPTIMIZE TABLE wp_postmeta;
  OPTIMIZE TABLE wp_posts;
  OPTIMIZE TABLE wp_options;
\""

echo "  ✓ Tables optimized"

# ------------------------------------------------------------------
# Step 7: After — report new sizes
# ------------------------------------------------------------------
echo ""
echo "════════════════════════════════════════"
echo "  AFTER CLEANUP"
echo "════════════════════════════════════════"

ssh "${REMOTE_USER}@${REMOTE_HOST}" "${MYSQL_CMD} -e \"
SELECT 'wp_postmeta' AS tbl,
  TABLE_ROWS AS rows_est,
  ROUND(DATA_LENGTH/1024/1024, 2) AS data_mb,
  ROUND(INDEX_LENGTH/1024/1024, 2) AS index_mb,
  ROUND((DATA_LENGTH + INDEX_LENGTH)/1024/1024, 2) AS total_mb
FROM information_schema.tables
WHERE table_schema='${DB_NAME}' AND table_name='wp_postmeta'
UNION ALL
SELECT 'wp_posts',
  TABLE_ROWS,
  ROUND(DATA_LENGTH/1024/1024, 2),
  ROUND(INDEX_LENGTH/1024/1024, 2),
  ROUND((DATA_LENGTH + INDEX_LENGTH)/1024/1024, 2)
FROM information_schema.tables
WHERE table_schema='${DB_NAME}' AND table_name='wp_posts'
UNION ALL
SELECT 'wp_options',
  TABLE_ROWS,
  ROUND(DATA_LENGTH/1024/1024, 2),
  ROUND(INDEX_LENGTH/1024/1024, 2),
  ROUND((DATA_LENGTH + INDEX_LENGTH)/1024/1024, 2)
FROM information_schema.tables
WHERE table_schema='${DB_NAME}' AND table_name='wp_options';
\"

echo ""
echo "Buffer pool status:"
ssh "${REMOTE_USER}@${REMOTE_HOST}" "${MYSQL_CMD} -e \"
  SELECT
    ROUND(@@innodb_buffer_pool_size/1024/1024) AS pool_mb,
    (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Innodb_buffer_pool_pages_free') AS free_pages,
    (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Innodb_buffer_pool_pages_total') AS total_pages;
\""

echo ""
echo "Backup saved at: ${REMOTE_HOST}:${BACKUP_FILE}"
echo ""
echo "Done! To restore if needed:"
echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} 'gunzip < ${BACKUP_FILE} | mysql -u ${DB_USER} -p\"***\" -h 127.0.0.1 ${DB_NAME}'"
echo ""
