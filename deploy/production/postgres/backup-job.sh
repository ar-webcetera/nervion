#!/usr/bin/env bash
# Host-side systemd entrypoint. Its environment contains paths, not credentials.
set -Eeuo pipefail
umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
fail() { printf 'Backup job: %s\n' "$1" >&2; exit 1; }
[[ $# == 1 ]] || fail 'expected scheduled, full, diff or monitor'
operation=$1
case "$operation" in
  scheduled|full|diff|monitor) ;;
  *) fail 'operation is not allowed' ;;
esac
project=${NERVION_BACKUP_PROJECT:-}
directory=${NERVION_BACKUP_DIRECTORY:-}
compose_file=${NERVION_BACKUP_COMPOSE:-}
env_file=${NERVION_BACKUP_ENV_FILE:-}
[[ "$project" =~ ^[a-z][a-z0-9_-]{2,62}$ ]] || fail 'invalid project'
for path in "$directory" "$compose_file" "$env_file"; do
  [[ "$path" == /* && "$path" != / && ! -L "$path" && "$(realpath -e -- "$path")" == "$path" ]] || fail 'expected canonical release paths'
  mode=$(stat -c %a -- "$path"); owner=$(stat -c %u -- "$path")
  [[ "$owner" == 0 || "$owner" == "$EUID" ]] || fail 'unexpected release file owner'
  (( (8#$mode & 0022) == 0 )) || fail 'release path is writable by another account'
done
[[ -d "$directory" && -f "$compose_file" && -f "$env_file" ]] || fail 'release configuration is unavailable'
mode=$(stat -c %a -- "$env_file")
(( (8#$mode & 0077) == 0 )) || fail 'environment file must be private'
if [[ "$operation" != monitor ]]; then
  exec 9>"/run/lock/nervion-backup-$project.lock"
  flock -n 9 || fail 'another backup is running'
fi
docker_command() { env -i PATH="$PATH" HOME="${HOME:-/nonexistent}" LANG=C docker --host unix:///var/run/docker.sock "$@"; }
compose() {
  docker_command compose --project-name "$project" --project-directory "$directory" \
    --env-file "$env_file" -f "$compose_file" --profile backup "$@"
}
# This runner cannot select infrastructure services, build or pull an image.
compose config --format json | jq -e '
  .services.backup as $backup |
  ($backup.image | test("^(sha256:[0-9a-f]{64}|[a-zA-Z0-9._:/-]+@sha256:[0-9a-f]{64})$")) and
  $backup.build == null and $backup.user == "postgres" and
  $backup.entrypoint == ["/usr/local/bin/nervion-backup"]
' >/dev/null || fail 'backup service must use the approved entrypoint, user and immutable image'

if [[ "$operation" == scheduled ]]; then
  operation=full
  if [[ "$(date -u +%u)" != 7 ]]; then
    # Catch up a missed Sunday after host downtime. A persistent daily timer
    # alone would otherwise select Monday diff and defer full for another week.
    history=$(compose run --rm --no-deps --pull never -T backup info) || fail 'cannot inspect backup history'
    latest_full=$(jq -er '
      [.[] | select(.name == "nervion" and (.status.code == 0 or .status.code == 2))] |
      if length != 1 then error("backup repository unavailable") else
        ([.[0].backup[]? | select(.type == "full") | .timestamp.stop] | max // 0)
      end
    ' <<<"$history") || fail 'backup repository is not ready'
    [[ "$latest_full" =~ ^[0-9]{1,12}$ ]] || fail 'invalid full backup timestamp'
    (( $(date -u +%s) - latest_full >= 604800 )) || operation=diff
  fi
fi

if [[ "$operation" == monitor ]]; then
  compose run --rm --no-deps --pull never -T backup info | jq -e '
    [.[] | select(.name == "nervion" and .status.code == 0 and .cipher == "aes-256-cbc") |
      ([.backup[]?.timestamp.stop] | max) as $latest |
      ([.backup[]? | select(.type == "full") | .timestamp.stop] | max) as $full |
      $latest != null and $full != null and $latest <= now + 300 and
      $latest >= now - 129600 and $full >= now - 691200] |
    length == 1 and all
  ' >/dev/null || fail 'encrypted backup is unavailable, older than 36 hours, or full backup is older than 8 days'
  printf 'Encrypted backup freshness check passed.\n'
else
  compose run --rm --no-deps --pull never -T backup "$operation"
fi
