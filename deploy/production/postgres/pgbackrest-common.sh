#!/usr/bin/env bash
# Sourced only by the fixed image wrappers, never by application code.
set -Eeuo pipefail
umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

backrest_fail() { printf 'pgBackRest policy: %s\n' "$1" >&2; exit 1; }

validate_backrest_config() {
  local config=/run/secrets/pgbackrest_config owner mode
  [[ "$(id -u)" == "$(id -u postgres)" ]] || backrest_fail 'run as postgres'
  [[ -f "$config" && ! -L "$config" && -r "$config" ]] || backrest_fail 'private configuration is unavailable'
  owner=$(stat -c %u "$config"); mode=$(stat -c %a "$config")
  [[ "$owner" == 0 || "$owner" == "$(id -u postgres)" ]] || backrest_fail 'unexpected configuration owner'
  (( (8#$mode & 0077) == 0 )) || backrest_fail 'configuration must be private'
  (( $(stat -c %s "$config") <= 65536 )) || backrest_fail 'configuration is too large'

  # Restrict both sections and option names. No per-command overrides, extra
  # repositories, include files or environment options can weaken this policy.
  # Never include a rejected line or credential value in diagnostics.
  awk '
    function trim(value) { gsub(/^[ \t]+|[ \t\r]+$/, "", value); return value }
    function require_value(key, value) { if (settings[key] != value) bad = 1 }
    /^[ \t]*(#|;|$)/ { next }
    {
      line = trim($0)
      if (line ~ /^\[/) {
        if (line != "[global]" && line != "[nervion]") bad = 1
        section = line
        next
      }
      split_at = index(line, "=")
      if (!split_at || section == "") { bad = 1; next }
      key = trim(substr(line, 1, split_at - 1)); value = trim(substr(line, split_at + 1))
      full_key = section ":" key
      if (seen[full_key]++) bad = 1
      settings[full_key] = value
      if (section == "[global]" && key !~ /^(repo1-type|repo1-path|repo1-cipher-type|repo1-cipher-pass|repo1-s3-bucket|repo1-s3-endpoint|repo1-s3-region|repo1-s3-key|repo1-s3-key-secret|repo1-s3-key-type|repo1-s3-uri-style|repo1-storage-verify-tls|repo1-retention-full-type|repo1-retention-full|archive-async|archive-timeout|process-max|start-fast|compress-type|log-level-console|log-level-file)$/) bad = 1
      if (section == "[nervion]" && key !~ /^(pg1-path|pg1-socket-path|pg1-user|pg1-port|pg1-database)$/) bad = 1
    }
    END {
      require_value("[global]:repo1-type", "s3")
      require_value("[global]:repo1-path", "/nervion-backups/production/pgbackrest")
      require_value("[global]:repo1-cipher-type", "aes-256-cbc")
      require_value("[global]:repo1-retention-full-type", "time")
      require_value("[global]:repo1-retention-full", "35")
      require_value("[global]:repo1-storage-verify-tls", "y")
      require_value("[global]:repo1-s3-key-type", "shared")
      require_value("[global]:archive-async", "n")
      require_value("[global]:log-level-file", "off")
      require_value("[nervion]:pg1-path", "/var/lib/postgresql/data/pgdata")
      require_value("[nervion]:pg1-socket-path", "/var/run/postgresql")
      require_value("[nervion]:pg1-user", "postgres")
      require_value("[nervion]:pg1-port", "5432")
      require_value("[nervion]:pg1-database", "postgres")
      split("repo1-s3-bucket repo1-s3-endpoint repo1-s3-region repo1-s3-key repo1-s3-key-secret repo1-cipher-pass", required, " ")
      for (i in required) {
        value = settings["[global]:" required[i]]
        if (value == "" || value ~ /^REPLACE_|[<>]/) bad = 1
      }
      if (length(settings["[global]:repo1-cipher-pass"]) < 32) bad = 1
      exit bad ? 1 : 0
    }
  ' "$config" || backrest_fail 'configuration violates backup isolation, encryption or retention policy'
}

exec_backrest() {
  local role=$1; shift
  [[ "$role" == archive || "$role" == backup ]] || backrest_fail 'invalid process role'
  local work="/var/run/pgbackrest/$role"
  local -a work_options=()
  [[ -d "$work" && ! -L "$work" && -w "$work" ]] || backrest_fail 'private runtime directory is unavailable'
  mkdir -p -- "$work/lock" "$work/spool"
  # check does not accept lock-path. Spooling is unused in synchronous archive
  # mode and pgBackRest rejects spool-path unless archive-async is enabled.
  if [[ "${1:-}" != check ]]; then
    work_options=(--lock-path="$work/lock")
  fi
  # All PGBACKREST_* variables are removed; the secret file is the only source
  # of credentials and repository options. The empty include directory is baked
  # into the image and is not a writable configuration extension point.
  exec env -i PATH="$PATH" HOME=/var/lib/postgresql LANG=C \
    /usr/bin/pgbackrest --config=/run/secrets/pgbackrest_config \
    --config-include-path=/etc/pgbackrest/empty --stanza=nervion \
    "${work_options[@]}" "$@"
}
