/**
 * Lead-visit storage repository — sibling to `jobVisits.ts`.
 *
 * 2026-05-05: introduced alongside the lead_visits table. Mirrors
 * the job-visit storage shape where it makes sense (createLeadVisit /
 * updateLeadVisit normalize through `normalizeVisitSchedule`, the
 * canonical scheduling integrity guard) but stays a separate module
 * — lead visits never feed job predicates, job feeds, job reports,
 * or job KPIs.
 *
 * Scoping: every method requires `companyId` as the first argument;
 * cross-tenant access is structurally impossible.
 *
 * Status transition: `markLeadVisitCompleted` runs the visit-status
 * write AND the optional `lead.status -> needs_review` transition
 * inside one atomic transaction. The trigger condition is "no
 * remaining uncompleted visits on the parent lead" — see
 * `isLastOpenVisitForLead`.
 */

import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  leadVisits,
  leads,
  type LeadVisit,
  type InsertLeadVisit,
  type UpdateLeadVisit,
} from "@shared/schema";
import {
  normalizeVisitSchedule,
  type VisitScheduleInput,
} from "../domain/scheduling";
import {
  scheduleEligibleLeadVisitFilter,
  uncompletedLeadVisitFilter,
} from "./leadVisitPredicates";

// ─── Types ──────────────────────────────────────────────────────────

export interface CreateLeadVisitInput {
  leadId: string;
  scheduledStart?: Date | string | null;
  scheduledEnd?: Date | string | null;
  estimatedDurationMinutes?: number | null;
  isAllDay?: boolean | null;
  assignedTechnicianIds?: string[] | null;
  status?: "scheduled" | "in_progress" | "completed" | "cancelled";
  visitNotes?: string | null;
  createdByUserId: string;
}

