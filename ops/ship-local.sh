#!/usr/bin/env bash
# Build maleq.com's production image on this Mac and deploy it: `npm run ship`.
#
# What used to happen: Coolify built this Dockerfile ON THE SERVER, a 75G box
# it shares with the live wp.maleq.com WordPress and its MySQL. A Next.js
# build with 35k products in the index is not a small thing to do next to a
# production database, and the buildkit cache it leaves behind is what put
# that disk at 85% on 2026-09-17.
#
# What happens now: the Mac is arm64 like the server, so it builds the image
# natively, pushes it into the plain registry that runs on the Coolify host
# (kouzr-registry, 127.0.0.1:5000, loopback only) through an SSH tunnel, and
# then tells Coolify to deploy that exact tag. The server pulls and restarts.
# It builds nothing. This is the same path house-finder ships on; see
# ../house-finder/ops/ for the original.
#
# What it builds is ORIGIN/MAIN, checked out into a worktree of its own
# (~/.maleq-ship/main), never this working tree: a docker build context is
# whatever is on disk, so an image built from here would carry whatever
# half-finished edit happened to be sitting in app/ or lib/.
#
#   ops/ship-local.sh              build origin/main and deploy it
#   ops/ship-local.sh --dry-run    say what it would ship and stop
#   ops/ship-local.sh --build-only build and push, do not deploy
#
# Needs: docker (colima started), the automation key for the host, jq, and
# COOLIFY_TOKEN in .env.local (or MALEQ_ENV_FILE).
set -euo pipefail
if [ -n "${MALEQ_SHIP_ROOT:-}" ]; then cd "$MALEQ_SHIP_ROOT"; else cd "$(dirname "$0")/.."; fi
ROOT=$PWD

# Run from an immutable snapshot of this file.
#
# Bash reads a script incrementally AS IT RUNS, so editing this file during a
# ship -- easy to do, because a ship is fifteen minutes and this is the file
# you are most likely to be working on -- makes the shell resume at a shifted
# byte offset and execute whatever now sits there. On 2026-09-17 that ended a
# ship immediately after a successful push with "local: can only be used in a
# function", an exit code of 0, and no deploy at all: the worst shape of
# failure, a silent one that claims success.
if [ -z "${MALEQ_SHIP_REEXEC:-}" ]; then
  mkdir -p "${MALEQ_SHIP_DIR:-$HOME/.maleq-ship}"
  snap=$(mktemp "${MALEQ_SHIP_DIR:-$HOME/.maleq-ship}/ship-local.XXXXXX")
  cat "$0" > "$snap"
  trap 'rm -f "$snap"' EXIT INT TERM
  MALEQ_SHIP_REEXEC=1 MALEQ_SHIP_ROOT=$ROOT bash "$snap" "$@"
  exit $?
fi

dry=0 build_only=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1; shift ;;
    --build-only) build_only=1; shift ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

