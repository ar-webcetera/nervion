# PG 17.10 / Debian 13. Build from repository root, linux/amd64 only.
FROM postgres:17@sha256:a426e44bac0b759c95894d68e1a0ac03ecc20b619f498a91aae373bf06d8508d

# Pin every added package and verify its signed-repository checksum. If a
# version disappears, the build fails instead of silently upgrading the image.
RUN test "$(dpkg --print-architecture)" = amd64 \
 && apt-get update \
 && cd /tmp \
 && apt-get download pgbackrest=2.60.0-1.pgdg13+1 libssh2-1t64=1.11.1-1+deb13u2 ca-certificates=20250419+deb13u1 \
 && echo '609dae5ee9c413e25fde3bd0fc2fd2140cb93d137baeedf152ffa1998786ab60  pgbackrest_2.60.0-1.pgdg13+1_amd64.deb' | sha256sum --check --strict \
 && echo 'dbb1024c192d4d292b7cfa902b96076cfe81b56a5eed4fb28da36e8bf543e49a  libssh2-1t64_1.11.1-1+deb13u2_amd64.deb' | sha256sum --check --strict \
 && echo 'c10585ac22c7f617a73d394eea29ba71d0356f350ae973b19043d1b017f80f54  ca-certificates_20250419+deb13u1_all.deb' | sha256sum --check --strict \
 && apt-get install -y --no-install-recommends --no-upgrade \
      /tmp/pgbackrest_2.60.0-1.pgdg13+1_amd64.deb /tmp/libssh2-1t64_1.11.1-1+deb13u2_amd64.deb /tmp/ca-certificates_20250419+deb13u1_all.deb \
 && test "$(pgbackrest version)" = 'pgBackRest 2.60.0' \
 && test -f /usr/lib/postgresql/17/lib/pg_stat_statements.so \
 && test -f /usr/share/postgresql/17/extension/uuid-ossp.control \
 && test -s /etc/ssl/certs/ca-certificates.crt \
 && rm -f /tmp/pgbackrest_2.60.0-1.pgdg13+1_amd64.deb /tmp/libssh2-1t64_1.11.1-1+deb13u2_amd64.deb /tmp/ca-certificates_20250419+deb13u1_all.deb \
 && rm -rf /var/lib/apt/lists/*

COPY deploy/production/postgres/pgbackrest-common.sh /usr/local/lib/nervion/pgbackrest-common.sh
COPY deploy/production/postgres/archive-push.sh /usr/local/bin/nervion-pgbackrest-archive-push
COPY deploy/production/postgres/backup.sh /usr/local/bin/nervion-backup
RUN chmod 0755 /usr/local/bin/nervion-pgbackrest-archive-push /usr/local/bin/nervion-backup \
 && chmod 0644 /usr/local/lib/nervion/pgbackrest-common.sh \
 && install -d -o postgres -g postgres -m 0700 \
      /var/run/pgbackrest/archive /var/run/pgbackrest/backup \
 && install -d -o root -g root -m 0755 /etc/pgbackrest/empty

ENV PGDATA=/var/lib/postgresql/data/pgdata
