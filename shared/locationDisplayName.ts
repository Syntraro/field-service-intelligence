/**
 * Canonical location display name resolver (client + server shared).
 *
 * 2026-04-16: location name is optional. This function mirrors the
 * SQL-level COALESCE in server/lib/queryHelpers.ts → locationDisplayNameExpr
 * so JS-side rendering (React components, PDF generators, notifications)
 * produces the same result as DB-level selects.
 *
 * Fallback hierarchy:
 *   1. location name (companyName on the client_locations row)
 *   2. parent company name
 *   3. full street address
 *   4. city + province/state
 *   5. "Unnamed Location"
 */

export interface LocationDisplayFields {
  /** The location's own name (clients.company_name / clients.location). */
  companyName?: string | null;
  location?: string | null;
  /** Parent customer-company name. */
  parentCompanyName?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
}

export function getLocationDisplayName(loc: LocationDisplayFields): string {
  const name = (loc.companyName ?? loc.location ?? "").trim();
  if (name) return name;

  const parent = (loc.parentCompanyName ?? "").trim();
  if (parent) return parent;

  const addr = (loc.address ?? "").trim();
  if (addr) return addr;

  const cityProvince = [loc.city?.trim(), loc.province?.trim()]
    .filter(Boolean)
    .join(", ");
  if (cityProvince) return cityProvince;

  return "Unnamed Location";
}
