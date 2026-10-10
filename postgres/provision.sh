#!/bin/sh
# One-shot (compose service `db-init`): give every service its own database and login role, idempotently.
# Runs on every `docker compose up`; services that need a database start after it (service_completed_successfully).
# For each name in SERVICE_DBS: role <name> with password $<NAME>_DB_PASSWORD (re-applied each run, so changing
# .env just works), database <name>_db owned by it, CONNECT only for that role. Tables are created by the service.
set -eu

psql_su() { psql -v ON_ERROR_STOP=1 -qtA -h postgres -U "$PGUSER" -d postgres "$@"; }

# The main database stops being open to every role (it is the backend's; services must not read it)
psql_su -c "REVOKE CONNECT ON DATABASE \"$POSTGRES_DB\" FROM PUBLIC"

for svc in $SERVICE_DBS; do
  var=$(echo "${svc}_DB_PASSWORD" | tr 'a-z-' 'A-Z_')
  pw=$(printenv "$var" || true)
  [ -n "$pw" ] || { echo "[db-init] $var is empty" >&2; exit 1; }
  psql_su -v role="$svc" -v pw="$pw" -v db="${svc}_db" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'role') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'role', :'pw') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'role') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'role') \gexec
SQL
  echo "[db-init] ${svc}_db ready"
done
