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
 * - 2026-04-09: activeInvoiceFilter() REMOVED — invoices use permanent-delete
 *   model. The is_active and deleted_at columns are dropped. See
 *   migrations/2026_04_09_invoice_permanent_delete.sql.
 */

import { eq, inArray, sql } from "drizzle-orm";
import { users, technicianProfiles, customerCompanies, clientLocations, jobs } from "@shared/schema";
import { resolveTechnicianName } from "./resolveTechnicianName";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";

// ---------------------------------------------------------------------------
// Location Display Name
// ---------------------------------------------------------------------------

/**
 * Standard COALESCE expression for location display name. SINGLE
 * CANONICAL OWNER for "what name should the UI render for a location?".
 * All Drizzle-mode consumers MUST use this expression. Pure-SQL
 * (`pool.query`) call sites that cannot import the Drizzle fragment
 * MUST mirror the same priority order inline.
 *
 * 2026-05-01 (Option A — deprecated-override semantics): the parent
 * customer company's `name` is now FIRST in the chain. The previous
 * 2026-04-10 ordering treated `client_locations.company_name` as a
 * per-location override that always won, but in practice every create
 * flow eagerly denormalized the parent's name into the child column,
 * so the "override" was synonymous with "stale copy". A rename of
 * `customer_companies.name` would not propagate to display surfaces
 * that consulted this expression. Flipping to parent-first lets
 * renames propagate immediately while still falling through to the
 * child column for STANDALONE locations (no `parent_company_id`,
 * hence `cc.name IS NULL`). Intentional per-location display overrides
 * are not supported under this contract; if that semantic is needed
 * in future, add an explicit override-flag column rather than
 * reinterpreting `company_name`.
 *
 * Resolution order:
 *   1. parent customerCompany name             (rename-aware)
 *   2. location's own companyName              (standalone fallback)
 *   3. location's full street address          (legacy unnamed)
 *   4. location's city + province/state        (legacy unnamed)
 *   5. 'Unnamed Location'                       (ultimate fallback)
 *
 * Usage in a Drizzle .select():
 *   .select({ locationDisplayName: locationDisplayNameExpr })
 *
 * Requires LEFT JOINs on clientLocations and customerCompanies.
 */
export const locationDisplayNameExpr = sql<string>`COALESCE(
  NULLIF(${customerCompanies.name}, ''),
  NULLIF(${clientLocations.companyName}, ''),
  NULLIF(${clientLocations.address}, ''),
  NULLIF(CONCAT_WS(', ', NULLIF(${clientLocations.city}, ''), NULLIF(${clientLocations.province}, '')), ''),
  'Unnamed Location'
)`;

// ---------------------------------------------------------------------------
// Effective End SQL Expression
// ---------------------------------------------------------------------------

/**
 * Canonical SQL expression for job effective end time.
 * Priority: scheduledEnd → scheduledStart + durationMinutes → scheduledStart.
 *
 * SCOPE: This expression operates on jobs-table columns only.
 * JS getEffectiveEnd() in shared/schema.ts may be used with broader entity shapes
 * (e.g., jobVisits) that include estimatedDurationMinutes. Do NOT expand this SQL
 * expression to reference fields that do not exist on the jobs table unless the
 * underlying jobs schema actually adds them.
 *
 * ZERO-DURATION: SQL treats durationMinutes = 0 as IS NOT NULL → computes
 * start + 0 minutes = start. JS uses nullish check (!= null) so 0 is also
 * treated as present. Both reach the same result through the same branch.
 *
 * 2026-03-18: Centralized from 3 duplicate definitions (dashboard.ts,
 * attentionRules.ts, jobsFeed.ts). SQL mirror of getEffectiveEnd() in shared/schema.ts.
 * Both must be kept in sync — any priority change must be applied to both.
 * SYNC: tests/effective-end-sync.test.ts enforces parity for job-scoped fields only.
 *
 * Usage: `sql`${effectiveEndExpr} < NOW()`` for overdue detection.
 */
export const effectiveEndExpr = sql`CASE
  WHEN ${jobs.scheduledEnd} IS NOT NULL THEN ${jobs.scheduledEnd}
  WHEN ${jobs.durationMinutes} IS NOT NULL
    THEN ${jobs.scheduledStart} + (${jobs.durationMinutes} || ' minutes')::interval
  ELSE ${jobs.scheduledStart}
END`;

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
    map.set(row.id, row.name ?? "");
  }
  return map;
}