HOST=${REGISTRY_HOST:-46.224.227.119}
KEY=${REGISTRY_KEY:-$HOME/.ssh/kouzr_claude_automation}
COOLIFY_API=${COOLIFY_API:-https://admin.maleq.com/api/v1}
APP_UUID=${APP_UUID:-v88k8w4gkk08wsoco0s8w8c4}
# The image lives under its own prefix so the host's hourly retention sweep
# (house-finder's ops/registry-retain.sh) can tell maleq's tags from kouzr's.
# An unswept prefix fills that disk again in about a week.
REPO=${REPO:-maleq/web}
# Where the registry is from here (the tunnel) and from inside colima's VM
# (its name for this machine). Same registry either way, so the image Coolify
# pulls from localhost:5000 is the one pushed through host.lima.internal.
REGISTRY=localhost:5000
VM_REGISTRY=${VM_REGISTRY:-host.lima.internal:5000}
WORK=${MALEQ_SHIP_DIR:-$HOME/.maleq-ship}
TREE=$WORK/main

# What "too long" means for an unattended tick. A cold arm64 build of this
# image is roughly fifteen minutes and a warm one two or three, so
# BUILD_TIMEOUT is generous. BUILD_SILENCE is the sharper test: a build doing
# work prints something every few seconds, and a wedged buildkit session
# prints nothing ever again.
BUILD_TIMEOUT=${BUILD_TIMEOUT:-2700}
BUILD_SILENCE=${BUILD_SILENCE:-420}
STEP_TIMEOUT=${STEP_TIMEOUT:-1800}
MAX_SHIP_MINUTES=${MAX_SHIP_MINUTES:-60}
# A builder of our own, not house-finder's: the watchdog below restarts the
# builder when a session wedges, and sharing one would mean each repo's
# watchdog could kill the other repo's build mid-flight.
BUILDER=${BUILDER:-maleq}
BUILDER_CONTAINER=${BUILDER_CONTAINER:-buildx_buildkit_${BUILDER}0}

log() { echo "$(date -u +%H:%M:%S) $*"; }
ENV_FILE=${MALEQ_ENV_FILE:-$ROOT/.env.local}
envval() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

mkdir -p "$WORK"

# macOS has no setsid, so a backgrounded subshell shares this shell's process
# group: killing the pid we started leaves docker buildx and its children
# running, holding the very session we are giving up on. Walk the children.
kill_tree() {
  local p=$1 sig=${2:-TERM} kid
  for kid in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$kid" "$sig"; done
  kill "-$sig" "$p" 2>/dev/null || true
}

# A wedged buildkit session does not recover by itself: the next run opens
# another against the same daemon and stalls the same way. Restarting the
# container costs nothing, because the layer cache is in the container's
# volume, not its process.
reset_builder() {
  log "restarting $BUILDER_CONTAINER so the next run gets a clean session"
  docker restart "$BUILDER_CONTAINER" >/dev/null 2>&1 || true
}

# Run a command with a deadline. macOS ships no timeout(1) and every step here
# may one day be run unattended, so each one gets its own.
limited() {   # limited <seconds> <label> <command...>
  local secs=$1 label=$2; shift 2
  "$@" &
  local pid=$! waited=0 rc=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$secs" ]; then
      log "$label is still going after ${secs}s: giving up"
      kill_tree "$pid"; sleep 5; kill_tree "$pid" KILL
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 5; waited=$((waited + 5))
  done
  wait "$pid" || rc=$?
  return $rc
}

# One ship at a time: a watcher and a hand-run must not race for the tunnel or
# the worktree. macOS has no flock(1) and mkdir is atomic everywhere.
#
# The pid is in it because a lock outlives its holder whenever a ship is
# killed or the machine sleeps through one, and a plain mkdir lock then
# refuses every later run for ever. So a lock is obeyed only while its holder
# is alive and really is a ship (pids are recycled), and broken otherwise.
LOCKD=$WORK/lock.d
take_lock() {
  mkdir "$LOCKD" 2>/dev/null || return 1
  printf '%s\n' "$$" > "$LOCKD/pid"
  trap 'rm -rf "$LOCKD" 2>/dev/null' EXIT INT TERM
  return 0
}
lock_is_live() {
  local holder; holder=$(cat "$LOCKD/pid" 2>/dev/null || true)
  [ -n "$holder" ] || return 1
  kill -0 "$holder" 2>/dev/null || return 1
  case "$(ps -p "$holder" -o command= 2>/dev/null)" in *ship-local*) ;; *) return 1 ;; esac
  [ -n "$(find "$LOCKD" -maxdepth 0 -mmin "-$MAX_SHIP_MINUTES" 2>/dev/null)" ]
}
if ! take_lock; then
  if lock_is_live; then
    echo "another ship is running (pid $(cat "$LOCKD/pid" 2>/dev/null); rm -rf $LOCKD if it is not)" >&2
    exit 1
  fi
  log "breaking a stale lock (holder $(cat "$LOCKD/pid" 2>/dev/null || echo unknown) is gone or overdue)"
  rm -rf "$LOCKD"
  take_lock || { echo "another ship took the lock" >&2; exit 1; }
fi

command -v jq >/dev/null || { echo "jq is not installed: brew install jq" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "docker is not running: colima start" >&2; exit 1; }

TOKEN=$(envval COOLIFY_TOKEN)
[ -n "$TOKEN" ] || { echo "no COOLIFY_TOKEN in $ENV_FILE" >&2; exit 1; }
# Checked here rather than at deploy time, twenty minutes into a build: a
# revoked token is the likeliest thing to be wrong, and it costs one request.
curl -sf -o /dev/null -H "Authorization: Bearer $TOKEN" \
     "$COOLIFY_API/applications/$APP_UUID" \
  || { echo "COOLIFY_TOKEN in $ENV_FILE is not accepted by $COOLIFY_API" >&2; exit 1; }

# The registry tunnel, reused when one is already up (house-finder's ships
# open the same one).
if ! curl -sf "http://$REGISTRY/v2/" >/dev/null; then
  ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ExitOnForwardFailure=yes \
      -o ConnectTimeout=15 -fN -L "5000:127.0.0.1:5000" "deploy@$HOST"
  for i in $(seq 1 20); do curl -sf "http://$REGISTRY/v2/" >/dev/null && break; sleep 1; done
  curl -sf "http://$REGISTRY/v2/" >/dev/null || { echo "registry unreachable through the tunnel" >&2; exit 1; }
fi

