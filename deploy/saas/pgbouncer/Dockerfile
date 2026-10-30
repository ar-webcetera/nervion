FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbouncer postgresql-client ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 nervion-pool \
 && useradd --uid 10001 --gid 10001 --no-create-home nervion-pool \
 && mkdir -p /run/pgbouncer \
 && chown 10001:10001 /run/pgbouncer
COPY pgbouncer.ini /etc/pgbouncer/pgbouncer.ini
COPY entrypoint.sh /usr/local/bin/nervion-pgbouncer
RUN chmod 0755 /usr/local/bin/nervion-pgbouncer
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/nervion-pgbouncer"]
