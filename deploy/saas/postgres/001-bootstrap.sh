#!/usr/bin/env bash
set -euo pipefail

# Only used by the official PostgreSQL image on an empty data volume.
# Passwords come from Docker secrets, never from checked-in configuration.
export NERVION_DATA_PASSWORD="$(< /run/secrets/data_password)"
export NERVION_PLATFORM_PASSWORD="$(< /run/secrets/platform_password)"
export NERVION_DATA_MIGRATOR_PASSWORD="$(< /run/secrets/data_migrator_password)"
export NERVION_PLATFORM_MIGRATOR_PASSWORD="$(< /run/secrets/platform_migrator_password)"
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 --file /opt/nervion/bootstrap.sql
unset NERVION_DATA_PASSWORD NERVION_PLATFORM_PASSWORD NERVION_DATA_MIGRATOR_PASSWORD NERVION_PLATFORM_MIGRATOR_PASSWORD
