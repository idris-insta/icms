#!/usr/bin/env bash
# Regression tests for the silent-exit class of bug.
#
# The installers run under `set -euo pipefail`, where a failing pipeline inside
# a command substitution terminates the script with no output. This checks that
# each installer reaches its first real step instead of dying quietly, and that
# secret generation is stable across many runs.
cd "$(dirname "$0")" || exit 1
pass=0; fail=0
ok()  { printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
bad() { printf '  FAIL %s\n       %s\n' "$1" "$2"; fail=$((fail+1)); }

echo "0. Scripts are executable, in the working tree and in git"
# This bit has been lost twice: once committed as 100644 (so a fresh clone got
# "Permission denied" from ./install.sh) and once dropped by a rewrite.
for f in install.sh install-native.sh backup.sh backup-native.sh \
         make-export-zip.sh test-restore.sh verify.sh migrate-from-postgres.sh \
         docker/entrypoint.sh; do
  [ -e "$f" ] || continue
  [ -x "$f" ] && ok "$f is executable" || bad "$f" "not executable in the working tree"
  mode=$(git ls-files -s -- "$f" | cut -d' ' -f1)
  case "$mode" in
    100755|"") ok "$f tracked executable" ;;
    *)         bad "$f" "tracked as $mode — a fresh clone cannot run it" ;;
  esac
done

echo
echo "1. gen() survives set -euo pipefail, repeatedly"
for script in install.sh install-native.sh; do
  # Extract this script's own gen() and exercise it under the same shell options.
  probe=$(mktemp); trap 'rm -f "$probe"' EXIT
  {
    echo 'set -euo pipefail'
    sed -n '/^gen() {/,/^}/p' "$script"
    echo 'for i in $(seq 1 25); do'
    echo '  v=$(gen 48)'
    echo '  [ ${#v} -eq 48 ] || { echo "BADLEN ${#v}"; exit 2; }'
    echo '  case "$v" in *[^A-Za-z0-9]*) echo "BADCHAR"; exit 3;; esac'
    echo 'done'
    echo 'echo SURVIVED'
  } > "$probe"
  out=$(bash "$probe" 2>&1)
  case "$out" in
    *SURVIVED*) ok "$script gen(): 25 runs, correct length and charset" ;;
    "")         bad "$script gen()" "died silently (the original bug)" ;;
    *)          bad "$script gen()" "$out" ;;
  esac
  rm -f "$probe"
done

echo
echo "2. Installers reach their first real step rather than exiting silently"

# install-native.sh: no MariaDB client on this machine, so it must reach the
# prerequisite check and say so. Silence would mean it died earlier.
out=$(./install-native.sh --port 3456 2>&1 || true)
case "$out" in
  *"No mariadb/mysql client found"*) ok "install-native.sh reports the missing prerequisite" ;;
  "")                                bad "install-native.sh" "no output at all — silent exit" ;;
  *)                                 bad "install-native.sh" "$(echo "$out" | tail -2)" ;;
esac

# install.sh: Docker is not running here, so it must say that.
out=$(./install.sh --port 3456 2>&1 || true)
case "$out" in
  *"Docker"*) ok "install.sh reports the Docker prerequisite" ;;
  "")         bad "install.sh" "no output at all — silent exit" ;;
  *)          bad "install.sh" "$(echo "$out" | tail -2)" ;;
esac

echo
echo "3. Every pipeline in a strict-mode script is guarded or safe"
unguarded=0
for f in install.sh install-native.sh make-export-zip.sh test-restore.sh; do
  while IFS= read -r line; do
    n=${line%%:*}; body=${line#*:}
    case "$body" in
      *'#'*) continue ;;
    esac
    # A pipeline is fine if its failure is handled, or it redirects to a file
    # (where a genuine failure should abort), or it is a command-list guard.
    case "$body" in
      *'|| true'*|*'|| die'*|*'|| echo'*|*'|| {'*|*'|| :'*|*'|| return'*|*'|| exit'*) continue ;;
      *'if '*|*'while '*) continue ;;
      *'| gzip >'*|*'| docker compose exec'*) continue ;;
      *'||'*) continue ;;
    esac
    case "$body" in
      *'| head'*|*'| tail'*|*'| awk'*|*'| cut'*|*'| grep -q'*|*'| grep -c'*)
        printf '       %s:%s%s\n' "$f" "$n" "$body"
        unguarded=$((unguarded+1)) ;;
    esac
  done < <(grep -nE '\|[^|]' "$f")
done
[ "$unguarded" -eq 0 ] && ok "no unguarded early-closing pipelines" \
  || bad "unguarded pipelines" "$unguarded found (listed above)"

echo
echo "4. Scripts parse"
for f in install.sh install-native.sh backup.sh backup-native.sh make-export-zip.sh test-restore.sh verify.sh; do
  bash -n "$f" 2>/dev/null && ok "$f parses" || bad "$f" "syntax error"
done

echo
printf '%d passed, %d failed\n' "$pass" "$fail"
exit "$fail"
