#!/bin/bash
# ============================================================================
# API Request Double-Parse Guard
# ============================================================================
#
# This script checks for double JSON parsing on apiRequest return values.
# The apiRequest() function already parses JSON, so calling .json() again
# will fail or cause bugs.
#
# Prohibited patterns:
#   - apiRequest(...).json(
#   - const res = await apiRequest(...); await res.json()
#
# NOT flagged (valid patterns):
#   - fetch(...).json() - raw fetch requires .json()
#   - const res = await fetch(...); res.json() - raw fetch requires .json()
#
# Exit codes:
#   0 - No violations found
#   1 - Violations found
#
# Usage:
#   ./scripts/check-apiRequest-double-parse.sh
#   npm run lint:api-parse
#
# ============================================================================

set -e

echo "Checking for apiRequest double-parse patterns..."

VIOLATIONS=""

# Pattern 1: Direct .json() call chained on apiRequest (rare but catches apiRequest(...).json())
PATTERN1=$(grep -rn "apiRequest(.*\.json(" /home/runner/workspace/client/src --include="*.ts" --include="*.tsx" 2>/dev/null || true)
if [ -n "$PATTERN1" ]; then
  VIOLATIONS="$VIOLATIONS$PATTERN1"$'\n'
fi

# Pattern 2: Variable assigned from apiRequest, then .json() called on that variable
# This checks for: const/let/var X = await apiRequest(...) followed by X.json(
grep -rn "= await apiRequest" /home/runner/workspace/client/src --include="*.ts" --include="*.tsx" 2>/dev/null | while read -r line; do
  FILE=$(echo "$line" | cut -d: -f1)
  LINENUM=$(echo "$line" | cut -d: -f2)

  # Extract variable name (supports const, let, var)
  VARNAME=$(echo "$line" | grep -oP '(?<=const |let |var )\w+(?= =)' || true)
  if [ -n "$VARNAME" ]; then
    # Look for patterns like "varname.json(" in next 5 lines
    NEXT_LINES=$(sed -n "$((LINENUM+1)),$((LINENUM+5))p" "$FILE" 2>/dev/null || true)
    if echo "$NEXT_LINES" | grep -q "${VARNAME}\.json("; then
      echo "$FILE:$LINENUM: Double-parse - '$VARNAME' assigned from apiRequest, then .json() called"
    fi
  fi
done > /tmp/apiparse_pattern2.txt 2>/dev/null || true

if [ -s /tmp/apiparse_pattern2.txt ]; then
  VIOLATIONS="$VIOLATIONS$(cat /tmp/apiparse_pattern2.txt)"$'\n'
fi
rm -f /tmp/apiparse_pattern2.txt

# Clean up empty lines
VIOLATIONS=$(echo "$VIOLATIONS" | grep -v '^$' || true)

if [ -z "$VIOLATIONS" ]; then
  echo "No apiRequest double-parse violations found."
  exit 0
fi

echo ""
echo "ERROR: Found apiRequest double-parse violations!"
echo "========================================================================"
echo "$VIOLATIONS"
echo "========================================================================"
echo ""
echo "apiRequest() already returns parsed JSON. Do NOT call .json() on the result."
echo ""
echo "BAD:  const data = await apiRequest('/api/foo').json()"
echo "BAD:  const res = await apiRequest('/api/foo'); const data = await res.json()"
echo "GOOD: const data = await apiRequest('/api/foo')"
echo ""
echo "NOTE: Raw fetch() calls ARE allowed to use .json() - this script only flags apiRequest."
echo ""
exit 1
