#!/bin/sh
# Wait for MariaDB, apply the schema, then hand off to the API.
set -e

DB_HOST="${DB_HOST:-mariadb}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-icms}"
DB_USER="${DB_USER:-icms_user}"

echo "[entrypoint] waiting for MariaDB at ${DB_HOST}:${DB_PORT} …"
i=0
until mariadb -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" \
      -e "SELECT 1" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "[entrypoint] MariaDB did not become ready within 120s — giving up." >&2
    exit 1
  fi
  sleep 2
done
echo "[entrypoint] MariaDB is up."

if [ "${SKIP_SCHEMA:-false}" != "true" ]; then
  echo "[entrypoint] applying schema (idempotent) …"
  # --force is required, not cosmetic: MariaDB has no CREATE INDEX IF NOT EXISTS
  # before 10.6, so re-running hits "Duplicate key name" and, without --force,
  # the client would abort and silently skip every statement after it (including
  # the ALTERs and the seed rows).
  mariadb --force -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" \
    < /app/schema.mariadb.sql 2>&1 | grep -viE "duplicate key name|insecure" || true
  echo "[entrypoint] schema applied."
fi

exec "$@"
