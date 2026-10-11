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
  if [ "$applied" = 0 ] && [ "${SKIP_BACKUP:-}" != 1 ]; then
    echo "[migrate] backup snapshot first (SKIP_BACKUP=1 to skip)"
    docker compose exec -T backup backup.sh run pre-migrate || { echo "[migrate] backup failed, nothing applied" >&2; exit 1; }
  fi
  echo "[migrate] applying $name"
  { cat "$f"; echo; echo "INSERT INTO schema_migrations (name) VALUES ('$name');"; } | psql_db --single-transaction
  applied=$((applied + 1))
done
echo "[migrate] done, $applied new migration(s)"

# Accounts live in the identity service: a fresh install gets the sample accounts there (only into an empty identity_db)
if docker compose config --services 2>/dev/null | grep -qx identity; then
  docker compose run --rm --no-deps identity seed-demo
fi

# Direct messages and group chats live in the messaging service: copy what the backend database still has
# (the one-time move; later runs add nothing). Only adds, never overwrites.
if docker compose config --services 2>/dev/null | grep -qx messaging; then
  pg_pw=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2- | tr -d '\r')
  pg_user=$(grep '^POSTGRES_USER=' .env | cut -d= -f2- | tr -d '\r'); pg_user=${pg_user:-postgres}
  pg_db=$(grep '^POSTGRES_DB=' .env | cut -d= -f2- | tr -d '\r'); pg_db=${pg_db:-novel_platform}
  docker compose run --rm --no-deps -e LEGACY_DATABASE_URL="postgres://$pg_user:$pg_pw@postgres:5432/$pg_db" messaging import-legacy
fi
# Fandom posts, comments, reports live in the community service: the same one-time copy
if docker compose config --services 2>/dev/null | grep -qx community; then
  docker compose run --rm --no-deps -e LEGACY_DATABASE_URL="postgres://$pg_user:$pg_pw@postgres:5432/$pg_db" community node dist/server.js import-legacy
fi

# Chapter content lives in the workspace service: every chapter it does not know yet becomes version 1 there
# (all of them the first time; on a fresh install the sample chapters). Needs the backend running.
if docker compose config --services 2>/dev/null | grep -qx workspace; then
  docker compose run --rm workspace import
fi
