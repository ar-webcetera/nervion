#!/usr/bin/env bash
set -Eeuo pipefail
source /usr/local/lib/nervion/pgbackrest-common.sh
[[ $# == 1 ]] || backrest_fail 'exactly one operation is required'
validate_backrest_config
case "$1" in
  full|diff) exec_backrest backup --type="$1" backup ;;
  check|stanza-create) exec_backrest backup "$1" ;;
  info) exec_backrest backup --log-level-console=off --output=json info ;;
  *) backrest_fail 'operation is not allowed' ;;
esac
