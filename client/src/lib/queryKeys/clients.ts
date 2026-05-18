/**
 * Canonical query key definitions for client / location / company queries.
 *
 * All client keys use Pattern A (URL-string). There are two distinct URL
 * prefixes depending on entity scope:
 *   - ["/api/clients", ...] — location-scoped data
 *   - ["/api/customer-companies", ...] — company-scoped data
 *
 * Contacts exist under BOTH prefixes depending on where they are queried;
 * mutations that affect shared contacts must invalidate both.
 */

export const clientKeys = {
  // ── Location-scoped keys ──

  /** ["/api/clients"] — location list family prefix */
  allLocations: () => ["/api/clients"] as const,

  /** ["/api/clients", locationId] — single location record */
  location: (locationId: string) => ["/api/clients", locationId] as const,

  /** ["/api/clients", locationId, "overview"] — location overview panel */
  locationOverview: (locationId: string) =>
    ["/api/clients", locationId, "overview"] as const,

  /** ["/api/clients", locationId, "equipment"] — active equipment list */
  locationEquipment: (locationId: string) =>
    ["/api/clients", locationId, "equipment"] as const,

  /** ["/api/clients", locationId, "equipment", "archived"] — archived equipment */
  locationEquipmentArchived: (locationId: string) =>
    ["/api/clients", locationId, "equipment", "archived"] as const,

  /** ["/api/clients", locationId, "contacts"] — location-scoped contacts */
  locationContacts: (locationId: string) =>
    ["/api/clients", locationId, "contacts"] as const,

  // ── Company-scoped keys ──

  /** ["/api/customer-companies", companyId, "overview"] — company overview panel */
  companyOverview: (companyId: string) =>
    ["/api/customer-companies", companyId, "overview"] as const,

  /** ["/api/customer-companies", companyId, "contacts"] — company-scoped contacts */
  companyContacts: (companyId: string) =>
    ["/api/customer-companies", companyId, "contacts"] as const,

  /** ["/api/customer-companies", companyId, "tags"] — company tags */
  companyTags: (companyId: string) =>
    ["/api/customer-companies", companyId, "tags"] as const,

  /** ["/api/customer-companies", companyId, "locations"] — location list under company */
  companyLocations: (companyId: string) =>
    ["/api/customer-companies", companyId, "locations"] as const,

  // ── Location non-client-prefixed keys ──

  /** ["/api/locations", locationId, "pm-parts"] — PM parts list for location */
  locationPmParts: (locationId: string) =>
    ["/api/locations", locationId, "pm-parts"] as const,

  /** ["/api/locations", locationId, "tags"] — location tags */
  locationTags: (locationId: string) =>
    ["/api/locations", locationId, "tags"] as const,
};
