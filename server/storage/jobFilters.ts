/**
 * Canonical job filters for Drizzle ORM and raw SQL.
 *
 * activeJobFilter():
 *   deleted_at IS NULL  AND  is_active = true
 *   Excludes soft-deleted and deactivated jobs from all queries.
 *
 * activeWorkJobFilter():
 *   deleted_at IS NULL  AND  is_active = true  AND  status = 'open'
 *   "Active Work" whitelist: all open jobs regardless of scheduling.
 *   Excludes completed, invoiced, and archived jobs.
 *
 * Use these helpers everywhere instead of sprinkling conditions manually.
 */

import { isNull, eq, and, type SQL } from "drizzle-orm";
import { jobs, clientLocations as clients, customerCompanies } from "@shared/schema";

/**
 * Drizzle ORM filter: returns a composable SQL fragment requiring
 * jobs.deletedAt IS NULL AND jobs.isActive = true.
 *
 * Usage:  .where(and(eq(jobs.companyId, cid), activeJobFilter()))
 */
export function activeJobFilter(): SQL {
  return and(isNull(jobs.deletedAt), eq(jobs.isActive, true))!;
}

/**
 * Drizzle ORM filter for "Active Work" — open jobs only.
 * Combines activeJobFilter() with status = 'open'.
 * No scheduledStart requirement: backlog and PM jobs are included.
 *
 * Usage:  .where(and(eq(jobs.companyId, cid), activeWorkJobFilter()))
 */
export function activeWorkJobFilter(): SQL {
  return and(
    isNull(jobs.deletedAt),
    eq(jobs.isActive, true),
    eq(jobs.status, "open"),
  )!;
}

/**
 * Raw SQL fragment for use in hand-written queries.
 * Assumes the jobs table is aliased as `j`.
 *
 * Usage:  `WHERE j.company_id = $1 AND ${JOB_ACTIVE_SQL_J}`
 */
export const JOB_ACTIVE_SQL_J = "j.deleted_at IS NULL AND j.is_active = true";

/**
 * Raw SQL fragment using full table name (no alias).
 *
 * Usage:  `WHERE jobs.company_id = $1 AND ${JOB_ACTIVE_SQL}`
 */
export const JOB_ACTIVE_SQL = "jobs.deleted_at IS NULL AND jobs.is_active = true";

/**
 * Raw SQL "Active Work" filter (alias `j`).
 * Active Work = non-deleted, active, status='open'.
 *
 * Usage:  `WHERE j.company_id = $1 AND ${JOB_ACTIVE_WORK_SQL_J}`
 */
export const JOB_ACTIVE_WORK_SQL_J =
  "j.deleted_at IS NULL AND j.is_active = true AND j.status = 'open'";

/**
 * Raw SQL "Active Work" filter (full table name).
 *
 * Usage:  `WHERE jobs.company_id = $1 AND ${JOB_ACTIVE_WORK_SQL}`
 */
export const JOB_ACTIVE_WORK_SQL =
  "jobs.deleted_at IS NULL AND jobs.is_active = true AND jobs.status = 'open'";

// ============================================================================
// Client Location (clientLocations) Filters
// ============================================================================

/**
 * Not-deleted client location filter.
 * Semantics: clientLocations.deletedAt IS NULL.
 * Does NOT check `inactive` — that is a separate business concept.
 */
export function notDeletedClientFilter(): SQL {
  return isNull(clients.deletedAt)!;
}

// ============================================================================
// Customer Company Filters
// ============================================================================

/**
 * Not-deleted customer company filter.
 * Semantics: customerCompanies.deletedAt IS NULL.
 * Does NOT check isActive — only one listing query combines both.
 */
export function notDeletedCustomerCompanyFilter(): SQL {
  return isNull(customerCompanies.deletedAt)!;
}
