#!/usr/bin/env bash
# Package the repository as a zip for hand-off.
#
# Includes the full .git history so the archive can be unzipped, inspected and
# pushed. Excludes node_modules, build output, uploaded files, backups and — most
# importantly — .env, which holds live secrets.
set -euo pipefail
cd "$(dirname "$0")"

STAMP=$(date -u '+%Y%m%d-%H%M')
OUT="/mnt/c/Users/Idris/Desktop/icms-${STAMP}.zip"

command -v zip >/dev/null 2>&1 || { echo "zip is not installed: sudo apt install zip" >&2; exit 1; }

echo "==> Verifying nothing sensitive is tracked"
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo ".env is tracked by git — refusing to build an archive." >&2
  exit 1
fi

echo "==> Archiving"
rm -f "$OUT"
zip -r -q "$OUT" . \
  -x '*/node_modules/*' 'node_modules/*' \
  -x '*/dist/*' 'dist/*' \
  -x '.env' '*/.env' \
  -x 'backups/*' \
  -x 'icms-backend/uploads/*' \
  -x '*.zip' \
  -x '.commitmsg'

echo "==> Confirming the archive carries no secrets"
if unzip -l "$OUT" | grep -qE ' \.env$|/\.env$|backups/'; then
  echo "Archive contains a secret file — deleting it." >&2
  rm -f "$OUT"
  exit 1
fi

echo
echo "Wrote: $OUT"
du -h "$OUT" | cut -f1 | sed 's/^/Size: /'
echo "Files: $(unzip -l "$OUT" | tail -1 | awk '{print $2}')"
echo "Includes .git history: $(unzip -l "$OUT" | grep -c '\.git/' || true) git objects"
