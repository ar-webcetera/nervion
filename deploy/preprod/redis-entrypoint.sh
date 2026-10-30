#!/bin/sh
set -eu
umask 077
redis_secret=$(tr -d '\n' < /run/secrets/redis_password)
case "$redis_secret" in
  ''|*[!A-Za-z0-9_-]*) echo 'Redis requires a generated URL-safe password.' >&2; exit 1 ;;
esac
if [ "${#redis_secret}" -lt 32 ]; then
  echo 'Redis password must have at least 32 characters.' >&2
  exit 1
fi
printf 'bind 0.0.0.0\nprotected-mode yes\nport 6379\ndir /data\nappendonly yes\nappendfsync everysec\nmaxmemory 64mb\nmaxmemory-policy noeviction\nrequirepass %s\n' "$redis_secret" > /run/nervion/redis.conf
unset redis_secret
chown -R redis:redis /run/nervion
exec /usr/local/bin/docker-entrypoint.sh redis-server /run/nervion/redis.conf
