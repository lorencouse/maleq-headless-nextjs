#!/usr/bin/env bash
# Show MySQL connection status and manage SSH tunnel.
#
# Usage:
#   bash scripts/db-toggle.sh           Show which DB will be used
#   bash scripts/db-toggle.sh tunnel    Start SSH tunnel for production access
#   bash scripts/db-toggle.sh kill      Kill the SSH tunnel

detect_socket_path() {
  if [ -n "${MYSQL_LOCAL_SOCKET:-}" ] && [ -e "${MYSQL_LOCAL_SOCKET}" ]; then
    echo "${MYSQL_LOCAL_SOCKET}"
    return
  fi

  local run_root="$HOME/Library/Application Support/Local/run"
  if [ ! -d "$run_root" ]; then
    return
  fi

  # Pick the most recently updated Local run socket.
  find "$run_root" -mindepth 3 -maxdepth 3 -type s -path "*/mysql/mysqld.sock" -print 2>/dev/null \
    | while IFS= read -r sock; do
        printf '%s\t%s\n' "$(stat -f '%m' "$sock" 2>/dev/null || echo 0)" "$sock"
      done \
    | sort -nr \
    | head -n 1 \
    | cut -f2-
}

show_status() {
  local socket_path
  socket_path="$(detect_socket_path)"

  echo "=== MySQL Connection Status ==="
  echo ""

  if [ -n "$socket_path" ] && [ -e "$socket_path" ]; then
    echo "  Local WP (socket):   AVAILABLE ✓"
    echo "  Local socket:        $socket_path"
    echo "  → Will use: LOCAL database (Local by Flywheel)"
  else
    echo "  Local WP (socket):   NOT RUNNING"
  fi

  echo ""

  if lsof -i :3307 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  SSH tunnel (3307):   RUNNING ✓"
    if [ -z "$socket_path" ] || [ ! -e "$socket_path" ]; then
      echo "  → Will use: PRODUCTION database (wp.maleq.com)"
    fi
  else
    echo "  SSH tunnel (3307):   NOT RUNNING"
    if [ -z "$socket_path" ] || [ ! -e "$socket_path" ]; then
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
