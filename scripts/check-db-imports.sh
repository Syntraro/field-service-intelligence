#!/bin/bash
# ============================================================================
# DB Import Guard - Prevents direct database access outside storage layer
# ============================================================================
#
# This script checks for direct imports of `db` outside the storage directory.
# Run as part of CI or pre-commit hook to catch violations early.
#
# Exit codes:
#   0 - No violations found
#   1 - Violations found (direct db imports outside storage)
#
# Usage:
#   ./scripts/check-db-imports.sh
#   npm run lint:db-imports
#
# ============================================================================

set -e

echo "Checking for direct database imports outside storage layer..."

# Remaining files that are known exceptions (tracked for future refactoring)
# These files access external schemas (Stripe) and are low priority
KNOWN_EXCEPTIONS=(
  "server/stripe/stripeService.ts"
  "server/stripe/webhookHandlers.ts"
)

# Find violations - exclude storage directory, legacy, migrations, and backups
VIOLATIONS=$(grep -r "from.*['\"]\.\.*/db" /home/runner/workspace/server --include="*.ts" 2>/dev/null \
  | grep -v "/storage/" \
  | grep -v "/_legacy/" \
  | grep -v "migrate-to-multi-tenant" \
  | grep -v "\.backup" \
  | grep -v "storage\.ts:" \
  || true)

if [ -z "$VIOLATIONS" ]; then
  echo "No direct db imports found outside storage layer."
  exit 0
fi

# Check if violations are all in known exceptions
UNEXPECTED_VIOLATIONS=""
while IFS= read -r line; do
  if [ -z "$line" ]; then
    continue
  fi

  FILE_PATH=$(echo "$line" | cut -d: -f1)
  IS_KNOWN=false

  for exception in "${KNOWN_EXCEPTIONS[@]}"; do
    if [[ "$FILE_PATH" == *"$exception"* ]]; then
      IS_KNOWN=true
      break
    fi
  done

  if [ "$IS_KNOWN" = false ]; then
    UNEXPECTED_VIOLATIONS="$UNEXPECTED_VIOLATIONS$line"$'\n'
  fi
done <<< "$VIOLATIONS"

if [ -n "$UNEXPECTED_VIOLATIONS" ]; then
  echo ""
  echo "ERROR: Found NEW direct database imports outside storage layer!"
  echo "========================================================================"
  echo "$UNEXPECTED_VIOLATIONS"
  echo "========================================================================"
  echo ""
  echo "To fix this:"
  echo "1. Move database queries to an appropriate storage repository"
  echo "2. Import and use the repository from your service/route"
  echo ""
  echo "Storage layer location: server/storage/"
  echo "See DB_ACCESS_INVENTORY.md for more details"
  exit 1
fi

# All violations are known exceptions
echo ""
echo "Found ${#KNOWN_EXCEPTIONS[@]} known exceptions (being tracked for future refactoring):"
for exception in "${KNOWN_EXCEPTIONS[@]}"; do
  echo "  - $exception"
done
echo ""
echo "No NEW violations found. Build passed."
exit 0
