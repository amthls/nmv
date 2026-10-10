#!/bin/sh
# NovelHub backup (runs inside the `backup` container, see docker-compose.yml).
#   backup.sh run [tag]   dump every database + globals, back up uploads/, apply the retention policy
#   backup.sh check       verify the repository, restore the newest dump into a temp DB, compare tables/rows
#   backup.sh stale       alert admins when the last good backup is older than 26 hours
# Repository: restic in /repo (host ./backups/repo), encrypted with RESTIC_PASSWORD from .env.
# Status for the admin page: /status/status.json (host ./backups/status, mounted read-only into backend).
set -eu
HOST=nmv # fixed: the container hostname changes on every recreate and restic groups snapshots by host
STATUS=/status
mkdir -p "$STATUS"

log() { echo "[backup] $(date '+%F %T') $*"; }

# psql against the main database; stdin is the SQL
q() { psql -v ON_ERROR_STOP=1 -qtA -d "${POSTGRES_DB:-novel_platform}" "$@"; }

# Site notification to every admin, once per key (dedupe_key is unique)
notify_admins() { # key title message
  q -v key="$1" -v title="$2" -v msg="$3" <<'SQL' || log "could not notify admins"
INSERT INTO notifications (user_id, type, title, message, dedupe_key)
SELECT DISTINCT user_id, 'system'::notification_type, :'title', :'msg', 'backup:' || :'key' || ':' || user_id
FROM user_roles WHERE role = 'admin'
ON CONFLICT DO NOTHING;
SQL
}

# Set key=value pairs (one file per key) and rebuild the flat status.json read by GET /admin/backup-status
set_status() {
  mkdir -p "$STATUS/keys"
  for kv in "$@"; do printf '%s' "${kv#*=}" > "$STATUS/keys/${kv%%=*}"; done
  {
    echo '{'
    for f in "$STATUS"/keys/*; do
      printf '  "%s": "%s",\n' "$(basename "$f")" "$(tr '\n' ' ' < "$f" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    done | sed '$ s/,$//'
    echo '}'
  } > "$STATUS/status.json.tmp"
  mv "$STATUS/status.json.tmp" "$STATUS/status.json"
}

databases() {
  psql -qtA -d postgres -c "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname NOT IN ('postgres', 'restore_check') AND datname NOT LIKE '%_restored' ORDER BY 1"
}

run() {
  tag=${1:-daily}
  [ -f /repo/config ] || restic init
  started=$(date +%s)
  # Plain (-Z0) custom-format dumps: restic compresses and de-duplicates them across days
  restic backup -q --host "$HOST" --tag db --tag "$tag" --stdin-filename globals.sql --stdin-from-command -- pg_dumpall --globals-only
  for db in $(databases); do
    restic backup -q --host "$HOST" --tag db --tag "$tag" --stdin-filename "$db.dump" --stdin-from-command -- pg_dump -Fc -Z0 -d "$db"
    log "dumped $db"
  done
  restic backup -q --host "$HOST" --tag uploads --tag "$tag" /data/uploads
  restic forget -q --host "$HOST" --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
  echo "$started" > "$STATUS/last_ok"
  set_status "last_backup_at=$(date -Iseconds)" "last_backup_ok=true" "last_backup_error=" \
    "last_backup_seconds=$(($(date +%s) - started))" "repo_size=$(du -sh /repo | cut -f1)" \
    "snapshots=$(restic snapshots -q --host "$HOST" --json | grep -o '"short_id"' | wc -l)"
  log "backup ($tag) done"
}

rows_and_tables() { # db -> "tables rows"
  psql -qtA -d "$1" <<'SQL'
SELECT count(*) || ' ' || coalesce(sum((xpath('/row/c/text()',
  query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint), 0)
FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
SQL
}

check() {
  db=${POSTGRES_DB:-novel_platform}
  restic check -q
  psql -q -d postgres -c 'DROP DATABASE IF EXISTS restore_check' -c 'CREATE DATABASE restore_check'
  restic dump -q --host "$HOST" --path "/$db.dump" latest "/$db.dump" | pg_restore --no-owner --exit-on-error -d restore_check
  set -- $(rows_and_tables "$db"); live_t=$1; live_r=$2
  set -- $(rows_and_tables restore_check); got_t=$1; got_r=$2
  psql -q -d postgres -c 'DROP DATABASE restore_check'
  detail="bảng $got_t/$live_t, dòng $got_r/$live_r"
  # Rows may legitimately differ by a day of activity; a big gap means a broken dump
  [ "$got_t" = "$live_t" ] && [ $((got_r * 10)) -ge $((live_r * 9)) ] || { echo "restore check mismatch: $detail" >&2; return 1; }
  set_status "last_check_at=$(date -Iseconds)" "last_check_ok=true" "last_check_detail=$detail"
  log "restore check ok: $detail"
}

stale() {
  last=$(cat "$STATUS/last_ok" 2>/dev/null || echo 0)
  if [ $(($(date +%s) - last)) -gt $((26 * 3600)) ]; then
    notify_admins "stale-$(date +%F)" "Sao lưu: quá 26 giờ chưa có bản mới" \
      "Bản sao lưu thành công gần nhất: $( [ "$last" = 0 ] && echo 'chưa có' || date -d "@$last" '+%F %T'). Xem log: docker compose logs backup"
  fi
}

cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
  run|check)
    # Plain statement + subshell: inside `if`/`&&`/`||` the shell silently ignores set -e and a failed step would pass
    set +e
    (set -e; "$cmd" "$@") > "$STATUS/last_$cmd.log" 2>&1
    rc=$?
    set -e
    cat "$STATUS/last_$cmd.log"
    if [ "$rc" != 0 ]; then
      err=$(grep -v '^\[backup\]' "$STATUS/last_$cmd.log" | tail -3 | tr '\n' ' ')
      [ "$cmd" = run ] && set_status "last_backup_ok=false" "last_backup_error=$err" || set_status "last_check_ok=false" "last_check_detail=$err"
      notify_admins "$cmd-fail-$(date +%F)" "Sao lưu: lỗi khi $( [ "$cmd" = run ] && echo 'tạo bản sao lưu' || echo 'thử khôi phục')" "$err"
      exit 1
    fi
    ;;
  stale) stale ;;
  *) echo "usage: backup.sh run [tag] | check | stale" >&2; exit 2 ;;
esac
