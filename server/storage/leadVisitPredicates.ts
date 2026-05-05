/**
 * Lead-visit single-source-of-truth predicates — sibling to
 * `visitPredicates.ts` (which stays JOB-VISIT-ONLY per CLAUDE.md
 * performance baseline).
 *
 * 2026-05-05: introduced alongside the lead_visits table. The job
 * visit predicates (`scheduleEligibleVisitFilter`,
 * `uncompletedVisitFilter`, `reconciliationActionableVisitFilter`)
 * MUST NOT be modified to fold lead visits in — they drive job
 * lifecycle and reconciliation, and changes there are explicitly
 * flagged as a review blocker. This module provides the lead-side
 * equivalents callers need without disturbing that contract.
 *
 * Predicates are pure SQL fragments. They expect the caller to
 * already have `lead_visits` in the FROM clause. They do NOT scope
 * by tenant on their own — tenant scoping is the caller's
 * responsibility (every storage helper that uses these passes
 * `eq(leadVisits.companyId, companyId)` separately).
 */

import { sql, type SQL } from "drizzle-orm";
import { leadVisits } from "@shared/schema";

/**
 * Lead visits that count as "actively scheduled" — i.e. the visit
 * has a real time slot and is not in a terminal state.
 *
 * Used by:
 *   - dispatch calendar feed (lead-visit branch)
 *   - capacity / availability blocking computation
 *   - tech "today" feed
 *
 * Conditions:
 *   - is_active = true
 *   - archived_at IS NULL
 *   - scheduled_start IS NOT NULL
 *   - status NOT IN ('completed', 'cancelled')
 */
export function scheduleEligibleLeadVisitFilter(): SQL {
  return sql`(
    ${leadVisits.isActive} = true
    AND ${leadVisits.archivedAt} IS NULL
    AND ${leadVisits.scheduledStart} IS NOT NULL
    AND ${leadVisits.status} NOT IN ('completed', 'cancelled')
  )`;
}

/**
 * Lead visits that are NOT yet in a terminal state — regardless of
 * whether they have a scheduled slot. Used by
 * `isLastOpenVisitForLead` to decide whether to flip the lead to
 * `needs_review` when one visit completes.
 *
 * Conditions:
 *   - is_active = true
 *   - archived_at IS NULL
 *   - status NOT IN ('completed', 'cancelled')
 */
export function uncompletedLeadVisitFilter(): SQL {
  return sql`(
    ${leadVisits.isActive} = true
    AND ${leadVisits.archivedAt} IS NULL
    AND ${leadVisits.status} NOT IN ('completed', 'cancelled')
  )`;
}
