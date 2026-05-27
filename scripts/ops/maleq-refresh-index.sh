#!/usr/bin/env bash
# Daily safety-net refresh of the Next.js in-memory product index.
# Real-time freshness comes from /api/revalidate webhooks; this catches
# anything mutated outside that webhook path (background scripts, manual
# DB edits) within 24h.
#
# Auth secret lives at /root/.maleq-cron-secret (chmod 600). It must match
# either CRON_SECRET or ADMIN_API_KEY in the Next.js runtime env.
#
# Bypasses Cloudflare's JS bot challenge by curling the Coolify origin
# directly (Host header still maleq.com so Traefik routes correctly, and
# the origin serves its own Let's Encrypt cert for maleq.com).
#
# --- Deployment on the WP VPS (ssh hetzner) ------------------------------
# 1. Install the script:
#      sudo cp scripts/ops/maleq-refresh-index.sh /usr/local/bin/
#      sudo chmod 755 /usr/local/bin/maleq-refresh-index.sh
#      sudo touch /var/log/maleq-refresh-index.log
#      sudo chmod 640 /var/log/maleq-refresh-index.log
# 2. Store the secret (paste value at prompt, never echoed):
#      sudo bash -c 'read -rs k && printf "%s" "$k" > /root/.maleq-cron-secret && chmod 600 /root/.maleq-cron-secret'
# 3. Add the cron line to root's crontab (`sudo crontab -e`):
#      0 4 * * * /usr/local/bin/maleq-refresh-index.sh
# 4. Smoke test:
#      sudo /usr/local/bin/maleq-refresh-index.sh && sudo tail -1 /var/log/maleq-refresh-index.log
# -------------------------------------------------------------------------
set -u

SECRET_FILE=/root/.maleq-cron-secret
COOLIFY_ORIGIN=46.224.227.119
ENDPOINT="https://maleq.com/api/cron/refresh-index"
LOG=/var/log/maleq-refresh-index.log

ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }

if [ ! -r "$SECRET_FILE" ]; then
  echo "$(ts) ERROR: secret file $SECRET_FILE not readable" >> "$LOG"
  exit 1
fi

SECRET=$(tr -d '[:space:]' < "$SECRET_FILE")
if [ -z "$SECRET" ]; then
  echo "$(ts) ERROR: secret file is empty" >> "$LOG"
  exit 1
fi

RESP=$(curl -sS --max-time 60 -w '\n%{http_code}' \
  --resolve "maleq.com:443:${COOLIFY_ORIGIN}" \
  -H "Authorization: Bearer ${SECRET}" \
  "$ENDPOINT" 2>&1)
HTTP_CODE=$(printf '%s' "$RESP" | tail -n1)
BODY=$(printf '%s' "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "$(ts) OK ${HTTP_CODE} ${BODY}" >> "$LOG"
  exit 0
else
  echo "$(ts) FAIL ${HTTP_CODE} ${BODY}" >> "$LOG"
  exit 1
fi
