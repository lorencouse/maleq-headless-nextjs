#!/usr/bin/env bash
# Ship main when it is pushed and its checks are green. Run by launchd on the
# Mac Mini every two minutes (ops/launchd/com.maleq.ship-watch.plist).
#
# Each tick: fetch origin/main. If it is a commit this watcher has not shipped,
# ask GitHub whether that commit's unit-test run has finished. Green:
# ops/ship-local.sh builds it here and deploys it. Red: the commit is
# remembered as failed and left alone; the next push gets its own chance.
# Still running: try again next tick. A burst of pushes costs one ship, since
# each push cancels the previous push's checks.
#
# THIS RUNS ON THE MAC MINI AND NOWHERE ELSE. Two watchers would race each
# other into the same registry and the same Coolify application, and the loser
# deploys an image built from a different commit than the one it pinned. The
# hostname check below is the guard; MALEQ_SHIP_HOST overrides it if this ever
# moves to another machine, which is a move, not a second copy.
#
# Pause it with `touch ~/.maleq-ship/paused` (rm to resume): being behind on
# purpose is not something to alert about.
#
# State in ~/.maleq-ship: `shipped` is the last sha that went out, `failed` the
# shas whose checks were red, `watch.log` what happened, `repo` the watcher's
# own clone (on the BOOT DISK: launchd agents cannot read the external volume
# the working checkout lives on -- "Operation not permitted", macOS privacy)
# and `env` the token it needs.
#
# It runs from that clone and moves the clone to origin/main first, so the
# watcher and the ship script are always the committed versions.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
WORK=${MALEQ_SHIP_DIR:-$HOME/.maleq-ship}
export MALEQ_ENV_FILE=${MALEQ_ENV_FILE:-$WORK/env}
mkdir -p "$WORK"
log() { echo "$(date -u +%FT%TZ) $*"; }

WATCH_HOST=${MALEQ_SHIP_HOST:-Lorens-Mac-mini-3}
here=$(scutil --get LocalHostName 2>/dev/null || hostname -s)
if [ "$here" != "$WATCH_HOST" ]; then
  log "not shipping: this is $here, the watcher belongs on $WATCH_HOST"
  exit 0
fi

# How long main may sit unshipped before this is worth waking somebody over,
# and how rarely to repeat it. A cold build of this image plus the deploy is
# about fifteen minutes, so the threshold is comfortably past a ship that is
# simply working.
STALE_MINUTES=${STALE_MINUTES:-75}
ALERT_QUIET_HOURS=${ALERT_QUIET_HOURS:-6}

# The one thing retrying cannot fix is nobody knowing. A stalled ship is
# invisible from outside: maleq.com keeps serving the last image quite happily,
# so the first symptom is somebody noticing that a change they made hours ago
# is still not live.
alert() {   # alert <title> <body>
  local state=$WORK/last-alert
  if [ -f "$state" ] && [ -n "$(find "$state" -mmin "-$((ALERT_QUIET_HOURS * 60))" 2>/dev/null)" ]; then
    log "alert suppressed (one went out inside ${ALERT_QUIET_HOURS}h): $1"
    return
  fi
  osascript -e "display notification \"$2\" with title \"$1\"" >/dev/null 2>&1 || true
  touch "$state"
  log "ALERT: $1 - $2"
}

# Is a ship running right now? The same test ops/ship-local.sh applies to its
# own lock, so a build in progress is never mistaken for a stall.
ship_running() {
  local holder; holder=$(cat "$WORK/lock.d/pid" 2>/dev/null || true)
  [ -n "$holder" ] || return 1
  kill -0 "$holder" 2>/dev/null || return 1
  case "$(ps -p "$holder" -o command= 2>/dev/null)" in *ship-local*) ;; *) return 1 ;; esac
  return 0
}

git fetch -q origin main 2>/dev/null || { log "fetch failed"; exit 0; }
sha=$(git rev-parse origin/main)
# Self-update, only in the watcher's own clone: never reset a working checkout.
if [ "$PWD" = "$WORK/repo" ] && [ "$(git rev-parse HEAD)" != "$sha" ]; then
  git reset -q --hard "$sha"
  exec bash "$0" "$@"
fi
if [ "$sha" = "$(cat "$WORK/shipped" 2>/dev/null)" ]; then
  rm -f "$WORK/last-alert"   # level again: the next incident alerts at once
  exit 0
fi

[ -f "$WORK/paused" ] && exit 0   # paused on purpose, so being behind is not news

# Behind, for whatever reason: red checks, a failed ship, a build that hangs
# every tick. The cause differs, the consequence does not, so the alarm is on
# the consequence. Deliberately before the `failed` list is consulted.
age=$(( ($(date +%s) - $(git log -1 --format=%ct "$sha")) / 60 ))
if [ "$age" -ge "$STALE_MINUTES" ] && ! ship_running; then
  alert "Male Q: main is not shipping" \
    "origin/main ${sha:0:7} has been unshipped for ${age}m, so maleq.com is behind. See ~/.maleq-ship/watch.log."
fi

grep -qx "$sha" "$WORK/failed" 2>/dev/null && exit 0

# The push run for this exact commit. `gh run list --commit` matches the head
# sha the run was started for. test.yml is the gate: it is the only workflow
# this repo runs on push, and per CLAUDE.md it is what enforces the restricted
# product and attribute rules.
state=$(gh run list --workflow test.yml --event push --commit "$sha" --limit 1 \
          --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion // "")"' 2>/dev/null)
case "$state" in
  "completed success") ;;
  "completed cancelled")
    # Superseded by a newer push whose run is the one to wait for; only when
    # nothing newer exists is a cancelled run a dead end.
    exit 0 ;;
  completed*)
    log "${sha:0:7}: checks ${state#completed }, not shipping"
    echo "$sha" >> "$WORK/failed"
    exit 0 ;;
  *) exit 0 ;;   # queued, in progress, or not there yet
esac

# A boot disk full enough to wedge the colima VM fails every ship with "exec
# /usr/bin/buildctl: input/output error" (the VM image is sparse and only ever
# grows, so ext4 inside goes read only). house-finder's watcher owns the weekly
# fstrim that hands those blocks back -- two watchers trimming one shared VM is
# pointless -- so this one only declines to start a build that cannot finish.
free=$(df -g / | awk 'NR==2 {print $4}')
if [ "${free:-99}" -lt 10 ]; then
  alert "Male Q: the Mac Mini boot disk is nearly full" \
    "${free}G free. The colima VM goes read only and every build fails: colima ssh -- sudo fstrim -av"
  exit 0
fi

docker info >/dev/null 2>&1 || { log "starting colima"; colima start >/dev/null 2>&1 || { log "colima failed to start"; exit 0; }; }

log "${sha:0:7}: checks green, shipping"
if bash ops/ship-local.sh >> "$WORK/watch.log" 2>&1; then
  echo "$sha" > "$WORK/shipped"
  rm -f "$WORK/last-alert"
  log "${sha:0:7}: shipped"
else
  log "${sha:0:7}: ship failed (see watch.log); will retry next tick"
fi