# The worktree of origin/main, detached at whatever origin/main is right now;
# that sha is what everything below is tagged and pinned with.
#
# The commit is confirmed to exist in the object store the checkout happens in
# before it is used: a watcher's clone and this checkout are separate stores
# sharing this default worktree path, and fetching in one while checking out
# in the other fails as "unable to read tree".
git fetch -q origin main
SHA=$(git rev-parse origin/main)
if [ ! -d "$TREE/.git" ] && [ ! -f "$TREE/.git" ]; then
  git worktree add -q --detach "$TREE" "$SHA"
else
  git -C "$TREE" cat-file -e "$SHA^{commit}" 2>/dev/null || git -C "$TREE" fetch -q origin main
  git -C "$TREE" checkout -q --detach "$SHA"
  git -C "$TREE" clean -qfd -e node_modules -e '.next'
fi
log "shipping origin/main ${SHA:0:7} ($(git log -1 --format=%s "$SHA" | cut -c1-60)) from $TREE"

# The build args, read from Coolify rather than kept in a second place here.
# The Dockerfile bakes NEXT_PUBLIC_* into the client bundle at build time, so
# building without them would ship a site pointed at nothing -- and a copy of
# them in this repo would be one more thing to drift. Only the ARGs this
# Dockerfile declares are passed, and only the production environment's
# values: the same endpoint also returns the preview environment's, whose
# NEXT_PUBLIC_SITE_URL is wrong for production.
envs_json=$(curl -sf -H "Authorization: Bearer $TOKEN" "$COOLIFY_API/applications/$APP_UUID/envs") \
  || { echo "could not read the application's env from Coolify" >&2; exit 1; }
# Empty-array expansion is an error under `set -u` on bash 3.2, which is what
# /bin/bash on macOS still is; the `+` is not decoration.
build_args=()
missing=()
while read -r name; do
  [ -n "$name" ] || continue
  value=$(printf '%s' "$envs_json" | jq -r --arg k "$name" \
    'map(select(.key == $k and .is_buildtime == true and (.is_preview | not))) | .[0].value // empty')
  if [ -z "$value" ]; then missing+=("$name"); continue; fi
  build_args+=(--build-arg "$name=$value")
done < <(grep -hoE '^ARG +[A-Z_][A-Z0-9_]*' "$TREE/Dockerfile" | awk '{print $2}')
log "build args from Coolify: $(( ${#build_args[@]} / 2 ))${missing[0]+, not set there: ${missing[*]}}"

if [ "$dry" = 1 ]; then
  log "dry run: would push $REPO:${SHA:0:7} and deploy it to $APP_UUID"
  exit 0
fi

# A builder of our own with a layer cache that outlives the run. network=host
# so it can reach the tunnel through the VM's gateway, and http=true because
# buildkit, unlike dockerd, has no insecure-localhost exception and would
# otherwise try HTTPS against a plain registry.
#
# gckeepstorage carries a UNIT on purpose. In buildkit v0.32 it is a DiskSpace
# value, and a bare number is read as BYTES -- so the `gckeepstorage = 8000`
# this config was copied from means eight kilobytes, which garbage-collects the
# whole layer cache between runs. That is not theoretical: two consecutive
# builds of the same commit here produced zero CACHED steps and left 0B
# reclaimable, i.e. every build was cold and re-ran `bun install` from scratch.
# (house-finder confirmed the same on their builder against a clean control:
# 0B on the configured builder hours after three builds, 7.57GB on the
# unconfigured default builder on the same daemon.)
#
# 6GB, not more, because this Mac's boot disk is the constraint -- ~/.colima is
# already 28G against about 20G free -- and house-finder's builder keeps its
# own 6GB on the same disk.
cat > "$WORK/buildkitd.toml" <<TOML
[registry."$VM_REGISTRY"]
  http = true
[worker.oci]
  gc = true
  gckeepstorage = "${BUILD_CACHE_KEEP:-6GB}"
TOML
# The config is only read when the container is created, so a changed config
# means recreating the builder. Cheap: what is thrown away is a cache that the
# old config was discarding anyway.
stamp=$WORK/buildkitd.stamp
want=$(shasum "$WORK/buildkitd.toml" | cut -c1-40)
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  docker buildx create --name "$BUILDER" --driver docker-container \
    --driver-opt network=host --config "$WORK/buildkitd.toml" >/dev/null
  printf '%s' "$want" > "$stamp"
elif [ "$(cat "$stamp" 2>/dev/null)" != "$want" ]; then
  log "buildkit config changed, recreating the $BUILDER builder"
  docker buildx rm "$BUILDER" >/dev/null 2>&1 || true
  docker buildx create --name "$BUILDER" --driver docker-container \
    --driver-opt network=host --config "$WORK/buildkitd.toml" >/dev/null
  printf '%s' "$want" > "$stamp"
