#!/usr/bin/env bash
# Show MySQL connection status and manage SSH tunnel.
#
# Usage:
#   bash scripts/db-toggle.sh           Show which DB will be used
#   bash scripts/db-toggle.sh tunnel    Start SSH tunnel for production access
#   bash scripts/db-toggle.sh kill      Kill the SSH tunnel

SOCKET_PATH="/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock"

show_status() {
  echo "=== MySQL Connection Status ==="
  echo ""

  if [ -e "$SOCKET_PATH" ]; then
    echo "  Local WP (socket):   AVAILABLE ✓"
    echo "  → Will use: LOCAL database (Local by Flywheel)"
  else
    echo "  Local WP (socket):   NOT RUNNING"
  fi

  echo ""

  if lsof -i :3307 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  SSH tunnel (3307):   RUNNING ✓"
    if [ ! -e "$SOCKET_PATH" ]; then
      echo "  → Will use: PRODUCTION database (wp.maleq.com)"
    fi
  else
    echo "  SSH tunnel (3307):   NOT RUNNING"
    if [ ! -e "$SOCKET_PATH" ]; then
      echo "  → WARNING: No database available! Start Local WP or run: bash scripts/db-toggle.sh tunnel"
    fi
  fi
  echo ""
  echo "Auto-fallback: local socket → production tunnel (no restart needed)"
}

start_tunnel() {
  if lsof -i :3307 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "SSH tunnel already running on port 3307"
  else
    echo "Starting SSH tunnel (port 3307 → hetzner:3306)..."
    ssh -f -N -L 3307:127.0.0.1:3306 hetzner
    sleep 1
    if lsof -i :3307 -sTCP:LISTEN >/dev/null 2>&1; then
      echo "SSH tunnel started successfully"
    else
      echo "WARNING: SSH tunnel may have failed to start"
    fi
  fi
}

kill_tunnel() {
  local pid
  pid=$(lsof -t -i :3307 -sTCP:LISTEN 2>/dev/null)
  if [ -n "$pid" ]; then
    kill "$pid"
    echo "SSH tunnel killed (PID $pid)"
  else
    echo "No SSH tunnel running on port 3307"
  fi
}

case "${1:-}" in
  tunnel)  start_tunnel ;;
  kill)    kill_tunnel ;;
  *)       show_status ;;
esac
