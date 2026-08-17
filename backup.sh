#!/usr/bin/env bash
# Dump the ICMS database and uploaded documents into ./backups/.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo ".env not found — run ./install.sh first." >&2; exit 1; }
set -a; . ./.env; set +a

DC=$(docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
STAMP=$(date -u '+%Y%m%d-%H%M%S')
mkdir -p backups

echo "==> Dumping database"
$DC exec -T mariadb mariadb-dump \
  -u root -p"$DB_ROOT_PASSWORD" \
  --single-transaction --routines --events \
  "${DB_NAME:-icms}" | gzip > "backups/icms-db-${STAMP}.sql.gz"

echo "==> Archiving uploads"
$DC exec -T app tar -cf - -C /app uploads | gzip > "backups/icms-uploads-${STAMP}.tar.gz"

echo "==> Done:"
ls -lh "backups/icms-db-${STAMP}.sql.gz" "backups/icms-uploads-${STAMP}.tar.gz"
echo
echo "Restore the database with:"
echo "  gunzip -c backups/icms-db-${STAMP}.sql.gz | $DC exec -T mariadb mariadb -u root -p\"\$DB_ROOT_PASSWORD\" ${DB_NAME:-icms}"
