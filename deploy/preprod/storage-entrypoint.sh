#!/bin/sh
set -eu
export AWS_ACCESS_KEY_ID="$(tr -d '\n' < /run/secrets/storage_access_key)"
export AWS_SECRET_ACCESS_KEY="$(tr -d '\n' < /run/secrets/storage_secret_key)"
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ "${#AWS_SECRET_ACCESS_KEY}" -lt 32 ]; then
  echo 'Private S3 requires generated credentials before startup.' >&2
  exit 1
fi
exec weed mini -dir=/data -ip=storage -ip.bind=0.0.0.0 -volume.max=8 -master.volumeSizeLimitMB=128 -webdav=false -admin.ui=false -admin.port.legacy=0 -s3.port=8333 -s3.port.iceberg=0 -s3.port.lance=0
