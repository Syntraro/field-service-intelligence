/**
 * Canonical visit-assignment guards.
 *
 * Single source of truth for "is this technician assigned to this visit?"
 * checks across routes, services, and storage. All callers should use these
 * helpers instead of repeating ad-hoc `assignedTechnicianIds.includes(userId)`
 * logic.
 *
 * Canonical model (2026-04-12):
 *   - `job_visits.assigned_technician_ids: varchar[]` is the sole crew column.
 *   - No lead / primary technician. No scalar ownership column.
 *   - Actor attribution (who did the work) is SEPARATE from crew eligibility
 *     (who is allowed to act). Do not use these helpers for actor identity.
 */

import { and, eq, type SQL, sql } from "drizzle-orm";
import { db } from "../db";
import { jobVisits } from "../../shared/schema";
import { createError } from "../middleware/errorHandler";
import { jobVisitsRepository } from "../storage/jobVisits";

type VisitLike = {
  assignedTechnicianIds?: string[] | null;
};

/** Pure predicate: is `userId` in the visit's crew? */
export function isTechnicianAssignedToVisit(
  userId: string,
  visit: VisitLike | null | undefined,
): boolean {
  if (!visit) return false;
  const crew = visit.assignedTechnicianIds;
  return Array.isArray(crew) && crew.includes(userId);
}

/**
 * Load a visit and assert the technician is on its crew.
 * Throws 404 if missing or unassigned (deliberately same status to avoid
 * leaking existence of visits the user cannot see).
 */
export async function assertTechnicianAssignedToVisit(
  companyId: string,
  userId: string,
  visitId: string,
) {
  const visit = await jobVisitsRepository.getJobVisit(companyId, visitId);
  if (!visit || !isTechnicianAssignedToVisit(userId, visit)) {
    throw createError(404, "Visit not found or not assigned to you");
  }
  return visit;
}

/** SQL fragment: `userId` is in the visit's crew array. For use in WHERE clauses. */
export function technicianAssignedToVisitFilter(userId: string): SQL {
  return sql`${userId} = ANY(${jobVisits.assignedTechnicianIds})`;
}

/**
 * Assert the technician is on the crew of at least one active, non-archived
 * visit on this job. Throws 403 if not.
 */
export async function assertTechnicianHasVisitOnJob(
  companyId: string,
  userId: string,
  jobId: string,
): Promise<void> {
  const rows = await db
    .select({ assignedTechnicianIds: jobVisits.assignedTechnicianIds })
    .from(jobVisits)
    .where(
      and(
        eq(jobVisits.companyId, companyId),
        eq(jobVisits.jobId, jobId),
        eq(jobVisits.isActive, true),
      ),
    );

  const assigned = rows.some((v) => isTechnicianAssignedToVisit(userId, v));
  if (!assigned) throw createError(403, "Not assigned to this job");
}
