#!/usr/bin/env bash
set -Eeuo pipefail
source /usr/local/lib/nervion/pgbackrest-common.sh
[[ $# == 1 ]] || backrest_fail 'exactly one WAL path is required'
validate_backrest_config
data=/var/lib/postgresql/data/pgdata
wal=$1
name=${wal##*/}
[[ "$name" =~ ^([0-9A-F]{24}(\.[0-9A-F]{8}\.backup|\.partial)?|[0-9A-F]{8}\.history)$ ]] || backrest_fail 'invalid WAL filename'
[[ "$wal" == "pg_wal/$name" || "$wal" == "$data/pg_wal/$name" ]] || backrest_fail 'WAL is outside PGDATA'
wal="$data/pg_wal/$name"
[[ -f "$wal" && ! -L "$wal" && "$(realpath -e -- "$wal")" == "$wal" ]] || backrest_fail 'WAL must be a regular file inside PGDATA'
# A non-zero archive-push result is propagated. PostgreSQL retains and retries
# that WAL; no queue-drop limit or success-on-error fallback is permitted.
# pgBackRest does not accept the conventional "--" separator. The validated
# absolute path always starts with /var/lib/, so it cannot be parsed as an option.
exec_backrest archive archive-push "$wal"
