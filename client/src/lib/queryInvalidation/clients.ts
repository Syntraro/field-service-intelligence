/**
 * Canonical invalidation helpers for client / location / company mutations.
 *
 * Client data lives under two separate URL prefixes:
 *   - ["/api/clients", locationId, ...] — location-scoped queries
 *   - ["/api/customer-companies", companyId, ...] — company-scoped queries
 *
 * Most location mutations need to invalidate BOTH the location-scoped
 * and the company-scoped overview to keep the two panels in sync.
 * Contacts are queried under both prefixes depending on the view; use
 * invalidateClientContacts() which busts both.
 */
import type { QueryClient } from "@tanstack/react-query";
import { clientKeys } from "@/lib/queryKeys/clients";

/**
 * Bust all location-scoped and company overview data.
 * Use after any mutation that changes core location fields (name, address,
 * status, or anything that rolls up into the company overview).
 */
export function invalidateClientLocation(
  qc: QueryClient,
  locationId: string,
  companyId?: string,
): void {
  qc.invalidateQueries({ queryKey: clientKeys.allLocations() });
  qc.invalidateQueries({ queryKey: clientKeys.locationOverview(locationId) });
  if (companyId) {
    qc.invalidateQueries({ queryKey: clientKeys.companyOverview(companyId) });
  }
}

/**
 * Bust contact lists for both location-scoped and company-scoped views.
 * Use after create/edit/delete of any contact that may appear in either view.
 */
export function invalidateClientContacts(
  qc: QueryClient,
  locationId: string,
  companyId: string,
): void {
  qc.invalidateQueries({ queryKey: clientKeys.locationContacts(locationId) });
  qc.invalidateQueries({ queryKey: clientKeys.companyContacts(companyId) });
}

/**
 * Bust equipment lists (active + archived) for a location.
 * Use after equipment add, delete, or archive.
 */
export function invalidateLocationEquipment(
  qc: QueryClient,
  locationId: string,
): void {
  qc.invalidateQueries({ queryKey: clientKeys.locationEquipment(locationId) });
  qc.invalidateQueries({
    queryKey: clientKeys.locationEquipmentArchived(locationId),
  });
}
