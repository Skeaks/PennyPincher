#!/usr/bin/env bash
# The client-side-only, no-credentials architecture is a LEGAL constraint, not a preference.
# This check fails if app/package code references credential storage, cookie writes,
# retailer auth endpoints, or dynamic code execution. See docs/decisions/0003-capture-posture.md
set -euo pipefail
cd "$(dirname "$0")/.."

# Each line: regex ::: reason
RULES=$(cat <<'RULES'
chrome\.cookies\.(set|remove)|browser\.cookies\.(set|remove) ::: extension must never write retailer cookies
chrome\.cookies\.get(All)?\(|browser\.cookies\.get(All)?\( ::: extension must never read retailer cookies
document\.cookie ::: never read or write cookies from content scripts
\b(password|passwd|passphrase)\b\s*[:=] ::: no credential fields anywhere
credentials\s*:\s*['"]include['"] ::: cross-origin probes must run with credentials: "omit"
/(login|signin|sign-in|auth|oauth)(/|\?|['"]) ::: never call a retailer auth endpoint
\beval\( ::: no dynamic code execution
new\s+Function\( ::: no dynamic code execution
webRequestBlocking|declarativeNetRequest ::: never intercept or rewrite retailer traffic
RULES
)

FAIL=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  REGEX="${line%% ::: *}"
  REASON="${line##* ::: }"
  if command -v rg >/dev/null 2>&1; then
    HITS=$(rg -n --glob '!node_modules' --glob '!docs/**' --glob '!scripts/**' --glob '!**/*.test.*' --glob '!**/fixtures/**' \
      --glob '*.{ts,tsx,js,jsx,mjs,cjs,json}' -e "$REGEX" apps packages 2>/dev/null || true)
  else
    HITS=$(grep -rnE --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.json' \
      --exclude-dir=node_modules --exclude-dir=fixtures -e "$REGEX" apps packages 2>/dev/null | grep -v '\.test\.' || true)
  fi
  if [ -n "$HITS" ]; then
    echo "::error::forbidden-api: $REASON"
    echo "$HITS"
    FAIL=1
  fi
done <<< "$RULES"

if [ "$FAIL" -ne 0 ]; then exit 1; fi
echo "forbidden-api: clean"
