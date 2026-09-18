#!/usr/bin/env bash
# Point the male-q Coolify application at an image this machine already built
# and pushed, then wait for the deployment. Called by ops/ship-local.sh.
#
#   TOKEN        Coolify API token
#   GITHUB_SHA   the commit that was built (and the tag it was pushed under)
#   COOLIFY_API  https://admin.maleq.com/api/v1
#   IMAGE_NAME   localhost:5000/maleq/web
#   APP_UUID     v88k8w4gkk08wsoco0s8w8c4
#
# ---------------------------------------------------------------------------
# HOW COOLIFY ACTUALLY DECIDES TO BUILD, read out of the running instance
# (4.0.0-beta.463, app/Jobs/ApplicationDeploymentJob.php and
# app/Services/DeploymentConfiguration/) on 2026-09-17, because the deployment
# log alone is misleading: it prints a successful `docker pull` and then builds
# anyway, and there is no "Building new image" line to catch it by.
#
#   generate_image_names():   for the `dockerfile` build pack the image is
#                             "{docker_registry_image_name}:{resolved commit}".
#                             docker_registry_image_tag is NOT used -- the code
#                             that would honour it is commented out. Setting it
#                             does nothing at all.
#
#   should_skip_build():      skips the build only when BOTH
#                               a) the image is present locally (our pull), and
#                               b) pendingDeploymentConfigurationDiff()
#                                  ->requiresBuild() is FALSE.
#
#   requiresBuild():          true when any changed config item has
#                             impact == 'build'. And in the snapshot,
#                             `git_commit_sha` is impact 'build'.
#
# So pinning git_commit_sha to each new sha -- the thing that looks like it
# makes Coolify find our tag -- is precisely what forces it to rebuild, every
# single time, because changing it IS a build-impact configuration change.
# docker_registry_image_name and _tag are impact 'redeploy', which is why they
# are safe to set.
#
# What works instead: leave git_commit_sha at HEAD and let Coolify resolve the
# branch itself. It runs `git ls-remote`, gets origin/main's sha, and looks for
# "{docker_registry_image_name}:{that sha}" -- which is exactly the tag we
# pushed. Nothing build-impact changes, so it pulls and skips the build.
#
# The race the pin was meant to close (a push landing between our build and
# this deploy) is real, but the pin closed it by making the server build every
# time, which is worse than the disease. It is closed here by refusing to
# deploy a sha that origin/main has moved off: ops/ship-local.sh re-checks and
# the next run builds the newer commit.
# ---------------------------------------------------------------------------
set -euo pipefail

: "${TOKEN:?}" "${GITHUB_SHA:?}"
COOLIFY_API=${COOLIFY_API:-https://admin.maleq.com/api/v1}
IMAGE_NAME=${IMAGE_NAME:-localhost:5000/maleq/web}
APP_UUID=${APP_UUID:-v88k8w4gkk08wsoco0s8w8c4}

api() { curl -sf -H "Authorization: Bearer ${TOKEN}" "$@"; }

app=$(api "${COOLIFY_API}/applications/${APP_UUID}")

# The settings this path needs, written ONLY when they are not already right.
# Every write here is a configuration change Coolify will diff on the next
# deployment, and an unconditional PATCH would therefore cause the very rebuild
# this is avoiding. Steady state is zero writes.
want_name=$IMAGE_NAME
have_name=$(printf '%s' "$app" | jq -r '.docker_registry_image_name // ""')
have_sha=$(printf '%s' "$app" | jq -r '.git_commit_sha // ""')
have_tag=$(printf '%s' "$app" | jq -r '.docker_registry_image_tag // ""')

patch=$(jq -nc \
  --arg name "$want_name" --arg have_name "$have_name" \
  --arg have_sha "$have_sha" --arg have_tag "$have_tag" '
  ( if $have_name != $name then {docker_registry_image_name: $name} else {} end )
  + ( if $have_sha  != "HEAD" then {git_commit_sha: "HEAD"} else {} end )
  + ( if $have_tag  != ""     then {docker_registry_image_tag: null} else {} end )')

if [ "$patch" != '{}' ]; then
  echo "normalising the application config: $patch"
  echo "(a build-impact field is changing, so THIS deployment will build on the server; the next will not)"
  api -X PATCH "${COOLIFY_API}/applications/${APP_UUID}" \
    -H 'Content-Type: application/json' -d "$patch" > /dev/null
fi

dep=$(api -X POST "${COOLIFY_API}/deploy?uuid=${APP_UUID}" | jq -r '.deployments[0].deployment_uuid')
[ -n "$dep" ] && [ "$dep" != null ] || { echo "coolify did not start a deployment" >&2; exit 1; }
echo "deployment $dep"

# Generous, because Coolify runs one deployment at a time per server and other
# applications on this host queue ahead of ours.
deadline=$(( $(date +%s) + 40 * 60 ))
while :; do
  status=$(api "${COOLIFY_API}/deployments/${dep}" | jq -r '.status // ""')
  case "$status" in
    finished)  echo "male-q ok"; break ;;
    failed|cancelled) echo "male-q $status" >&2; exit 1 ;;
  esac
  [ "$(date +%s)" -lt "$deadline" ] || { echo "timed out waiting for $dep" >&2; exit 1; }
  sleep 20
done

# Did the server build or not? This is the whole point of the exercise, and it
# is not visible from the status or from the image name (a server-built image
# is tagged with the same name a pulled one has). The evidence is whether
# `bash /artifacts/build.sh` ran. `Build step skipped` is should_skip_build()
# saying so in as many words.
# `.logs` is a JSON string that itself contains a JSON document, so one decode
# still leaves the inner escaping in place: the text reads \/artifacts\/build.sh,
# and a grep for artifacts/build.sh silently matches nothing. That is how the
# normalising ship on 2026-09-17 reported "neither a build nor a skip" on a
# deployment that plainly built. Decode, then unescape the slashes.
logs=$(api "${COOLIFY_API}/deployments/${dep}" | jq -r '.logs // ""' | sed 's#\\/#/#g')
if [ -z "$logs" ]; then
  echo "note: could not read the deployment log; check in the Coolify UI whether the build step was skipped"
elif printf '%s' "$logs" | grep -q 'Build step skipped'; then
  echo "coolify: pulled the image and SKIPPED the build"
elif printf '%s' "$logs" | grep -q 'artifacts/build.sh'; then
  echo "WARNING: the server BUILT this image instead of only pulling it." >&2
  if [ "$patch" != '{}' ]; then
    echo "Expected this once, because the config was just normalised. Ship again and it should skip." >&2
  else
    echo "Not expected: nothing build-impact changed. Something reset git_commit_sha off HEAD," >&2
    echo "or the tag was missing at deploy time. Read the deployment log before shipping again." >&2
    exit 1
  fi
else
  echo "note: the log shows neither a build nor a skip; worth a look"
fi
