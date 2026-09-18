#!/usr/bin/env bash
# Install (or reinstall) the ship-on-push watcher as a launchd agent on this
# Mac. Idempotent. `--remove` unloads it.
#
# Only on the Mac Mini. Two watchers would race each other into the registry
# and into the male-q Coolify application; ops/ship-watch.sh refuses to run
# anywhere else, and so does this.
#
# Do not install this until a hand-run `npm run ship` has been seen to work
# and the Coolify deployment log has been read to confirm the server PULLED
# the image rather than building it.
set -euo pipefail
cd "$(dirname "$0")/.."
LABEL=com.maleq.ship-watch
DEST=$HOME/Library/LaunchAgents/$LABEL.plist

if [ "${1:-}" = --remove ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$DEST"; echo "removed $LABEL"; exit 0
fi

WATCH_HOSTS=${MALEQ_SHIP_HOSTS:-"Lorens-Mac-mini-3 Lorens-Mini-3"}
here=$(/usr/sbin/scutil --get LocalHostName 2>/dev/null || hostname -s)
case " $WATCH_HOSTS " in
  *" $here "*) ;;
  *) echo "this is $here; the watcher belongs on $WATCH_HOSTS and must exist in one place only" >&2
     exit 1 ;;
esac

WORK=$HOME/.maleq-ship
mkdir -p "$HOME/Library/LaunchAgents" "$WORK"

# The watcher's own clone on the boot disk (launchd cannot read the external
# volume this checkout lives on). HTTPS with gh as the credential helper, so a
# fetch needs no ssh agent.
if [ ! -d "$WORK/repo/.git" ]; then
  git clone -q https://github.com/lorencouse/maleq-headless-nextjs.git "$WORK/repo"
fi
git -C "$WORK/repo" config credential.helper '!gh auth git-credential'
# Bring the clone to origin/main here too. The watcher self-updates on its own
# ticks, but a reinstall is what you reach for when the installed copy is too
# broken to tick, and leaving it on a stale commit makes the reinstall a no-op.
git -C "$WORK/repo" fetch -q origin main && git -C "$WORK/repo" reset -q --hard origin/main

# The one token it needs, out of this checkout's .env.local.
umask 077
grep -m1 '^COOLIFY_TOKEN=' .env.local > "$WORK/env"
umask 022
[ -s "$WORK/env" ] || { echo "no COOLIFY_TOKEN in .env.local" >&2; exit 1; }

sed -e "s|__REPO__|$WORK/repo|g" -e "s|__HOME__|$HOME|g" "ops/launchd/$LABEL.plist" > "$DEST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "installed $LABEL: main ships within a few minutes of a green push. log: $WORK/watch.log"
echo "pause with: touch $WORK/paused"
