/**
 * Shared Query Helpers — Phase 5 Part C
 *
 * Building blocks for canonical query modules and calendar.
 * Each module composes these as needed without coupling to each other.
 *
 * - locationDisplayNameExpr: COALESCE for location name resolution
 * - bulkResolveTechnicians: batch user+profile lookup → Map<id, {name, color}>
 * - bulkResolveCustomerCompanies: batch company name lookup → Map<id, name>
 *
 * Active filters live in their canonical modules:
 * - activeJobFilter() → server/storage/jobFilters.ts
 * - activeInvoiceFilter() → server/storage/invoicesFeed.ts
 */

import { eq, inArray, sql } from "drizzle-orm";
import { users, technicianProfiles, customerCompanies, clientLocations } from "@shared/schema";
import { resolveTechnicianName } from "./resolveTechnicianName";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";

// ---------------------------------------------------------------------------
// Location Display Name
// ---------------------------------------------------------------------------

/**
 * Standard COALESCE expression for location display name.
 * Returns the customerCompany name if linked, otherwise the clientLocation companyName.
 *
 * Usage in a Drizzle .select():
 *   .select({ locationDisplayName: locationDisplayNameExpr })
 *
 * Requires LEFT JOINs on clientLocations and customerCompanies.
 */
export const locationDisplayNameExpr = sql<string>`COALESCE(${customerCompanies.name}, ${clientLocations.companyName})`;

// ---------------------------------------------------------------------------
// Bulk Technician Resolution
// ---------------------------------------------------------------------------

export interface TechnicianInfo {
  id: string;
  name: string;
  color: string | null;
}

/**
 * Bulk-resolve technician display info for a set of user IDs.
 * Returns a Map<userId, TechnicianInfo> for O(1) lookups.
 *
 * Uses the canonical resolveTechnicianName() fallback chain.
 * Queries users LEFT JOIN technicianProfiles in a single round-trip.
 */
export async function bulkResolveTechnicians(
  db: NeonDatabase<any>,
  userIds: string[]
): Promise<Map<string, TechnicianInfo>> {
  const map = new Map<string, TechnicianInfo>();
  if (userIds.length === 0) return map;

  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      fullName: users.fullName,
      color: technicianProfiles.color,
    })
    .from(users)
    .leftJoin(technicianProfiles, eq(users.id, technicianProfiles.userId))
    .where(inArray(users.id, userIds));

  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      name: resolveTechnicianName(row),
      color: row.color,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Bulk Customer Company Resolution
// ---------------------------------------------------------------------------

/**
 * Bulk-resolve customer company names for a set of company IDs.
 * Returns a Map<companyId, name> for O(1) lookups.
 *
 * Used by calendar (which fetches companies in a separate query
 * rather than joining in the main CTE).
 */
export async function bulkResolveCustomerCompanies(
  db: NeonDatabase<any>,
  companyIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (companyIds.length === 0) return map;

  const rows = await db
    .select({
      id: customerCompanies.id,
      name: customerCompanies.name,
    })
    .from(customerCompanies)
    .where(inArray(customerCompanies.id, companyIds));

  for (const row of rows) {
    map.set(row.id, row.name);
  }
  return map;
}
