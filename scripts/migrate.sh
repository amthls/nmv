#!/usr/bin/env sh
# Applies sql/migrations/*.sql that have not run yet, in name order, each in one transaction,
# and records them in the table schema_migrations. Run from anywhere: scripts/migrate.sh
#
# First run (no schema_migrations table yet): every existing file is only RECORDED, not run,
# because sql/database.sql (fresh installs) already contains them and older installs applied them
# by hand. So: before the first run on an old database, make sure all files up to now were applied.
set -eu
cd "$(dirname "$0")/.."

psql_db() {
  docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' psql "$@"
}

if [ "$(psql_db -tAc "SELECT to_regclass('public.schema_migrations') IS NOT NULL")" != "t" ]; then
  {
    echo "CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW());"
    for f in sql/migrations/*.sql; do echo "INSERT INTO schema_migrations (name) VALUES ('$(basename "$f")');"; done
  } | psql_db --single-transaction
  echo "[migrate] baseline: recorded $(ls sql/migrations/*.sql | wc -l) existing migrations as applied"
  exit 0
fi

applied=0
for f in sql/migrations/*.sql; do
  name=$(basename "$f")
  [ "$(psql_db -tAc "SELECT 1 FROM schema_migrations WHERE name = '$name'")" = "1" ] && continue
  echo "[migrate] applying $name"
  { cat "$f"; echo; echo "INSERT INTO schema_migrations (name) VALUES ('$name');"; } | psql_db --single-transaction
  applied=$((applied + 1))
done
echo "[migrate] done, $applied new migration(s)"
