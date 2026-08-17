#!/usr/bin/env bash
# Prove a backup can actually be restored: load the newest dump into a scratch
# database and compare row counts against the live one. Never touches live data.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

# `|| true`: head closes the pipe after one line, which can leave ls killed by
# SIGPIPE — fatal under `set -euo pipefail`.
DUMP=$(ls -t backups/icms-db-*.sql.gz 2>/dev/null | head -1 || true)
[ -n "$DUMP" ] || { echo "No dump found — run ./backup.sh first." >&2; exit 1; }
echo "==> Restoring $DUMP into scratch database icms_restore_test"

DB="${DB_NAME:-icms}"
myroot() { docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb mariadb -u root "$@" 2>/dev/null; }

myroot -e "DROP DATABASE IF EXISTS icms_restore_test; CREATE DATABASE icms_restore_test;"
gunzip -c "$DUMP" | docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb \
  mariadb -u root icms_restore_test 2>&1 | grep -vi "insecure" || true

echo "==> Comparing row counts (live vs restored)"
fail=0
for t in users suppliers skus ports order_schedules import_orders order_items payments documents settings; do
  a=$(myroot -N -e "SELECT COUNT(*) FROM \`$DB\`.\`$t\`")
  b=$(myroot -N -e "SELECT COUNT(*) FROM icms_restore_test.\`$t\`")
  if [ "$a" = "$b" ]; then
    printf "  OK   %-16s %s\n" "$t" "$a"
  else
    printf "  FAIL %-16s live=%s restored=%s\n" "$t" "$a" "$b"; fail=1
  fi
done

echo "==> Dropping scratch database"
myroot -e "DROP DATABASE icms_restore_test;"

[ "$fail" -eq 0 ] && echo "RESTORE VERIFIED" || { echo "RESTORE MISMATCH"; exit 1; }
