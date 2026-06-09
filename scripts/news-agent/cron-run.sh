#!/usr/bin/env bash
# News-agent scheduled run: draft → attach cover images → share approved → flush cache.
# Installed in maleq-wp's crontab (see docs/NEWS_AGENT.md). Logs per run; prunes >30d.
set -uo pipefail

export HOME=/home/maleq-wp
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH
BUN=/home/maleq-wp/.bun/bin/bun
WP=/usr/bin/wp
APP=/home/maleq-wp/news-agent
WPPATH=/home/maleq-wp/htdocs/wp.maleq.com
LOG_DIR="$APP/logs"

# DST-safe scheduling: cron fires hourly (server is UTC; this host's cron has no
# CRON_TZ). We gate on the user's local hour so the pipeline runs at 7am/12pm/5pm
# America/Los_Angeles regardless of PST/PDT. Override hours with NEWS_AGENT_HOURS.
RUN_HOURS="${NEWS_AGENT_HOURS:-07 12 17}"
LOCAL_HOUR="$(TZ=America/Los_Angeles date +%H)"
case " $RUN_HOURS " in
  *" $LOCAL_HOUR "*) ;;     # a scheduled hour — proceed
  *) exit 0 ;;             # any other hour — silent no-op
esac

cd "$APP" || { echo "cannot cd $APP"; exit 1; }
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/run-$(date +%Y%m%d_%H%M%S).log"

{
  echo "==== news-agent run: $(date) ===="
  echo "--- draft new stories ---"
  "$BUN" run scripts/news-agent/run.ts --write --yes --limit "${NEWS_AGENT_LIMIT:-6}"
  echo "--- attach cover images ---"
  "$BUN" run scripts/news-agent/attach-covers.ts --write --yes
  echo "--- share approved (published) posts ---"
  "$BUN" run scripts/news-agent/sync-shares.ts --write --yes
  echo "--- flush WP cache ---"
  "$WP" --path="$WPPATH" cache flush
  echo "==== done: $(date) ===="
} >> "$LOG" 2>&1

# Keep 30 days of logs.
find "$LOG_DIR" -name 'run-*.log' -mtime +30 -delete 2>/dev/null
exit 0
