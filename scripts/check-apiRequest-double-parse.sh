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
#   - await (await apiRequest(...)).json()
#   - const data = await apiRequest(...); ... data.json()
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

# Pattern 1: Direct .json() call on apiRequest
PATTERN1=$(grep -rn "apiRequest.*\.json(" /home/runner/workspace/client/src --include="*.ts" --include="*.tsx" 2>/dev/null || true)
if [ -n "$PATTERN1" ]; then
  VIOLATIONS="$VIOLATIONS$PATTERN1"$'\n'
fi

# Pattern 2: Storing apiRequest result then calling .json() on it
# This is harder to detect statically, but we can catch common patterns
PATTERN2=$(grep -rn "= await apiRequest" /home/runner/workspace/client/src --include="*.ts" --include="*.tsx" 2>/dev/null | while read -r line; do
  FILE=$(echo "$line" | cut -d: -f1)
  LINENUM=$(echo "$line" | cut -d: -f2)

  # Check next 5 lines for .json() call on the variable
  VARNAME=$(echo "$line" | grep -oP '(?<=const |let |var )\w+(?= =)' || true)
  if [ -n "$VARNAME" ]; then
    # Look for patterns like "varname.json(" in nearby lines
    NEXT_LINES=$(sed -n "$((LINENUM+1)),$((LINENUM+5))p" "$FILE" 2>/dev/null || true)
    if echo "$NEXT_LINES" | grep -q "${VARNAME}\.json("; then
      echo "$FILE:$LINENUM: Possible double-parse - $VARNAME assigned from apiRequest, then .json() called"
    fi
  fi
done || true)

if [ -n "$PATTERN2" ]; then
  VIOLATIONS="$VIOLATIONS$PATTERN2"$'\n'
fi

# Pattern 3: await res.json() where res came from apiRequest (common mistake)
PATTERN3=$(grep -rn "res\.json()" /home/runner/workspace/client/src --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "// ok" || true)
# Filter to only suspicious cases (near apiRequest usage)
if [ -n "$PATTERN3" ]; then
  while IFS= read -r line; do
    FILE=$(echo "$line" | cut -d: -f1)
    LINENUM=$(echo "$line" | cut -d: -f2)

    # Check if apiRequest is used in the same function context (within 20 lines before)
    CONTEXT=$(sed -n "$((LINENUM > 20 ? LINENUM-20 : 1)),${LINENUM}p" "$FILE" 2>/dev/null || true)
    if echo "$CONTEXT" | grep -q "apiRequest"; then
      VIOLATIONS="$VIOLATIONS$line (apiRequest context detected)"$'\n'
    fi
  done <<< "$PATTERN3"
fi

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
exit 1
