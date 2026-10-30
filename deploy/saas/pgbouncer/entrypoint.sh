#!/bin/sh
set -eu
umask 077

# Restrict to generated URL-safe passwords so auth_file escaping is unambiguous.
: > /run/pgbouncer/userlist.txt.new
for role in nervion_data nervion_platform; do
  case "$role" in
    nervion_data) secret_file=/run/secrets/data_password ;;
    nervion_platform) secret_file=/run/secrets/platform_password ;;
  esac
  secret_value=$(tr -d '\n' < "$secret_file")
  case "$secret_value" in
    ''|*[!A-Za-z0-9_-]*) echo 'PgBouncer requires URL-safe generated passwords.' >&2; exit 1 ;;
  esac
  if [ "${#secret_value}" -lt 32 ]; then
    echo 'PgBouncer passwords must have at least 32 characters.' >&2
    exit 1
  fi
  printf '"%s" "%s"\n' "$role" "$secret_value" >> /run/pgbouncer/userlist.txt.new
done
mv /run/pgbouncer/userlist.txt.new /run/pgbouncer/userlist.txt
unset secret_value
exec pgbouncer /etc/pgbouncer/pgbouncer.ini
