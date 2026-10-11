#!/bin/sh
# Run with the compiled extract-haddock executable as the sole argument.
set -eu
exe=$(realpath "$1")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
repo="$tmp/repo"
mkdir -p "$repo/fixtures" "$repo/cardano-db/src" "$repo/cardano-db-sync/src/Cardano/DbSync/Config" "$repo/empty"
printf 'module Fixture where\n-- | Fixture café documentation.\nf :: Int\nf = 1\n' > "$repo/fixtures/F.hs"
printf 'module Default where\n' > "$repo/cardano-db/src/Default.hs"
printf 'module Config where\n' > "$repo/cardano-db-sync/src/Cardano/DbSync/Config/Types.hs"
run() { "$exe" --repo-root "$repo" --out "$tmp/out.json" "$@"; }
fail() {
  if run "$@" >"$tmp/stdout" 2>"$tmp/stderr"; then
    echo "Expected failure: $*" >&2
    exit 1
  fi
  grep -q 'extract-haddock:' "$tmp/stderr"
}
run --input fixtures
python3 - "$tmp/out.json" <<'PY'
import json,sys
data = json.load(open(sys.argv[1]))
assert [f['path'] for f in data['files']] == ['fixtures/F.hs']
assert 'café' in data['files'][0]['annotations'][0]['doc']
PY
run --input fixtures --input "$repo/fixtures/F.hs" --input fixtures/../fixtures
python3 - "$tmp/out.json" <<'PY'
import json,sys
assert len(json.load(open(sys.argv[1]))['files']) == 1
PY
(cd "$tmp"; "$exe" --repo-root repo --out out.json --input "$repo/fixtures")
run
python3 - "$tmp/out.json" <<'PY'
import json,sys
assert len(json.load(open(sys.argv[1]))['files']) == 2
PY
fail --input missing
fail --input empty
printf 'module Outside where\n' > "$tmp/Outside.hs"
fail --input "$tmp/Outside.hs"
ln -s "$tmp/Outside.hs" "$repo/fixtures/Escaped.hs"
fail --input fixtures
rm "$repo/fixtures/Escaped.hs"
ln -s "$repo/fixtures" "$repo/fixtures/cycle"
run --input fixtures
fail --input fixtures/cycle
printf '\377' > "$repo/fixtures/Invalid.hs"
fail --input fixtures/Invalid.hs
grep -q 'Invalid.hs: invalid UTF-8' "$tmp/stderr"
rm "$repo/fixtures/Invalid.hs"
LC_ALL=C run --input fixtures
echo 'CLI regression tests passed'
