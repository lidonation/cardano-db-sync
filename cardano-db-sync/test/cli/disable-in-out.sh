#!/bin/sh
# Exercise the real executable, before it reads a configuration or opens a database.
set -eu
exe=$(realpath "$1")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
# Without the retired flag, the parser must continue to normal configuration loading.
if "$exe" --config "$tmp/missing.json" --socket-path "$tmp/socket" --schema-dir "$tmp/schema" >"$tmp/out" 2>&1; then
  echo 'Expected missing configuration to fail' >&2
  exit 1
fi
grep -q 'Cannot find.*configuration file' "$tmp/out"

if "$exe" --config "$tmp/missing.json" --socket-path "$tmp/socket" --schema-dir "$tmp/schema" --disable-in-out >"$tmp/out" 2>&1; then
  echo 'Expected --disable-in-out to be rejected' >&2
  exit 1
fi
grep -q -- '--disable-in-out' "$tmp/out"
grep -q -- 'tx_out' "$tmp/out"
grep -q -- 'disable' "$tmp/out"
if grep -qi 'missing.json.*does not exist\|database migration' "$tmp/out"; then
  echo 'CLI rejection happened after startup' >&2
  exit 1
fi
echo 'Legacy CLI option rejection passed'
# Each retired JSON mode must fail during config decoding, before node configuration or DB access.
for mode in text jsonb disable; do
  cat >"$tmp/config.yaml" <<CONFIG
NetworkName: test
NodeConfigFile: $tmp/missing-node.json
EnableLogging: false
EnableLogMetrics: false
insert_options:
  json_type: $mode
  remove_jsonb_from_schema: enable
CONFIG
  if "$exe" --config "$tmp/config.yaml" --socket-path "$tmp/socket" --schema-dir "$tmp/schema" --state-dir "$tmp/state" >"$tmp/out" 2>&1; then
    echo "Expected json_type=$mode to be rejected" >&2
    exit 1
  fi
  grep -q 'insert_options.json_type is retired' "$tmp/out"
  if grep -qi 'missing-node.json.*does not exist\|database migration' "$tmp/out"; then
    echo "json_type=$mode was rejected after startup" >&2
    exit 1
  fi
done
echo 'Retired JSON selectors rejected before startup'
