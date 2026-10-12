#!/bin/sh
# Run with the compiled extract-renames executable as the sole argument.
set -eu
exe=$(realpath "$1")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/repo/schema"
printf 'ALTER TABLE a RENAME TO b;\n' > "$tmp/repo/schema/migration-2-0001-20200101.sql"
fail() {
  if "$exe" "$@" >"$tmp/stdout" 2>"$tmp/stderr"; then
    echo "Expected failure: $*" >&2
    exit 1
  fi
  grep -q '^extract-renames:' "$tmp/stderr"
}
"$exe" --help >"$tmp/stdout"
grep -q '^usage: extract-renames' "$tmp/stdout"
fail
fail --out
fail --unknown value
fail --out ''
fail --repo-root '' --out "$tmp/out.json"
fail --repo-root "$tmp/missing" --out "$tmp/out.json"
fail --repo-root "$tmp/repo" --out "$tmp"
"$exe" --repo-root "$tmp/repo" --out "$tmp/nested/out.json"
python3 - "$tmp/nested/out.json" <<'PY'
import json,sys
value=json.load(open(sys.argv[1]))
assert value['renames'][0]['from']=='a'
assert value['entities'][0]['name']=='b'
PY
printf '\377' > "$tmp/repo/schema/migration-2-0001-20200101.sql"
fail --repo-root "$tmp/repo" --out "$tmp/out.json"
grep -q 'not valid UTF-8' "$tmp/stderr"
test ! -e "$tmp/out.json"
echo 'Rename CLI regression tests passed'
