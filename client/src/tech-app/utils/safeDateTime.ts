/**
 * Safe datetime normalization for the technician app.
 *
 * Single canonical utility for converting raw ISO datetime strings into
 * validated numeric values. Used by the Today page timeline to prevent
 * NaN sort keys from malformed or missing backend data.
 *
 * 2026-04-10: Created as part of timeline datetime hardening.
 */

/** Accepted raw datetime input — string (ISO), Date object, null, or undefined. */
type DateTimeInput = string | Date | null | undefined;

/**
 * Convert a raw datetime to epoch milliseconds.
 * Returns `null` for null, undefined, empty string, or any value that
 * produces an invalid Date. Never returns NaN.
 */
export function toEpochMsSafe(raw: DateTimeInput): number | null {
  if (raw == null) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const ms = (raw instanceof Date ? raw : new Date(raw)).getTime();
  if (Number.isNaN(ms)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[safeDateTime] Invalid datetime value:", raw);
    }
    return null;
  }
  return ms;
}

/**
 * Convert a raw datetime to a local YYYY-MM-DD date key.
 * Returns `null` for invalid/missing values. Uses the same `Date`
 * constructor as `toEpochMsSafe` so timezone handling is consistent.
 */
export function toLocalDateKey(raw: DateTimeInput): string | null {
  if (raw == null) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[safeDateTime] Invalid datetime for date key:", raw);
    }
    return null;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
