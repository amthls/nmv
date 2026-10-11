#!/usr/bin/env sh
# Restore from the backup repository (./backups/repo). Run from anywhere: scripts/restore.sh
#   restore.sh list [db|uploads]               list snapshots (time, id, files)
#   restore.sh db <snapshot|latest> [target]   restore the main database dump into database <target>
#                                              (default: novel_platform_restored, the live DB is untouched)
#   restore.sh db <snapshot|latest> --replace  replace the LIVE database (stops the app while restoring)
#   restore.sh uploads <snapshot|latest> <dir> restore uploads/ into <dir> on the host (copy back by hand)
set -eu
cd "$(dirname "$0")/.."

ex() { docker compose exec -T backup "$@"; }
DB=$(docker compose exec -T backup sh -c 'echo "$POSTGRES_DB"' | tr -d '\r')

case "${1:-}" in
  list)
    ex restic snapshots --host nmv ${2:+--tag "$2"}
    ;;
  db)
    snap=${2:?snapshot id or latest}
    target=${3:-${DB}_restored}
    replace=false
    if [ "$target" = "--replace" ]; then
      replace=true
      target=$DB
      printf 'Replace the LIVE database "%s" with snapshot %s? Type the database name to confirm: ' "$DB" "$snap"
      read -r answer
      [ "$answer" = "$DB" ] || { echo "aborted"; exit 1; }
      ex backup.sh run pre-restore # current state, in case the chosen snapshot is the wrong one
      docker compose stop catalog worker media pgbouncer
    elif [ "$target" = "$DB" ]; then
      echo "target is the live database: use --replace" >&2; exit 1
    fi
    ex psql -qtA -d postgres -v ON_ERROR_STOP=1 \
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$target' AND pid <> pg_backend_pid()" \
      -c "DROP DATABASE IF EXISTS \"$target\"" -c "CREATE DATABASE \"$target\""
    ex sh -c "restic dump -q --host nmv --path '/$DB.dump' '$snap' '/$DB.dump' | pg_restore --no-owner --exit-on-error -d '$target'"
    echo "[restore] snapshot $snap restored into database $target"
    if $replace; then
      docker compose start pgbouncer catalog worker media
      docker compose exec -T redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning FLUSHDB' >/dev/null # drop cached pages of the old data
    fi
    ;;
  uploads)
    snap=${2:?snapshot id or latest}
    dir=${3:?target directory on the host}
    mkdir -p "$dir"
    host=$(cd "$dir" && (pwd -W 2>/dev/null || pwd)) # pwd -W: C:/... form that Docker on Windows (Git Bash) needs
    MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps -v "$host:/out" backup \
      restic restore --host nmv --tag uploads "$snap" --target /out
    echo "[restore] files are in $dir/data/uploads"
    ;;
  *)
    sed -n '2,8p' "$0"; exit 2
    ;;
esac
