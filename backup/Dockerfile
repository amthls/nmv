# Same Postgres major as the database, so pg_dump/pg_restore always match the server.
FROM postgres:16-alpine
RUN apk add --no-cache restic
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh \
 && printf '%s\n' \
    '0 3 * * * backup.sh run > /proc/1/fd/1 2>&1' \
    '0 5 * * 0 backup.sh check > /proc/1/fd/1 2>&1' \
    '30 * * * * backup.sh stale > /proc/1/fd/1 2>&1' \
    > /etc/crontabs/root
# crond in the foreground; job output goes to `docker compose logs backup`
CMD ["crond", "-f", "-l", "8"]
