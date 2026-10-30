#!/usr/bin/env bash
# Operator-installed runner. It never builds, fetches code or changes ingress.
set -Eeuo pipefail
umask 077

fail() { printf 'Release failed: %s\n' "$1" >&2; exit 1; }
usage() { printf 'Usage: run.sh prepare|migrate|deploy --manifest FILE --state-dir DIR --project NAME --expected-commit SHA\n' >&2; exit 2; }

action=${1:-}; [[ $# -gt 0 ]] && shift
[[ "$action" =~ ^(prepare|migrate|deploy)$ ]] || usage
manifest= state_root= project= commit=
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || usage
  case "$1" in
    --manifest) [[ -z "$manifest" ]] || usage; manifest=$2 ;;
    --state-dir) [[ -z "$state_root" ]] || usage; state_root=$2 ;;
    --project) [[ -z "$project" ]] || usage; project=$2 ;;
    --expected-commit) [[ -z "$commit" ]] || usage; commit=$2 ;;
    *) usage ;;
  esac
  shift 2
done
[[ "$project" =~ ^[a-z][a-z0-9_-]{2,62}$ && "$commit" =~ ^[0-9a-f]{40}$ ]] || usage
for binary in docker jq flock sha256sum realpath stat mktemp; do command -v "$binary" >/dev/null || fail 'Required executable is missing'; done

