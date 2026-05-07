/**
 * Service-address location-label resolver (2026-05-06 RALPH).
 *
 * The shared rule for the SERVICE ADDRESS block on Job Detail and
 * Invoice Detail: show a location-name label above the street/city
 * lines ONLY when the user actually entered a distinct location name.
 *
 * Returns the trimmed raw `location.location` value when it's a real
 * label that adds information beyond the customer name. Returns null
 * in every other case so callers can suppress the row entirely.
 *
 * Suppression rules:
 *   • `rawLocationName` is null / undefined / empty / whitespace-only.
 *   • `rawLocationName.trim().toLowerCase()` matches the trimmed
 *     lowercase customer name. Catches:
 *       1. New clients post the previous RALPH change have NULL
 *          `clients.location`, so the helper returns null and the row
 *          is hidden.
 *       2. Legacy clients have the customer name auto-copied into
 *          `clients.location`. The trim+lowercase compare suppresses
 *          that visual duplicate without a data migration.
 *
 * The helper deliberately uses ONLY the raw `clients.location` column
 * — NOT the canonical `locationDisplayName` / `locationDisplayNameExpr`
 * COALESCE, which falls back to the parent customer name and would
 * produce the duplicate the brief explicitly forbids.
 *
 * The helper is pure / no React deps so it's testable in isolation.
 */
export function resolveServiceLocationName(
  rawLocationName: string | null | undefined,
  customerName: string | null | undefined,
): string | null {
  const raw = (rawLocationName ?? "").trim();
  if (!raw) return null;
  const customer = (customerName ?? "").trim();
  if (customer && raw.toLowerCase() === customer.toLowerCase()) return null;
  return raw;
}
