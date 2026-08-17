#!/usr/bin/env bash
# Run every verification suite against a deployed instance.
#   ./verify.sh                    # defaults to http://127.0.0.1:8099
#   ICMS_BASE=http://host:8080 ./verify.sh
cd "$(dirname "$0")" || exit 1
export ICMS_BASE="${ICMS_BASE:-http://127.0.0.1:8099}"

echo "Verifying $ICMS_BASE"
rc=0

echo "=== installer scripts (unit) ==="
if bash installer.test.sh; then :; else rc=1; fi

echo
echo "=== dialect (unit) ==="
if (cd icms-backend && node dialect.test.js); then :; else rc=1; fi
for t in smoke race_test search_test json_test authz_test import_test ai_test; do
  echo
  echo "=== $t ==="
  if python3 "$t.py"; then :; else rc=1; fi
done

echo
if [ "$rc" -eq 0 ]; then
  echo "ALL SUITES PASSED"
else
  echo "SOME SUITES FAILED"
fi
exit $rc
