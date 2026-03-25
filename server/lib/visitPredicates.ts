/**
 * Canonical Visit Predicate Definitions
 *
 * SINGLE SOURCE OF TRUTH for visit eligibility / actionability predicates.
 * All consumers must import from this module instead of defining predicates inline.
 *
 * Three distinct business concepts are defined here:
 *
 * 1. SCHEDULE-ELIGIBLE: Visits that can sync to job scheduling fields.
 *    Requires scheduledStart — unscheduled placeholders are excluded.
 *
 * 2. RECONCILIATION-ACTIONABLE: Visits that represent real pending work
 *    and should block job auto-close. Includes visits that were never
 *    scheduled but have activity (checkedInAt).
 *
 * 3. UNCOMPLETED: All non-terminal visits regardless of scheduling state.
 *    Used by force-close / bulk-complete logic.
 *
 * These are intentionally distinct predicates. Do NOT collapse them.
 *
 * 2026-03-18: Created to eliminate proven predicate drift across
 * jobVisits.ts, jobLifecycleOrchestrator.ts, and visitIntelligence.ts.
 */

import { and, eq, isNull, isNotNull, notInArray, or, type SQL } from "drizzle-orm";
import { jobVisits } from "@shared/schema";

// ============================================================================
// Constants
// ============================================================================

/**
 * Visit statuses that represent terminal/completed states.
 * Visits in these statuses are excluded from all eligibility predicates.
 */
export const TERMINAL_VISIT_STATUSES: string[] = ["completed", "cancelled"];

/**
 * Raw SQL fragment for use in hand-written queries.
 * Derived from TERMINAL_VISIT_STATUSES to prevent drift.
 * Usage: `AND ${VISIT_NOT_TERMINAL_SQL("jv")}` in template literals.
 */
export const VISIT_TERMINAL_STATUS_SQL = TERMINAL_VISIT_STATUSES.map(s => `'${s}'`).join(", ");

// ============================================================================
// Base Guards
// ============================================================================

/**
 * Active visit guard — composable base condition for visit queries.
 *
 * Semantics: visit is not deactivated (isActive=true) and not archived.
 * Does NOT filter by status — allows terminal visits (completed, cancelled).
 * Does NOT scope by companyId or jobId — callers add those.
 *
 * Used by: list queries, single-visit lookups, write guards, calendar views.
 * The broader schedule/reconciliation/uncompleted predicates below compose
 * this same pair internally with additional conditions.
 */
export function activeVisitGuard(): SQL {
  return and(eq(jobVisits.isActive, true), isNull(jobVisits.archivedAt))!;
}

// ============================================================================
// Predicate Builders
// ============================================================================

/**
 * Schedule-eligible visit filter.
 *
 * Business meaning: visits that can be mirrored onto job scheduling fields
 * (scheduledStart, scheduledEnd, etc.) and represent scheduled calendar work.
 *
 * Requires:
 * - isActive = true
 * - archivedAt IS NULL
 * - status NOT IN (completed, cancelled)
 * - scheduledStart IS NOT NULL
 *
 * Used by:
 * - getCurrentEligibleVisit()
 * - syncJobScheduleFromVisits()
 * - visitIntelligence fetchScheduledVisits() (composed with date bounds)
 */
export function scheduleEligibleVisitFilter(
  companyId: string,
  jobId: string
): SQL {
  return and(
    eq(jobVisits.companyId, companyId),
    eq(jobVisits.jobId, jobId),
    eq(jobVisits.isActive, true),
    isNull(jobVisits.archivedAt),
    isNotNull(jobVisits.scheduledStart),
    notInArray(jobVisits.status, TERMINAL_VISIT_STATUSES)
  )!;
}

/**
 * Reconciliation-actionable visit filter.
 *
 * Business meaning: visits that represent real pending work and should
 * block job auto-close during visit completion reconciliation.
 *
 * Differs from schedule-eligible by also including visits that were
 * never scheduled but have activity (checkedInAt IS NOT NULL). This
 * prevents checked-in-but-unscheduled visits from being silently ignored
 * during reconciliation.
 *
 * Requires:
 * - isActive = true
 * - archivedAt IS NULL
 * - status NOT IN (completed, cancelled)
 * - (scheduledStart IS NOT NULL OR checkedInAt IS NOT NULL)
 *
 * Used by:
 * - reconcileJobAfterVisitCompletion()
 */
export function reconciliationActionableVisitFilter(
  companyId: string,
  jobId: string
): SQL {
  return and(
    eq(jobVisits.companyId, companyId),
    eq(jobVisits.jobId, jobId),
    eq(jobVisits.isActive, true),
    isNull(jobVisits.archivedAt),
    notInArray(jobVisits.status, TERMINAL_VISIT_STATUSES),
    or(isNotNull(jobVisits.scheduledStart), isNotNull(jobVisits.checkedInAt))
  )!;
}

/**
 * Uncompleted visit filter.
 *
 * Business meaning: all non-terminal visits regardless of scheduling state.
 * Used when all remaining work must be accounted for (e.g., force-close
 * needs to auto-complete every pending visit, not just scheduled ones).
 *
 * Requires:
 * - isActive = true
 * - archivedAt IS NULL
 * - status NOT IN (completed, cancelled)
 *
 * Used by:
 * - getUncompletedVisits()
 * - bulkCompleteVisitsInternal()
 */
export function uncompletedVisitFilter(
  companyId: string,
  jobId: string
): SQL {
  return and(
    eq(jobVisits.companyId, companyId),
    eq(jobVisits.jobId, jobId),
    eq(jobVisits.isActive, true),
    isNull(jobVisits.archivedAt),
    notInArray(jobVisits.status, TERMINAL_VISIT_STATUSES)
  )!;
}
