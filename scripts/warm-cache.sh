#!/usr/bin/env bash
#
# Cache warming CLI — wraps the /api/admin/warm-cache endpoint.
#
# Usage:
#   ./scripts/warm-cache.sh start                  # Start warming all types
#   ./scripts/warm-cache.sh start product           # Warm products only
#   ./scripts/warm-cache.sh start product,brand 5   # Custom types + concurrency
#   ./scripts/warm-cache.sh status                  # Check progress
#   ./scripts/warm-cache.sh stop                    # Stop warming
#
# Environment:
#   ADMIN_API_KEY  — required (or set in .env)
#   BASE_URL       — optional, defaults to http://localhost:3000

set -euo pipefail

# Load .env if it exists
if [[ -f "$(dirname "$0")/../.env" ]]; then
  set -a
  source "$(dirname "$0")/../.env"
  set +a
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"
ENDPOINT="${BASE_URL}/api/admin/warm-cache"

if [[ -z "${ADMIN_API_KEY:-}" ]]; then
  echo "Error: ADMIN_API_KEY is not set. Export it or add it to .env"
  exit 1
fi

AUTH="Authorization: Bearer ${ADMIN_API_KEY}"

case "${1:-help}" in
  start)
    BODY="{}"
    if [[ -n "${2:-}" ]]; then
      # Convert comma-separated types to JSON array
      TYPES=$(echo "$2" | sed 's/,/","/g')
      BODY="{\"types\":[\"${TYPES}\"]"
      if [[ -n "${3:-}" ]]; then
        BODY="${BODY},\"concurrency\":${3}"
      fi
      BODY="${BODY}}"
    fi
    echo "Starting cache warming..."
    curl -s -X POST "$ENDPOINT" \
      -H "$AUTH" \
      -H "Content-Type: application/json" \
      -d "$BODY" | python3 -m json.tool 2>/dev/null || curl -s -X POST "$ENDPOINT" \
      -H "$AUTH" \
      -H "Content-Type: application/json" \
      -d "$BODY"
    echo
    ;;

  status)
    curl -s "$ENDPOINT" -H "$AUTH" | python3 -m json.tool 2>/dev/null || curl -s "$ENDPOINT" -H "$AUTH"
    echo
    ;;

  stop)
    echo "Stopping cache warming..."
    curl -s -X DELETE "$ENDPOINT" -H "$AUTH" | python3 -m json.tool 2>/dev/null || curl -s "$ENDPOINT" -H "$AUTH"
    echo
    ;;

  watch)
    echo "Watching cache warming progress (Ctrl+C to exit)..."
    while true; do
      clear
      echo "=== Cache Warming Status ($(date '+%H:%M:%S')) ==="
      echo
      curl -s "$ENDPOINT" -H "$AUTH" | python3 -m json.tool 2>/dev/null || curl -s "$ENDPOINT" -H "$AUTH"
      sleep 5
    done
    ;;

  *)
    echo "Cache Warming CLI"
    echo
    echo "Usage:"
    echo "  $0 start [types] [concurrency]   Start warming"
    echo "  $0 status                         Check progress"
    echo "  $0 stop                           Stop warming"
    echo "  $0 watch                          Live progress (refreshes every 5s)"
    echo
    echo "Examples:"
    echo "  $0 start                          # All types, concurrency 3"
    echo "  $0 start product                  # Products only"
    echo "  $0 start product,brand 5          # Products + brands, concurrency 5"
    echo "  $0 start blog                     # Blog pages only"
    echo
    echo "Types: blog, blog-category, blog-tag, category, brand, product"
    ;;
esac