fi
docker buildx inspect "$BUILDER" --bootstrap >/dev/null

# Build, watching it as it goes. The full log goes to a file, a line a minute
# says how far in it is, and the interesting lines are printed at the end --
# because piping through `tail` prints nothing until the build ends, which
# makes a fifteen-minute build and a build that died in its first second look
# identical while you wait.
#
# Silence is the failure test, and a hang resets the builder rather than
# holding the lock.
build() {
  local rc=0 blog=$WORK/build.log
  : > "$blog"
  (cd "$TREE" && docker buildx build --builder "$BUILDER" \
      --platform linux/arm64 \
      --file Dockerfile \
      ${build_args[@]+"${build_args[@]}"} \
      --tag "$VM_REGISTRY/$REPO:$SHA" \
      --tag "$VM_REGISTRY/$REPO:main" \
      --label "org.opencontainers.image.revision=$SHA" \
      --provenance=false \
      --push \
      --progress plain .) >"$blog" 2>&1 &
  local pid=$! waited=0 quiet=0 seen=0 now
  while kill -0 "$pid" 2>/dev/null; do
    sleep 15; waited=$((waited + 15))
    now=$(wc -c < "$blog" 2>/dev/null | tr -d ' '); now=${now:-0}
    if [ "$now" -gt "$seen" ]; then seen=$now; quiet=0; else quiet=$((quiet + 15)); fi
    if [ $((waited % 60)) -eq 0 ]; then
      log "  ${waited}s in, $(grep -cE '^#[0-9]+ DONE' "$blog" 2>/dev/null || echo 0) steps done"
    fi
    if [ "$quiet" -ge "$BUILD_SILENCE" ]; then
      log "nothing written for ${quiet}s, so buildkit is wedged, not slow"
      kill_tree "$pid"; sleep 5; kill_tree "$pid" KILL
      wait "$pid" 2>/dev/null || true
      reset_builder; return 124
    fi
    if [ "$waited" -ge "$BUILD_TIMEOUT" ]; then
      log "over ${BUILD_TIMEOUT}s, giving up"
      kill_tree "$pid"; sleep 5; kill_tree "$pid" KILL
      wait "$pid" 2>/dev/null || true
      reset_builder; return 124
    fi
  done
  wait "$pid" || rc=$?
  grep -E '^#[0-9]+ (DONE|ERROR)|error|pushing manifest|exporting' "$blog" | tail -n 8 || true
  [ "$rc" = 0 ] || log "build failed ($rc), full log in $blog"
  return $rc
}

log "building"
build
log "pushed $REPO:${SHA:0:7}"

# Proof the tag is really in the registry before Coolify is told to look for
# it: a push that half-failed and a deploy pinned to a tag that is not there
# both end in the server building, which is the one outcome worth a check.
curl -sf "http://$REGISTRY/v2/$REPO/manifests/$SHA" \
     -H 'Accept: application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
     -o /dev/null \
  || { echo "$REPO:$SHA is not in the registry after the push" >&2; exit 1; }

if [ "$build_only" = 1 ]; then
  log "built and pushed ${SHA:0:7}; not deploying (--build-only)"
  exit 0
fi

# Coolify resolves origin/main itself at deploy time (git_commit_sha stays at
# HEAD -- see the long comment in ops/ship-deploy.sh for why it must) and looks
# for the image tagged with the sha it lands on. So if main moved while we were
# building, the tag it wants is one nobody has pushed, and it falls back to
# building on the server: the exact thing this path exists to avoid.
#
# Pinning the sha is NOT the fix -- pinning is a build-impact config change and
# forces a server build every time. The fix is to notice and not deploy a stale
# build. The next run picks up the newer commit.
git fetch -q origin main
now=$(git rev-parse origin/main)
if [ "$now" != "$SHA" ]; then
  echo "origin/main moved from ${SHA:0:7} to ${now:0:7} while this was building." >&2
  echo "Not deploying a stale build -- the server would build ${now:0:7} itself. Run it again." >&2
  exit 1
fi

# From $ROOT, not $TREE: the worktree is the BUILD CONTEXT, a checkout of
# origin/main, and it only has the deploy script once this one is committed --
# which it is not on the day it is written, and would not be on any branch that
# changes it. The script that deploys is the one sitting next to this file.
log "deploying ${SHA:0:7}"
limited "$STEP_TIMEOUT" "the deploy" \
  env TOKEN="$TOKEN" GITHUB_SHA="$SHA" COOLIFY_API="$COOLIFY_API" \
      APP_UUID="$APP_UUID" IMAGE_NAME="$REGISTRY/$REPO" \
  bash -c 'cd "$1" && bash ops/ship-deploy.sh' _ "$ROOT"
log "shipped ${SHA:0:7}"
