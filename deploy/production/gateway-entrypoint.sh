#!/bin/sh
set -eu
case "${PRODUCTION_INGRESS_BIND_IP:-}" in ''|*[!0-9.]*|.*|*..*|*.) echo 'Invalid ingress address' >&2; exit 1;; esac
# No public, wildcard, IPv6, shortened or octal address forms.
ingress_ifs=$IFS
IFS=.
set -- $PRODUCTION_INGRESS_BIND_IP "$@"
IFS=$ingress_ifs
if [ "$#" -lt 5 ]; then exit 1; fi
for octet in "$1" "$2" "$3" "$4"; do
  case "$octet" in ''|*[!0-9]*|0[0-9]*) echo 'Invalid ingress address' >&2; exit 1;; esac
  if [ "${#octet}" -gt 3 ] || [ "$octet" -gt 255 ]; then exit 1; fi
done
if [ "$PRODUCTION_INGRESS_BIND_IP" != "$1.$2.$3.$4" ]; then exit 1; fi
if [ "$PRODUCTION_INGRESS_BIND_IP" != '127.0.0.1' ] && [ "$1" -ne 10 ] &&
   ! { [ "$1" -eq 172 ] && [ "$2" -ge 16 ] && [ "$2" -le 31 ]; } &&
   ! { [ "$1" -eq 192 ] && [ "$2" -eq 168 ]; }; then
  echo 'Ingress must use a verified private interface' >&2
  exit 1
fi
shift 4
for hostname in "$PRODUCTION_ROOT_DOMAIN" "$PRODUCTION_ADMIN_HOST"; do
  case "$hostname" in ''|*[!a-z0-9.-]*|.*|*..*|*.) echo 'Invalid ingress hostname' >&2; exit 1;; esac
done
for port in "$PRODUCTION_HTTP_PORT" "$PRODUCTION_BACKEND_PORT" "$PRODUCTION_FRONTEND_PORT"; do
  case "$port" in ''|0*|*[!0-9]*) echo 'Invalid ingress port' >&2; exit 1;; esac
  if [ "${#port}" -gt 5 ] || [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ]; then exit 1; fi
done
exec /docker-entrypoint.sh "$@"