export interface UpdateLeadVisitInput {
  scheduledStart?: Date | string | null;
  scheduledEnd?: Date | string | null;
  estimatedDurationMinutes?: number | null;
  isAllDay?: boolean | null;
  assignedTechnicianIds?: string[] | null;
  status?: "scheduled" | "in_progress" | "completed" | "cancelled";
  visitNotes?: string | null;
  outcomeNote?: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Run `normalizeVisitSchedule` against the create/update input and
 * return the canonical write triple. Same call shape job_visits uses,
 * so behavior stays in lockstep with `domain/scheduling.ts`.
 */
function normalizeForWrite(input: VisitScheduleInput) {
  return normalizeVisitSchedule({
    scheduledStart: input.scheduledStart ?? null,
    scheduledEnd: input.scheduledEnd ?? null,
    durationMinutes: input.durationMinutes ?? null,
    isAllDay: input.isAllDay ?? false,
  });
}

// ─── CRUD ──────────────────────────────────────────────────────────

/**
 * Create a lead visit. The schedule fields run through
 * `normalizeVisitSchedule` so the row never holds an illegal state
 * (see `domain/scheduling.ts` rules).
 */
export async function createLeadVisit(
  companyId: string,
  input: CreateLeadVisitInput,
): Promise<LeadVisit> {
  const normalized = normalizeForWrite({
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
    durationMinutes: input.estimatedDurationMinutes,
    isAllDay: input.isAllDay ?? undefined,
  });

  const rows = await db
    .insert(leadVisits)
    .values({
      companyId,
      leadId: input.leadId,
      scheduledStart: normalized.scheduledStart,
      scheduledEnd: normalized.scheduledEnd,
      isAllDay: normalized.isAllDay,
      estimatedDurationMinutes: normalized.durationMinutes,
      assignedTechnicianIds: input.assignedTechnicianIds ?? null,
      status: input.status ?? "scheduled",
      visitNotes: input.visitNotes ?? null,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  return rows[0];
}

/**
 * Update a lead visit. Schedule fields run through normalization
 * if any of them are present in the patch. Status edits to
 * "completed" should go through `markLeadVisitCompleted` instead so
 * the lead-status side effect runs atomically; this generic update
 * path does NOT trigger the side effect on its own.
 */
export async function updateLeadVisit(
  companyId: string,
  visitId: string,
  input: UpdateLeadVisitInput,
): Promise<LeadVisit | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  // Schedule normalization runs only when the caller is changing any
  // schedule field; otherwise we'd nullify the start on every status
  // edit.
  const touchesSchedule =
    "scheduledStart" in input ||
    "scheduledEnd" in input ||
    "estimatedDurationMinutes" in input ||
    "isAllDay" in input;

  if (touchesSchedule) {
    // Read the current row so we can pass through fields the patch
    // didn't touch.
    const [current] = await db
      .select()
      .from(leadVisits)
      .where(and(eq(leadVisits.id, visitId), eq(leadVisits.companyId, companyId)))
      .limit(1);
    if (!current) return null;

    const normalized = normalizeForWrite({
      scheduledStart:
        "scheduledStart" in input ? input.scheduledStart : current.scheduledStart,
      scheduledEnd:
        "scheduledEnd" in input ? input.scheduledEnd : current.scheduledEnd,
      durationMinutes:
        "estimatedDurationMinutes" in input
          ? input.estimatedDurationMinutes
          : current.estimatedDurationMinutes,
      isAllDay:
        "isAllDay" in input ? (input.isAllDay ?? false) : current.isAllDay,
    });
    patch.scheduledStart = normalized.scheduledStart;
    patch.scheduledEnd = normalized.scheduledEnd;
    patch.isAllDay = normalized.isAllDay;
    patch.estimatedDurationMinutes = normalized.durationMinutes;
  }

  if ("assignedTechnicianIds" in input) {
    patch.assignedTechnicianIds = input.assignedTechnicianIds ?? null;
  }
  if ("status" in input && input.status) patch.status = input.status;
  if ("visitNotes" in input) patch.visitNotes = input.visitNotes ?? null;
  if ("outcomeNote" in input) patch.outcomeNote = input.outcomeNote ?? null;

  const rows = await db
    .update(leadVisits)
    .set(patch)
    .where(and(eq(leadVisits.id, visitId), eq(leadVisits.companyId, companyId)))
    .returning();
  return rows[0] ?? null;
}

/** Fetch a single lead visit (tenant-scoped). */
export async function getLeadVisit(
  companyId: string,
  visitId: string,
): Promise<LeadVisit | null> {
  const rows = await db
    .select()
    .from(leadVisits)
    .where(and(eq(leadVisits.id, visitId), eq(leadVisits.companyId, companyId)))
    .limit(1);
  return rows[0] ?? null;
}

/** All visits on a lead, newest first. Excludes hard-archived rows. */
export async function listLeadVisitsForLead(
  companyId: string,
  leadId: string,
): Promise<LeadVisit[]> {
  return await db
    .select()
    .from(leadVisits)
    .where(
      and(
        eq(leadVisits.companyId, companyId),
        eq(leadVisits.leadId, leadId),
        eq(leadVisits.isActive, true),
      ),
    )
    .orderBy(desc(leadVisits.scheduledStart), desc(leadVisits.createdAt));
}

/**
 * All scheduled lead visits in a date range for the tenant. Used by
 * the dispatch calendar feed and the capacity-blocking computation.
 * Returns lightweight rows; consumers JOIN further as needed.
 */
export async function listLeadVisitsInRange(
  companyId: string,
  start: Date,
  end: Date,
): Promise<LeadVisit[]> {
  return await db
    .select()
    .from(leadVisits)
    .where(
      and(
        eq(leadVisits.companyId, companyId),
        scheduleEligibleLeadVisitFilter(),
        gte(leadVisits.scheduledStart, start),
        lte(leadVisits.scheduledStart, end),
      ),
    )
    .orderBy(asc(leadVisits.scheduledStart));
}

/**
 * Lead visits assigned to a specific user in a date range. Powers
 * the tech-app `/api/tech/lead-visits/today` endpoint.
 */
export async function listLeadVisitsForUserInRange(
  companyId: string,
  userId: string,
  start: Date,
  end: Date,
): Promise<LeadVisit[]> {
  return await db
    .select()
    .from(leadVisits)
    .where(
      and(
        eq(leadVisits.companyId, companyId),
        scheduleEligibleLeadVisitFilter(),
        gte(leadVisits.scheduledStart, start),
        lte(leadVisits.scheduledStart, end),
        sql`${userId} = ANY(${leadVisits.assignedTechnicianIds})`,
      ),
    )
    .orderBy(asc(leadVisits.scheduledStart));
}

/**
 * True iff there are zero other uncompleted visits on the parent
 * lead — i.e. completing `excludeVisitId` would leave nothing open.
 *
 * Used internally by `markLeadVisitCompleted` to decide whether to
 * flip the lead to `needs_review`. Read query uses `db` (not a tx)
 * because the rows it inspects are SIBLINGS of the visit being
 * completed — they're not affected by the in-flight transaction.
 *
 * Exported so tests can pin the predicate without going through
 * the full completion flow.
 */
export async function isLastOpenVisitForLead(
  companyId: string,
  leadId: string,
  excludeVisitId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: leadVisits.id })
    .from(leadVisits)
    .where(
      and(
        eq(leadVisits.companyId, companyId),
        eq(leadVisits.leadId, leadId),
        sql`${leadVisits.id} <> ${excludeVisitId}`,
        uncompletedLeadVisitFilter(),
      ),
    )
    .limit(1);
  return rows.length === 0;
}

