#!/usr/bin/env bash
# Fresh production DB backup (CLAUDE.md "Database Backup Policy").
# Streams mysqldump from the WP host over SSH, gzips locally into backups/,
# validates the archive, and writes <file>.status = DONE_OK | DONE_FAIL.
#
#   bash scripts/ops/prod-backup.sh            # foreground
#   nohup bash scripts/ops/prod-backup.sh &    # detached (takes several minutes)
set -u
cd "$(dirname "$0")/../.."
mkdir -p backups
OUT="backups/prod-backup-$(date +%Y%m%d_%H%M%S).sql.gz"
echo "$OUT"

# Credentials are read from wp-config.php on the server; nothing is echoed.
REMOTE='CFG=/home/maleq-wp/htdocs/wp.maleq.com/wp-config.php
DB=$(grep -oP "DB_NAME'"'"',\s*'"'"'\K[^'"'"']+" "$CFG")
U=$(grep -oP "DB_USER'"'"',\s*'"'"'\K[^'"'"']+" "$CFG")
P=$(grep -oP "DB_PASSWORD'"'"',\s*'"'"'\K[^'"'"']+" "$CFG")
mysqldump --ssl-mode=REQUIRED --no-tablespaces -u "$U" -p"$P" -h 127.0.0.1 "$DB" \
  --single-transaction --quick --lock-tables=false 2>/dev/null'

if ssh -o BatchMode=yes -o ConnectTimeout=10 root@159.69.220.162 "$REMOTE" | gzip -1 > "$OUT" \
   && gzip -t "$OUT"; then
  echo DONE_OK > "$OUT.status"
  echo "OK  $OUT ($(du -h "$OUT" | cut -f1))"
else
  echo DONE_FAIL > "$OUT.status"
  echo "FAILED $OUT" >&2
  exit 1
fi
