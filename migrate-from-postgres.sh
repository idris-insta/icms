#!/usr/bin/env bash
# Copy the live PostgreSQL data into the running MariaDB container.
#
# Used when PostgreSQL listens only on 127.0.0.1 (so the app container cannot
# reach it directly): a temporary socat proxy publishes the container's MariaDB
# on a host port, and the migration runs from the host where both are visible.
#
#   ./migrate-from-postgres.sh [postgres-url]
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

PG_URL="${1:-postgresql://icms_user:icms123@127.0.0.1:5433/icms}"
PROXY_PORT=3399

cleanup() { docker stop icms-dbproxy >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Publishing container MariaDB on 127.0.0.1:${PROXY_PORT}"
docker run -d --rm --name icms-dbproxy --network icms_icms \
  -p "127.0.0.1:${PROXY_PORT}:${PROXY_PORT}" alpine/socat \
  "TCP-LISTEN:${PROXY_PORT},fork,reuseaddr" "TCP:mariadb:3306" >/dev/null
sleep 3

echo "==> Migrating"
cd icms-backend
PG_URL="$PG_URL" \
DB_HOST=127.0.0.1 DB_PORT="$PROXY_PORT" \
DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" DB_NAME="${DB_NAME:-icms}" \
  node migrate-to-mariadb.js
