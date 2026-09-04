#!/usr/bin/env bash
# Fails if source/test files contain the usual "make the test pass" escape hatches.
# Runs on the whole tree (fast) so CI and local agree. Excludes this script and docs.
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERN='@ts-ignore|@ts-expect-error|biome-ignore|eslint-disable|\.skip\(|\.only\(|\bxit\(|\bxdescribe\(|\bfit\(|\bfdescribe\('

if command -v rg >/dev/null 2>&1; then
  HITS=$(rg -n --glob '!node_modules' --glob '!docs/**' --glob '!scripts/check-escape-hatches.sh' \
    --glob '*.{ts,tsx,js,jsx,mjs,cjs}' -e "$PATTERN" . || true)
else
  HITS=$(grep -rnE --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.cjs' \
    --exclude-dir=node_modules --exclude-dir=docs --exclude-dir=dist --exclude-dir=.output \
    -e "$PATTERN" . | grep -v 'scripts/check-escape-hatches.sh' || true)
fi

if [ -n "$HITS" ]; then
  echo "::error::Escape hatches found. Fix the code or the test — never silence it."
  echo "$HITS"
  exit 1
fi
echo "no-escape-hatches: clean"
