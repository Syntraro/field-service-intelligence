/**
 * Canonical phone cell parsing for CSV imports.
 *
 * The legacy imports only trimmed phone cells (no canonicalization). To
 * preserve behavior-compatible round-tripping, this helper keeps the raw
 * display form (trimmed + internal-whitespace collapsed) as the stored
 * value, and exposes `normalizePhoneForMatch` for dedup keys.
 *
 * Actual format validation (e.g. E.164 conversion) is out of scope for
 * imports — dispatch/notification services own phone-number canonicalization
 * and run their own upgrades on existing data.
 */

import { stripNonDigits } from "@shared/normalizeForMatch";
import { collapseWhitespace } from "./text";

/** Display form: trimmed, internal whitespace collapsed, null when empty. */
export function normalizePhoneDisplay(val: string | null | undefined): string | null {
  return collapseWhitespace(val);
}

/**
 * Comparison key for deduplicating phones across imports. Strips all
 * non-digits and keeps the last 10 digits — collapses "(416) 555-1234"
 * and "+1-416-555-1234" to the same key. Empty string when no digits.
 */
export function normalizePhoneForMatch(val: string | null | undefined): string {
  const digits = stripNonDigits(val);
  if (digits.length === 0) return "";
  return digits.length > 10 ? digits.slice(-10) : digits;
}
