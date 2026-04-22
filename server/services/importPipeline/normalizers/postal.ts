/**
 * Canonical postal / address normalizers for CSV imports.
 *
 * These are thin re-exports of the canonical helpers that already live
 * in `@shared/normalizeForMatch`. The import pipeline keeps a single
 * "normalizers/" namespace so adapters import everything from one place,
 * but the underlying implementations stay in `@shared/` where they are
 * used by non-import callers too (company dedup, contact dedup, etc).
 */

export {
  normalizeForMatch,
  normalizeBusinessName,
  normalizePostalForMatch,
  normalizeStreetAddress,
  buildAddressCompositeKey,
} from "@shared/normalizeForMatch";

/**
 * Light-touch postal formatter for display — not for matching. Preserves
 * the legacy `normalizePostalCode` behavior used by client import
 * (Canadian postal: "L4N6P1" → "L4N 6P1"; US ZIP: passthrough; others:
 * trimmed + uppercased).
 */
export function normalizePostalDisplay(val: string | null | undefined): string | null {
  if (!val) return null;
  const t = val.trim().toUpperCase();
  if (t === "") return null;
  // Canadian postal without space: 6 alnum letter-digit pairs → insert space.
  const canadian = /^([A-Z]\d[A-Z])(\d[A-Z]\d)$/.exec(t.replace(/\s+/g, ""));
  if (canadian) return `${canadian[1]} ${canadian[2]}`;
  // Otherwise return trimmed + uppercased as-is.
  return t.replace(/\s+/g, " ");
}
