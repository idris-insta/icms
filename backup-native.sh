#!/usr/bin/env bash
# Dump the ICMS database and uploaded documents (non-Docker install).
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="icms-backend/.env"
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE not found — run ./install-native.sh first." >&2; exit 1; }
set -a; . "./$ENV_FILE"; set +a

if command -v mariadb-dump >/dev/null 2>&1; then DUMP=mariadb-dump
elif command -v mysqldump >/dev/null 2>&1; then DUMP=mysqldump
else echo "No mariadb-dump/mysqldump found." >&2; exit 1; fi

STAMP=$(date -u '+%Y%m%d-%H%M%S')
mkdir -p backups

echo "==> Dumping database"
MYSQL_PWD="$DB_PASSWORD" "$DUMP" \
  -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "$DB_USER" \
  --single-transaction --routines --events \
  "${DB_NAME:-icms}" | gzip > "backups/icms-db-${STAMP}.sql.gz"

echo "==> Archiving uploads"
tar -czf "backups/icms-uploads-${STAMP}.tar.gz" -C icms-backend uploads

echo "==> Done:"
ls -lh "backups/icms-db-${STAMP}.sql.gz" "backups/icms-uploads-${STAMP}.tar.gz"

cat <<EOF

Restore the database with:
  gunzip -c backups/icms-db-${STAMP}.sql.gz | \\
    MYSQL_PWD="\$DB_PASSWORD" mariadb -u "\$DB_USER" "\${DB_NAME:-icms}"
EOF