canonical() {
  [[ "$1" == /* && "$1" != / && "$1" != *$'\n'* && "$1" != *$'\r'* ]] || fail 'Expected a canonical absolute path';
  [[ "$(realpath -e -- "$1")" == "$1" ]] || fail 'Symlink or non-canonical path is not allowed';
}
regular() {
  canonical "$1"
  [[ -f "$1" && ! -L "$1" ]] || fail 'Expected a regular file'
  local owner mode
  owner=$(stat -c %u -- "$1"); mode=$(stat -c %a -- "$1")
  [[ "$owner" == "$EUID" || "$owner" == 0 ]] || fail 'File has an unexpected owner'
  (( (8#$mode & 0022) == 0 )) || fail 'File is writable by another account'
  if [[ "${2:-public}" == private ]]; then
    (( (8#$mode & 0077) == 0 )) || fail 'Private file permissions are too broad'
  fi
}
private_directory() {
  [[ "$1" == /* && "$1" != / && "$1" != "${HOME:-}" ]] || fail 'Invalid private state directory'
  if [[ ! -e "$1" ]]; then mkdir -m 0700 -- "$1" || fail 'Cannot create state directory'; fi
  canonical "$1"
  [[ -d "$1" && ! -L "$1" ]] || fail 'Expected a private directory'
  local owner mode
  owner=$(stat -c %u -- "$1"); mode=$(stat -c %a -- "$1")
  [[ "$owner" == "$EUID" ]] || fail 'State directory must belong to the runner account'
  (( (8#$mode & 0077) == 0 )) || fail 'State directory permissions must be private'
}

regular "$manifest" private
(( $(stat -c %s -- "$manifest") <= 65536 )) || fail 'Manifest is too large'
jq -e --arg project "$project" --arg commit "$commit" '
  type == "object" and .schemaVersion == 1 and .project == $project and .commit == $commit and
  (.composeFile | type == "string") and (.envFile | type == "string") and
  (.images | type == "object") and
  ([.images.backend, .images.frontend] | all(type == "string" and
    test("^(sha256:[0-9a-f]{64}|[a-zA-Z0-9._:/-]+@sha256:[0-9a-f]{64})$"))) and
  (.services | type == "array" and length >= 2 and length <= 3 and
    (unique | length) == length and index("backend") != null and index("frontend") != null and
    all(. == "backend" or . == "frontend" or . == "smtp")) and
  (.healthTimeoutSeconds | type == "number" and floor == . and . >= 5 and . <= 600) and
  (.migrationTimeoutSeconds | type == "number" and floor == . and . >= 30 and . <= 3600)
' "$manifest" >/dev/null || fail 'Invalid manifest, mutable image, commit, project or service allowlist'
compose_file=$(jq -r .composeFile "$manifest"); env_file=$(jq -r .envFile "$manifest")
regular "$compose_file"; regular "$env_file" private
backend_image=$(jq -r .images.backend "$manifest"); frontend_image=$(jq -r .images.frontend "$manifest")
mapfile -t services < <(jq -r '.services[]' "$manifest")
health_timeout=$(jq -r .healthTimeoutSeconds "$manifest")
migration_timeout=$(jq -r .migrationTimeoutSeconds "$manifest")

private_directory "$state_root"
state="$state_root/$project"; private_directory "$state"
[[ ! -L "$state/release.lock" ]] || fail 'Invalid lock file'
exec 9>"$state/release.lock"
flock -n 9 || fail 'Another release is running for this project'
private_directory "$state/releases"; private_directory "$state/logs"
log="$state/logs/$action-$(date -u +%Y%m%dT%H%M%SZ)-$$.log"
touch "$log"
stage=validation
migration_active=
on_exit() {
  local status=$?
  if (( status != 0 )) && [[ -n "$migration_active" ]] && inspect_container "$migration_active" migrate "$backend_id"; then
    logged docker_command container stop --time 30 "$migration_active" || true
    logged docker_command container logs --tail 2000 "$migration_active" || true
  fi
  jq -cn --arg time "$(date -u +%FT%TZ)" --arg action "$action" --arg stage "$stage" \
    --arg commit "$commit" --argjson exitCode "$status" \
    '{time:$time,action:$action,stage:$stage,commit:$commit,exitCode:$exitCode}' >>"$state/events.jsonl"
  if (( status != 0 )); then printf 'Release was not completed. Private diagnostics: %s\n' "$log" >&2; fi
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Never inherit COMPOSE_*, DOCKER_HOST, GIT_* or application env from a push.
docker_command() { env -i PATH="$PATH" HOME="${HOME:-/nonexistent}" LANG=C docker --host unix:///var/run/docker.sock "$@"; }
logged() { "$@" >>"$log" 2>&1 || return $?; }
image_id() {
  local ref=$1 output=$2 expected
  docker_command image inspect "$ref" --format '{{json .}}' >"$output" 2>>"$log" || fail 'Image inspection failed'
  jq -e --arg commit "$commit" '.Id | test("^sha256:[0-9a-f]{64}$")' "$output" >/dev/null || fail 'Invalid image ID'
  jq -e --arg commit "$commit" '.Config.Labels["org.opencontainers.image.revision"] == $commit' "$output" >/dev/null || fail 'Image revision does not match the exact commit'
  expected=$(jq -r .Id "$output")
  if [[ "$ref" == sha256:* && "$ref" != "$expected" ]]; then fail 'Local image ID does not match the manifest'; fi
  printf '%s' "$expected"
}
verify_sources() {
  local record=$1 path digest
  while IFS=$'\t' read -r path digest; do
    regular "$path"
    [[ "$(sha256sum -- "$path" | cut -d ' ' -f1)" == "$digest" ]] || fail 'Release input changed after prepare'
  done < <(jq -r '.inputs[] | [.path,.sha256] | @tsv' "$record")
}
compose() { docker_command compose --project-name "$project" --project-directory "$release" --env-file /dev/null -f "$release/compose.json" --profile deployment "$@"; }

if [[ "$action" == prepare ]]; then
  stage=prepare
  work=$(mktemp -d "$state/.prepare.XXXXXXXX")
  backend_id=$(image_id "$backend_image" "$work/backend-image.json")
  frontend_id=$(image_id "$frontend_image" "$work/frontend-image.json")
  # The overlay pins configuration IDs, not mutable tags or registry aliases.
  jq -n --arg backend "$backend_id" --arg frontend "$frontend_id" --arg commit "$commit" \
    --argjson services "$(jq .services "$manifest")" '
    {services: ((reduce $services[] as $service ({}; .[$service] = {
      image: (if $service == "frontend" then $frontend else $backend end),
      labels: {"io.nervion.release.commit":$commit}
    })) + {migrate:{image:$backend,labels:{"io.nervion.release.commit":$commit}}})}
  ' >"$work/overlay.json"
  docker_command compose --project-name "$project" --project-directory "$(dirname "$compose_file")" \
    --env-file "$env_file" -f "$compose_file" -f "$work/overlay.json" --profile deployment config --format json \
    >"$work/compose.raw.json" 2>>"$log" || fail 'Compose configuration is invalid'
  jq -S . "$work/compose.raw.json" >"$work/compose.json"
  jq -e --arg project "$project" --argjson selected "$(jq .services "$manifest")" '
    .name == $project and (.services.migrate != null) and
    .services.migrate.labels["io.nervion.release.migration"] == "tenant-only" and
    .services.migrate.environment.TENANCY_ENABLED == "true" and
    .services.backend.environment.TENANCY_ENABLED == "true" and
    ([($selected + ["migrate"])[] as $name | .services[$name] |
      .container_name == null and .build == null] | all) and
    ([$selected[] as $name | .services[$name].healthcheck |
      . != null and .disable != true and (.test | type == "array" and length > 0 and .[0] != "NONE")] | all)
  ' "$work/compose.json" >/dev/null || fail 'Compose lacks required healthchecks or an approved tenant-only migration job'
  # Validate that freezing Compose does not change interpolation or path resolution.
  docker_command compose --project-name "$project" --project-directory "$work" --env-file /dev/null \
    -f "$work/compose.json" --profile deployment config --format json >"$work/roundtrip.json" 2>>"$log" || fail 'Frozen Compose configuration cannot be read'
  jq -S . "$work/roundtrip.json" >"$work/roundtrip.sorted.json"
  cmp -s "$work/compose.json" "$work/roundtrip.sorted.json" || fail 'Frozen Compose configuration is not stable'
  # Include mounted script/secret files, but never walk mutable data directories.
  jq -r --arg manifest "$manifest" --arg compose "$compose_file" --arg env "$env_file" \
    --argjson selected "$(jq .services "$manifest")" '
    [$manifest,$compose,$env] +
    [($selected + ["migrate"])[] as $name | .services[$name].volumes[]? | select(.type == "bind") | .source] +
    [.secrets[]?.file, .configs[]?.file] | map(select(. != null)) | unique[]
  ' "$work/compose.json" >"$work/input-paths"
  : >"$work/inputs.jsonl"
  while IFS= read -r path; do
    canonical "$path"
    [[ -d "$path" ]] && continue
    regular "$path"
    digest=$(sha256sum -- "$path" | cut -d ' ' -f1)
    jq -cn --arg path "$path" --arg digest "$digest" '{path:$path,sha256:$digest}' >>"$work/inputs.jsonl"
  done <"$work/input-paths"
  config_hash=$(sha256sum "$work/compose.json" | cut -d ' ' -f1)
  jq -sS --arg commit "$commit" --arg project "$project" --arg manifest "$manifest" \
    --arg configHash "$config_hash" --arg backendId "$backend_id" --arg frontendId "$frontend_id" \
    '{commit:$commit,project:$project,manifest:$manifest,configHash:$configHash,backendId:$backendId,frontendId:$frontendId,inputs:.}' \
    "$work/inputs.jsonl" >"$work/prepared.json"
  fingerprint=$(sha256sum "$work/prepared.json" | cut -d ' ' -f1)
  release="$state/releases/$commit-$fingerprint"
  if [[ -e "$release" ]]; then
    private_directory "$release"
    [[ "$(sha256sum "$release/prepared.json" | cut -d ' ' -f1)" == "$fingerprint" ]] || fail 'Existing release state is inconsistent'
  else mv -- "$work" "$release"; fi
  jq -n --arg commit "$commit" --arg fingerprint "$fingerprint" --arg release "$release" \
    '{commit:$commit,fingerprint:$fingerprint,release:$release}' >"$state/prepared-head.tmp"
  mv -- "$state/prepared-head.tmp" "$state/prepared-head.json"
  # A new prepare is deliberately not proof that migrations were completed.
  [[ ! -e "$state/migration-head.json" ]] || mv -- "$state/migration-head.json" "$state/logs/migration-before-prepare-$$.json"
  printf 'Release prepared: %s\n' "$commit"
  exit 0
fi

regular "$state/prepared-head.json" private
jq -e --arg commit "$commit" '.commit == $commit' "$state/prepared-head.json" >/dev/null || fail 'No matching prepared release'
release=$(jq -r .release "$state/prepared-head.json")
fingerprint=$(jq -r .fingerprint "$state/prepared-head.json")
[[ "$fingerprint" =~ ^[0-9a-f]{64}$ && "$release" == "$state/releases/$commit-$fingerprint" ]] || fail 'Invalid prepared release pointer'
private_directory "$release"
regular "$release/prepared.json" private; regular "$release/compose.json" private
[[ "$(sha256sum "$release/prepared.json" | cut -d ' ' -f1)" == "$fingerprint" ]] || fail 'Prepared receipt changed'
jq -e --arg commit "$commit" --arg project "$project" --arg manifest "$manifest" \
  '.commit == $commit and .project == $project and .manifest == $manifest' "$release/prepared.json" >/dev/null || fail 'Prepared release does not match the request'
[[ "$(sha256sum "$release/compose.json" | cut -d ' ' -f1)" == "$(jq -r .configHash "$release/prepared.json")" ]] || fail 'Frozen Compose configuration changed'
verify_sources "$release/prepared.json"
backend_id=$(image_id "$backend_image" "$state/backend-check.json")
frontend_id=$(image_id "$frontend_image" "$state/frontend-check.json")
jq -e --arg backend "$backend_id" --arg frontend "$frontend_id" \
  '.backendId == $backend and .frontendId == $frontend' "$release/prepared.json" >/dev/null || fail 'Prepared image identity changed'

inspect_container() {
  docker_command container inspect "$1" --format '{{json .}}' >"$state/container-check.json" 2>>"$log" || return 1
  jq -e --arg project "$project" --arg service "$2" --arg commit "$commit" --arg image "$3" '
    .Config.Labels["com.docker.compose.project"] == $project and
    .Config.Labels["com.docker.compose.service"] == $service and
    .Config.Labels["io.nervion.release.commit"] == $commit and .Image == $image
  ' "$state/container-check.json" >/dev/null
}

if [[ "$action" == migrate ]]; then
  stage=migration
  [[ ! -e "$state/migration-head.json" ]] || mv -- "$state/migration-head.json" "$state/logs/migration-before-attempt-$$.json"
  docker_command container ls --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=migrate \
    --filter status=running --filter status=created --format '{{.ID}}' >"$state/active-migrations.txt" 2>>"$log" || fail 'Cannot check existing migration jobs'
  [[ ! -s "$state/active-migrations.txt" ]] || fail 'Another migration container is still active'
  migration_name="$project-migrate-${commit:0:12}-$$"
  migration_active=$migration_name
  compose run --detach --no-deps --pull never --name "$migration_name" migrate >"$state/migration-container.txt" 2>>"$log" || fail 'Migration job could not start'
  started=$SECONDS
  while true; do
    inspect_container "$migration_name" migrate "$backend_id" || fail 'Unexpected migration container identity'
    status=$(jq -r .State.Status "$state/container-check.json")
    if [[ "$status" == exited ]]; then
      [[ "$(jq -r .State.ExitCode "$state/container-check.json")" == 0 ]] || fail 'Migration job failed; application was not updated'
      break
    fi
    [[ "$status" == running || "$status" == created ]] || fail 'Migration job entered an invalid state'
    if (( SECONDS - started >= migration_timeout )); then
      logged docker_command container stop --time 30 "$migration_name" || true
      fail 'Migration timed out; inspect the retained job before retrying'
    fi
    sleep 2
  done
  verify_sources "$release/prepared.json"
  logged docker_command container logs --tail 2000 "$migration_name" || fail 'Cannot preserve migration diagnostics'
  logged docker_command container rm "$migration_name" || fail 'Migration completed but its job cleanup failed'
  migration_active=
  jq -n --arg commit "$commit" --arg fingerprint "$fingerprint" --arg completedAt "$(date -u +%FT%TZ)" \
    '{commit:$commit,fingerprint:$fingerprint,completedAt:$completedAt}' >"$state/migration-head.tmp"
  mv -- "$state/migration-head.tmp" "$state/migration-head.json"
  printf 'Tenant migrations completed: %s\n' "$commit"
  exit 0
fi

stage=deploy
regular "$state/migration-head.json" private
jq -e --arg commit "$commit" --arg fingerprint "$fingerprint" \
  '.commit == $commit and .fingerprint == $fingerprint' "$state/migration-head.json" >/dev/null || fail 'Migration receipt is missing or stale'
logged compose up -d --no-deps --no-build --pull never --wait --wait-timeout "$health_timeout" "${services[@]}" || fail 'Application update or health gate failed; no automatic rollback was attempted'
stage=health
for pass in 1 2; do
  for service in "${services[@]}"; do
    compose ps --all --quiet "$service" >"$state/service-container.txt" 2>>"$log" || fail 'Cannot inspect deployed service'
    mapfile -t ids <"$state/service-container.txt"
    [[ ${#ids[@]} == 1 && "${ids[0]}" =~ ^[0-9a-f]{12,64}$ ]] || fail 'Expected exactly one container per application service'
    expected=$backend_id; [[ "$service" != frontend ]] || expected=$frontend_id
    inspect_container "${ids[0]}" "$service" "$expected" || fail 'Deployed container has an unexpected identity'
    jq -e '.State.Status == "running" and .State.Health.Status == "healthy"' "$state/container-check.json" >/dev/null || fail 'Deployed service is not healthy'
  done
  [[ "$pass" != 1 ]] || sleep 2
done
verify_sources "$release/prepared.json"
jq -n --arg commit "$commit" --arg fingerprint "$fingerprint" --arg completedAt "$(date -u +%FT%TZ)" \
  '{commit:$commit,fingerprint:$fingerprint,completedAt:$completedAt}' >"$state/deployed-head.tmp"
mv -- "$state/deployed-head.tmp" "$state/deployed-head.json"
printf 'Release deployed and healthy: %s\n' "$commit"