/**
 * Atomic completion:
 *   1. Set the visit status -> 'completed', stamp completedAt/By.
 *   2. If no other uncompleted visits remain on the lead AND the
 *      lead is in a non-terminal status, transition lead.status ->
 *      'needs_review'.
 *
 * Both writes happen in one transaction. Office can still convert
 * the lead to a quote any time; this just marks it ready for review.
 *
 * Returns:
 *   { visit, leadTransitioned } where leadTransitioned indicates
 *   whether the lead was just flipped to needs_review by this call.
 */
export async function markLeadVisitCompleted(
  companyId: string,
  visitId: string,
  completedByUserId: string,
  outcomeNote?: string | null,
): Promise<{ visit: LeadVisit; leadTransitioned: boolean } | null> {
  return await db.transaction(async (tx) => {
    // 1) Atomic completion write — only if the visit is currently
    // open. Idempotent against double-clicks: the WHERE clause
    // filters to scheduled|in_progress, so re-runs match nothing.
    const completedRows = await tx
      .update(leadVisits)
      .set({
        status: "completed",
        completedAt: new Date(),
        completedByUserId,
        outcomeNote: outcomeNote ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leadVisits.id, visitId),
          eq(leadVisits.companyId, companyId),
          eq(leadVisits.isActive, true),
          sql`${leadVisits.status} IN ('scheduled', 'in_progress')`,
        ),
      )
      .returning();

    if (completedRows.length === 0) {
      // Visit not found, already terminal, or cross-tenant. Treat as
      // not-found from the caller's perspective.
      return null;
    }

    const visit = completedRows[0];

    // 2) Optional lead-status transition. Skipped when the lead is
    // already in a terminal-ish state (won/lost/quoted) — review-
    // ready makes no sense for those. The "is last open" check
    // queries SIBLINGS of the just-completed visit and is unaffected
    // by the in-flight transaction.
    let leadTransitioned = false;
    const siblingRows = await tx
      .select({ id: leadVisits.id })
      .from(leadVisits)
      .where(
        and(
          eq(leadVisits.companyId, companyId),
          eq(leadVisits.leadId, visit.leadId),
          sql`${leadVisits.id} <> ${visit.id}`,
          uncompletedLeadVisitFilter(),
        ),
      )
      .limit(1);
    const isLast = siblingRows.length === 0;
    if (isLast) {
      const updated = await tx
        .update(leads)
        .set({ status: "needs_review", updatedAt: new Date() })
        .where(
          and(
            eq(leads.id, visit.leadId),
            eq(leads.companyId, companyId),
            // Only flip from non-terminal, non-already-reviewing
            // statuses. Skip if the lead has already been quoted /
            // won / lost — review is meaningless then.
            sql`${leads.status} IN ('new', 'contacted')`,
          ),
        )
        .returning({ id: leads.id });
      leadTransitioned = updated.length > 0;
    }

    return { visit, leadTransitioned };
  });
}

/**
 * Soft-delete a lead visit (isActive=false). Mirrors job_visits
 * archive shape — record stays for history.
 */
export async function archiveLeadVisit(
  companyId: string,
  visitId: string,
  archivedByUserId: string,
): Promise<LeadVisit | null> {
  const rows = await db
    .update(leadVisits)
    .set({
      isActive: false,
      archivedAt: new Date(),
      archivedByUserId,
      updatedAt: new Date(),
    })
    .where(and(eq(leadVisits.id, visitId), eq(leadVisits.companyId, companyId)))
    .returning();
  return rows[0] ?? null;
}

/** Mark a visit cancelled (status update only, row stays active). */
export async function cancelLeadVisit(
  companyId: string,
  visitId: string,
): Promise<LeadVisit | null> {
  const rows = await db
    .update(leadVisits)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(leadVisits.id, visitId), eq(leadVisits.companyId, companyId)))
    .returning();
  return rows[0] ?? null;
}
